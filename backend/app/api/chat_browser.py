import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException
from playwright.async_api import Error as BrowserError
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.hh_browser import local_request
from app.connectors.chat_bridge import chat_bridge as chat_browser
from app.db.models import Resume
from app.db.session import get_db
from app.services.interview_role import role_prompt

router = APIRouter(prefix="/api/chat-browser", dependencies=[Depends(local_request)])


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=16000, pattern=r"\S")
    image: str | None = Field(default=None, max_length=4_000_000)


class SessionRole(BaseModel):
    resume_id: str = Field(min_length=1, max_length=36)


@router.get("/status")
async def status():
    try:
        return await chat_browser.status()
    except BrowserError:
        return {"state": "needs_login", "message": "Проверьте окно ChatGPT"}


@router.post("/open")
async def open_chat():
    raise HTTPException(409, 'Откройте обычный браузер самостоятельно и подключите расширение JobGhost')


@router.post("/ask")
async def ask(data: Question):
    picture = None
    if data.image:
        try:
            picture = base64.b64decode(data.image, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(422, "Некорректное изображение") from exc
        if not picture.startswith(b"\xff\xd8\xff"):
            raise HTTPException(422, "Ожидается JPEG")
    try:
        return await chat_browser.ask(data.question, picture)
    except (ValueError, BrowserError) as exc:
        raise HTTPException(
            409,
            str(exc)
            if isinstance(exc, ValueError)
            else "Ошибка интерфейса ChatGPT. Проверьте окно перед повтором.",
        ) from exc


@router.post("/session/start")
async def start_session(data: SessionRole, db: AsyncSession = Depends(get_db)):
    resume = await db.get(Resume, data.resume_id)
    if not resume or not resume.is_active or not resume.description.strip():
        raise HTTPException(409, "Выбранное резюме недоступно или пустое")
    try:
        result = await chat_browser.ask(role_prompt(resume, confirmation=True))
    except (ValueError, BrowserError) as exc:
        raise HTTPException(
            409,
            str(exc)
            if isinstance(exc, ValueError)
            else "Не удалось загрузить роль в ChatGPT",
        ) from exc
    answer = str(result.get("answer", "")).strip()
    if "роль по резюме загружена" not in answer.lower().replace("ё", "е"):
        raise HTTPException(409, "ChatGPT не подтвердил загрузку роли. Начните сессию ещё раз после проверки служебного чата.")
    return {
        "initialized": True,
        "resume_id": resume.id,
        "resume": resume.name,
        "answer": answer,
        "channel": result.get("channel"),
    }


@router.post("/diagnostics")
async def diagnostics(data: Question):
    """Local support endpoint: only safe counters/booleans, never page or resume text."""
    try:
        return await chat_browser.diagnose(data.question)
    except (ValueError, BrowserError) as exc:
        raise HTTPException(409, str(exc)) from exc
