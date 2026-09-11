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
from app.services.context import build_context, memory
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
    resume_id: str | None = Field(default=None, min_length=1, max_length=36)
    context_mode: Literal["resume", "custom"] = "resume"
    custom_prompt: str = Field(default="", max_length=12000)
    session_id: str | None = Field(default=None, max_length=36)
    document_ids: list[str] = Field(default_factory=list, max_length=20)


class SessionRole(BaseModel):
    resume_id: str | None = Field(default=None, min_length=1, max_length=36)
    context_mode: Literal["resume", "custom"] = "resume"
    custom_prompt: str = Field(default="", max_length=12000)
    document_ids: list[str] = Field(default_factory=list, max_length=20)
    save_history: bool = False


def custom_role(text: str) -> str:
    if not text.strip():
        raise HTTPException(422, "Введите свой промпт")
    return ("Не выдумывай личный опыт, достижения и факты о пользователе. "
            "Если данных недостаточно, сообщи об этом. Используй следующий контекст вместо прежней роли:\n" + text.strip())


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
async def ask(data: AIQuestion, db: AsyncSession = Depends(get_db)):
    image = checked_image(data.image)
    role = None
    if data.session_id:
        pass  # Session configuration is authoritative, not mutable renderer preferences.
    elif data.context_mode == "custom":
        role = custom_role(data.custom_prompt)
    elif data.resume_id and ai_provider.options()["provider"] != "browser":
        resume = await db.get(Resume, data.resume_id)
        if not resume or not resume.is_active or not resume.description.strip():
            raise HTTPException(409, "Выберите действующее резюме в настройках роли")
        role = role_prompt(resume, confirmation=False)
    try:
        sources = []
        if data.session_id:
            state = await memory.get(db, data.session_id)
            role, sources = await build_context(db, data.question, state["role"], state["document_ids"], state["turns"])
        elif data.document_ids:
            role, sources = await build_context(db, data.question, role or "Не выдумывай личный опыт.", data.document_ids)
        await ai_provider.ensure_ready()
    except AIProviderError as exc:
        raise HTTPException(409, str(exc)) from exc

    async def events():
        started = time.perf_counter()
        answer = ""
        try:
            async for delta in ai_provider.stream_answer(data.question, image, role=role):
                answer += delta
                yield sse({"type": "delta", "delta": delta})
            if not answer.strip():
                raise AIProviderError("ИИ вернул пустой ответ")
            if data.session_id:
                try:
                    await memory.append(db, data.session_id, data.question, answer)
                except HTTPException:
                    pass  # Session was deleted during streaming; never recreate it.
            current = await ai_provider.status()
            yield sse(
                {
                    "type": "done",
                    "sources": sources,
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
    resume = None
    if data.context_mode == "custom":
        prompt = custom_role(data.custom_prompt)
        confirmation = "Свой промпт загружен"
    else:
        resume = await db.get(Resume, data.resume_id) if data.resume_id else None
        if not resume or not resume.is_active or not resume.description.strip():
            raise HTTPException(409, "Выбранное резюме недоступно или пусто")
        prompt = role_prompt(resume, confirmation=False)
        confirmation = "Роль по резюме загружена"
    try:
        if data.document_ids:
            await build_context(db, "Опыт и проекты", prompt, data.document_ids)
        await ai_provider.ensure_ready()
        provider = ai_provider.options()["provider"]
        if provider == "browser":
            result = await chat_bridge.ask(prompt + f"\nНа это сообщение ответь только: {confirmation}.")
            answer = str(result.get("answer", "")).strip()
            if confirmation.lower() not in answer.lower().replace("ё", "е"):
                raise AIProviderError("ChatGPT не подтвердил загрузку роли")
        else:
            ai_provider.set_role(prompt)
            answer = confirmation + "."
        session_id = await memory.create(db, prompt, resume.name if resume else "Свой промпт", data.document_ids, data.save_history)
        return {
            "session_id": session_id,
            "initialized": True,
            "resume_id": resume.id if resume else None,
            "resume": resume.name if resume else "Свой промпт",
            "context_mode": data.context_mode,
            "answer": answer,
            "channel": provider,
        }
    except (AIProviderError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc
