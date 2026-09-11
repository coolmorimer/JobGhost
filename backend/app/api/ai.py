import base64
import binascii
import json
import time
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.hh_browser import local_request
from app.connectors.chat_bridge import chat_bridge
from app.db.models import Resume
from app.db.session import get_db
from app.services.ai_provider import AIProviderError, ai_provider
from app.services.interview_role import role_prompt

router = APIRouter(prefix="/api/ai", dependencies=[Depends(local_request)])


class ProviderSettings(BaseModel):
    provider: Literal["browser", "openai", "openrouter"]
    openai_model: str = Field(min_length=1, max_length=100)
    openrouter_model: str = Field(min_length=1, max_length=200)
    openai_api_key: str | None = Field(default=None, max_length=500)
    openrouter_api_key: str | None = Field(default=None, max_length=500)


class AIQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=16000, pattern=r"\S")
    image: str | None = Field(default=None, max_length=4_000_000)


class SessionRole(BaseModel):
    resume_id: str = Field(min_length=1, max_length=36)


def checked_image(value: str | None) -> str | None:
    if not value:
        return None
    try:
        picture = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, "Некорректное изображение") from exc
    if not picture.startswith(b"\xff\xd8\xff"):
        raise HTTPException(422, "Ожидается JPEG")
    return value


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.get("/settings")
async def settings():
    return await ai_provider.public_settings()


@router.put("/settings")
async def save_settings(data: ProviderSettings):
    try:
        if data.openai_api_key is not None:
            ai_provider.save_key("openai", data.openai_api_key)
        if data.openrouter_api_key is not None:
            ai_provider.save_key("openrouter", data.openrouter_api_key)
        ai_provider.save_options(data.provider, data.openai_model, data.openrouter_model)
        return await ai_provider.public_settings()
    except AIProviderError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/models/openrouter")
async def openrouter_models(refresh: bool = False):
    models = await ai_provider.free_models(refresh=refresh)
    return {
        "models": models,
        "message": (
            "Бесплатные модели отсортированы по минимальному времени до первого токена."
            if models
            else "Каталог временно недоступен; будет использован автоматический бесплатный роутер."
        ),
    }


@router.get("/status")
async def status():
    return await ai_provider.status()


@router.post("/ask")
async def ask(data: AIQuestion):
    image = checked_image(data.image)
    try:
        await ai_provider.ensure_ready()
    except AIProviderError as exc:
        raise HTTPException(409, str(exc)) from exc

    async def events():
        started = time.perf_counter()
        answer = ""
        try:
            async for delta in ai_provider.stream_answer(data.question, image):
                answer += delta
                yield sse({"type": "delta", "delta": delta})
            if not answer.strip():
                raise AIProviderError("ИИ вернул пустой ответ")
            current = await ai_provider.status()
            yield sse(
                {
                    "type": "done",
                    "provider": current.get("provider"),
                    "model": current.get("model"),
                    "elapsed_ms": round((time.perf_counter() - started) * 1000),
                }
            )
        except (AIProviderError, httpx.HTTPError) as exc:
            yield sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/session/start")
async def start_session(data: SessionRole, db: AsyncSession = Depends(get_db)):
    resume = await db.get(Resume, data.resume_id)
    if not resume or not resume.is_active or not resume.description.strip():
        raise HTTPException(409, "Выбранное резюме недоступно или пусто")
    try:
        await ai_provider.ensure_ready()
        provider = ai_provider.options()["provider"]
        if provider == "browser":
            result = await chat_bridge.ask(role_prompt(resume, confirmation=True))
            answer = str(result.get("answer", "")).strip()
            if "роль по резюме загружена" not in answer.lower().replace("ё", "е"):
                raise AIProviderError("ChatGPT не подтвердил загрузку роли")
        else:
            ai_provider.set_role(role_prompt(resume, confirmation=False))
            answer = "Роль по резюме подготовлена."
        return {
            "initialized": True,
            "resume_id": resume.id,
            "resume": resume.name,
            "answer": answer,
            "channel": provider,
        }
    except (AIProviderError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc
