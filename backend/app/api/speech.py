import asyncio
import base64
import binascii
import json
from typing import Literal

import websockets
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.api.hh_browser import local_request
from app.services.ai_provider import AIProviderError, ai_provider
from app.services.core import detect_question
from app.services.speech import normalize_transcript, speech

router = APIRouter(prefix="/api/speech")
loading: asyncio.Task | None = None
recognition_lock = asyncio.Lock()
LOCAL_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8765",
    "http://127.0.0.1:8765",
}


class AudioInput(BaseModel):
    audio: str = Field(min_length=1, max_length=4_000_000)
    engine: Literal["local", "openai"] = "local"
    mime_type: Literal[
        "audio/webm", "audio/webm;codecs=opus", "audio/wav", "audio/x-wav"
    ] = "audio/webm"
    language: Literal["ru", "en"] | None = None
    context: str = Field(default="", max_length=500)


@router.get("/status", dependencies=[Depends(local_request)])
async def status():
    return {
        "state": speech.state,
        "error": speech.error,
        "model": f"Whisper {speech.model_name} multilingual / {speech.device} {speech.compute_type}".strip(),
        "device": speech.device,
        "languages": ["ru", "en"],
        "local": True,
        "openai_ready": ai_provider.has_key("openai"),
        "engines": ["local", "openai"],
    }


def realtime_session_update() -> dict:
    return {
        "type": "session.update",
        "session": {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                    "transcription": {
                        "model": "gpt-live-transcribe",
                        "prompt": (
                            "Техническое интервью на русском или английском. Technical interview "
                            "in Russian or English. Точно сохраняй названия Python, JavaScript, "
                            "TypeScript, React, Node.js, FastAPI, Kubernetes, Docker, SQL, API, DevOps."
                        ),
                        "keywords": [
                            "Python",
                            "JavaScript",
                            "TypeScript",
                            "React",
                            "Node.js",
                            "FastAPI",
                            "Kubernetes",
                            "Docker",
                            "PostgreSQL",
                            "DevOps",
                        ],
                        "languages": ["ru", "en"],
                        "delay": "low",
                    },
                    # gpt-live-transcribe currently requires explicit commits.
                    # The renderer uses per-source VAD so microphone and speaker stay separate.
                    "turn_detection": None,
                }
            },
        },
    }


def _local_websocket(websocket: WebSocket) -> bool:
    host = (websocket.url.hostname or "").lower()
    origin = websocket.headers.get("origin")
    return host in {"127.0.0.1", "localhost", "testserver"} and origin in (
        None,
        *LOCAL_ORIGINS,
    )


@router.websocket("/live")
async def live_transcription(websocket: WebSocket):
    """Keep the OpenAI key server-side while proxying only PCM and transcript events."""
    if not _local_websocket(websocket):
        await websocket.close(code=1008, reason="Только локальный интерфейс JobGhost")
        return
    key = ai_provider.server_key("openai")
    if not key:
        await websocket.close(code=1008, reason="Сначала сохраните ключ OpenAI")
        return
    await websocket.accept()
    try:
        async with websockets.connect(
            "wss://api.openai.com/v1/realtime?intent=transcription",
            additional_headers={"Authorization": f"Bearer {key}"},
            open_timeout=8,
            close_timeout=3,
            max_size=2_000_000,
        ) as upstream:
            await upstream.send(json.dumps(realtime_session_update(), ensure_ascii=False))

            async def upload():
                while True:
                    message = await websocket.receive_text()
                    if len(message) > 500_000:
                        raise ValueError("Слишком большой аудиофрагмент")
                    event = json.loads(message)
                    if event.get("type") not in {
                        "input_audio_buffer.append",
                        "input_audio_buffer.commit",
                        "input_audio_buffer.clear",
                    }:
                        raise ValueError("Недопустимая команда речи")
                    await upstream.send(message)

            async def download():
                async for message in upstream:
                    event = json.loads(message)
                    if event.get("type") in {
                        "session.created",
                        "session.updated",
                        "input_audio_buffer.speech_started",
                        "input_audio_buffer.speech_stopped",
                        "conversation.item.input_audio_transcription.delta",
                        "conversation.item.input_audio_transcription.completed",
                        "conversation.item.input_audio_transcription.failed",
                        "error",
                    }:
                        await websocket.send_text(message)

            uploader = asyncio.create_task(upload())
            downloader = asyncio.create_task(download())
            done, pending = await asyncio.wait(
                {uploader, downloader}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                task.result()
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json(
                {"type": "error", "message": f"OpenAI Live недоступен: {type(exc).__name__}"}
            )
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


async def load_model():
    try:
        await asyncio.to_thread(speech.load)
    except Exception:
        pass  # Error is exposed by /status, not mistaken for readiness.


@router.post("/load", dependencies=[Depends(local_request)])
async def load():
    global loading
    if loading is None or loading.done():
        loading = asyncio.create_task(load_model())
    return {"state": "loading" if speech.model is None else "ready"}


@router.post("/transcribe", dependencies=[Depends(local_request)])
async def transcribe(data: AudioInput):
    if data.engine == "local" and speech.model is None:
        raise HTTPException(409, "Локальная модель речи ещё не готова")
    if data.engine == "local" and recognition_lock.locked():
        raise HTTPException(429, "Предыдущий фрагмент ещё распознаётся")
    try:
        content = base64.b64decode(data.audio, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, "Некорректная аудиозапись") from exc
    if data.engine == "openai":
        try:
            result = await ai_provider.transcribe_audio(
                content,
                mime_type=data.mime_type,
                language=data.language,
                context=data.context,
            )
        except (AIProviderError, ValueError) as exc:
            raise HTTPException(422, str(exc)) from exc
    else:
        async with recognition_lock:
            try:
                result = await asyncio.to_thread(
                    speech.transcribe,
                    content,
                    language=data.language,
                    context=data.context,
                )
            except Exception as exc:
                raise HTTPException(
                    422, "Не удалось распознать запись; допустим аудиофрагмент до 30 секунд"
                ) from exc
    if not isinstance(result, dict):
        raise HTTPException(422, "Сервис речи вернул некорректный ответ")
    text = normalize_transcript(str(result.get("text", "")))
    return {**result, "text": text, "is_question": detect_question(text)}
