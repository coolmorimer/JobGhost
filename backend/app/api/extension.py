import asyncio
import re
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.api.hh_browser import local_request
from app.connectors.chat_bridge import chat_bridge

router = APIRouter(prefix="/api/extension")
HEARTBEAT_INTERVAL = 10


@router.post("/pair", dependencies=[Depends(local_request)])
async def pair():
    return await chat_bridge.pair()


@router.post("/auto-ticket")
async def auto_ticket(request: Request):
    """Short-lived ticket readable by an installed Chromium extension, not a web page."""
    if request.url.hostname not in {"127.0.0.1", "localhost", "test"}:
        raise HTTPException(403, "Недопустимый Host")
    if not re.fullmatch(r"chrome-extension://[a-p]{32}", request.headers.get("origin", "")):
        raise HTTPException(403, "Только расширение JobGhost")
    if chat_bridge.socket is not None:
        return {"state": "connected"}
    return {"state": "ticket", **chat_bridge.issue_token(request.headers["origin"])}


@router.post("/disconnect", dependencies=[Depends(local_request)])
async def disconnect():
    await chat_bridge.close()
    return {"state": "disconnected"}


@router.websocket("/connect")
async def connect(ws: WebSocket):
    origin = ws.headers.get("origin", "")
    user_agent = ws.headers.get("user-agent", "")
    if not re.fullmatch(r"chrome-extension://[a-p]{32}", origin) or "Edg/" in user_agent:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        auth = await asyncio.wait_for(ws.receive_json(), 5)
        if not isinstance(auth, dict):
            await ws.close(code=1008, reason="invalid_auth")
            return
        if (
            not chat_bridge.token
            or time.monotonic() > chat_bridge.expires
            or not secrets.compare_digest(str(auth.get("code", "")), chat_bridge.token)
            or bool(chat_bridge.token_origin and not secrets.compare_digest(origin, chat_bridge.token_origin))
        ):
            await ws.close(code=1008, reason="invalid_or_expired_code")
            return
        chat_bridge.token = ""
        chat_bridge.token_origin = ""
        chat_bridge.socket = ws
        chat_bridge.ready = False
        chat_bridge.last_seen = 0.0
        chat_bridge.page_state = "unknown"
        chat_bridge.browser = "chrome" if "Chrome/" in user_agent else "chromium"
        await ws.send_json({"type": "connected"})
        while True:
            try:
                message = await asyncio.wait_for(ws.receive_json(), HEARTBEAT_INTERVAL)
            except TimeoutError:
                # Server-driven heartbeat: does not rely on background tab timers.
                await ws.send_json({"type": "ping"})
                continue
            if not isinstance(message, dict):
                await ws.close(code=1008)
                return
            if message.get("type") == "heartbeat":
                chat_bridge.ready = message.get("ready") is True
                chat_bridge.last_seen = time.monotonic()
                page_state = message.get("reason")
                chat_bridge.page_state = page_state if page_state in {
                    "editor_unavailable", "tab_unavailable"
                } else "unknown"
            elif message.get("type") == "keepalive":
                # During a long ChatGPT generation the extension can be busy
                # collecting the answer and cannot always run a second page
                # inspection. The authenticated socket is still alive; count
                # its explicit keepalive so an in-flight answer is not aborted.
                chat_bridge.last_seen = time.monotonic()
            elif message.get("type") == "result":
                future = chat_bridge.pending.get(str(message.get("id", "")))
                if future and not future.done():
                    if message.get("error"):
                        future.set_exception(ValueError(str(message["error"])[:600]))
                    elif isinstance(message.get("diagnostic"), dict):
                        diagnostic = message["diagnostic"]
                        allowed = {
                            "users", "answers", "expected_length", "observed_length",
                            "answer_length", "exact", "prefix_match", "busy", "path_is_chat",
                        }
                        future.set_result({key: diagnostic[key] for key in allowed if key in diagnostic})
                    else:
                        answer = str(message.get("answer", "")).strip()
                        if not answer or len(answer) > 100000:
                            future.set_exception(ValueError("Некорректный ответ расширения"))
                        else:
                            future.set_result({"answer": answer, "channel": "chatgpt_extension"})
    except (WebSocketDisconnect, TimeoutError, ValueError):
        pass
    finally:
        if chat_bridge.socket is ws:
            chat_bridge.socket = None
            chat_bridge.ready = False
            chat_bridge.browser = ""
            for future in chat_bridge.pending.values():
                if not future.done():
                    future.set_exception(
                        ValueError("Вкладка моста отключилась; проверьте чат перед повтором")
                    )
