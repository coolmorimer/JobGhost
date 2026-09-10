import asyncio
import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.hh_browser import local_request
from app.services.core import detect_question
from app.services.speech import speech

router = APIRouter(prefix="/api/speech", dependencies=[Depends(local_request)])
loading: asyncio.Task | None = None
recognition_lock = asyncio.Lock()


class AudioInput(BaseModel):
    audio: str = Field(min_length=1, max_length=4_000_000)


@router.get("/status")
async def status():
    return {
        "state": speech.state,
        "error": speech.error,
        "model": f"Whisper {speech.model_name} multilingual / CPU int8",
        "languages": ["ru", "en"],
        "local": True,
    }


async def load_model():
    try:
        await asyncio.to_thread(speech.load)
    except Exception:
        pass  # Error is exposed by /status, not mistaken for readiness.


@router.post("/load")
async def load():
    global loading
    if loading is None or loading.done():
        loading = asyncio.create_task(load_model())
    return {"state": "loading" if speech.model is None else "ready"}


@router.post("/transcribe")
async def transcribe(data: AudioInput):
    if speech.model is None:
        raise HTTPException(409, "Локальная модель речи ещё не готова")
    if recognition_lock.locked():
        raise HTTPException(429, "Предыдущий фрагмент ещё распознаётся")
    try:
        content = base64.b64decode(data.audio, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, "Некорректная аудиозапись") from exc
    async with recognition_lock:
        try:
            result = await asyncio.to_thread(speech.transcribe, content)
        except Exception as exc:
            raise HTTPException(
                422, "Не удалось распознать запись; допустим аудиофрагмент до 30 секунд"
            ) from exc
    return {**result, "is_question": detect_question(result["text"])}
