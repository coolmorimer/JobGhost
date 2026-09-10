import asyncio
import base64
import secrets
import time

from fastapi import WebSocket


class ChatBridge:
    def __init__(self):
        self.socket: WebSocket | None = None
        self.token = ""
        self.expires = 0.0
        self.token_origin = ""
        self.pending: dict[str, asyncio.Future] = {}
        self.ready = False
        self.last_seen = 0.0
        self.page_state = "unknown"
        self.browser = ""
        self.lock = asyncio.Lock()

    async def pair(self):
        await self.close()
        return self.issue_token()

    def issue_token(self, origin: str = ""):
        self.token = secrets.token_urlsafe(32)
        self.token_origin = origin
        self.expires = time.monotonic() + 120
        return {"code": self.token, "expires_seconds": 120}

    async def close(self):
        self.ready = False
        self.token = ""
        self.token_origin = ""
        self.expires = 0.0
        self.last_seen = 0.0
        self.page_state = "unknown"
        self.browser = ""
        old_socket, self.socket = self.socket, None
        if old_socket:
            try:
                await old_socket.close()
            except (RuntimeError, OSError):
                pass
        for future in self.pending.values():
            if not future.done():
                future.set_exception(ValueError("Мост ChatGPT отключён; запрос не повторён"))

    async def status(self):
        online = self.socket is not None and self.ready and time.monotonic() - self.last_seen < 25
        reason = "connected" if online else (
            "disconnected" if self.socket is None else
            "awaiting_heartbeat" if not self.last_seen else
            "heartbeat_expired" if time.monotonic() - self.last_seen >= 25 else
            self.page_state
        )
        messages = {
            "connected": "Расширение подключено к вкладке ChatGPT",
            "disconnected": "Расширение подключится автоматически. Если этого не произошло, проверьте, что Edge или Chrome запущен и вход в ChatGPT выполнен.",
            "awaiting_heartbeat": "Расширение подключается: ожидается проверка вкладки ChatGPT.",
            "heartbeat_expired": "Расширение перестало отвечать и попробует подключиться снова автоматически.",
            "editor_unavailable": "Вкладка ChatGPT открыта, но поле ввода недоступно. Проверьте вход вручную.",
            "tab_unavailable": "Служебная вкладка ChatGPT закрыта. Расширение откроет её снова автоматически.",
        }
        return {
            "state": "ready" if online else "needs_extension",
            "reason": reason,
            "browser": self.browser or None,
            "message": (
                "Расширение подключено к вкладке ChatGPT в Google Chrome"
                if reason == "connected" and self.browser == "chrome"
                else messages.get(reason, "Проверьте выбранную вкладку ChatGPT в расширении.")
            ),
        }

    async def ask(self, question: str, picture: bytes | None = None):
        if self.lock.locked():
            raise ValueError("Предыдущий запрос ещё выполняется")
        async with self.lock:
            if (await self.status())["state"] != "ready" or not self.socket:
                raise ValueError("Расширение ChatGPT не подключено")
            key = secrets.token_hex(16)
            future = asyncio.get_running_loop().create_future()
            self.pending[key] = future
            try:
                await self.socket.send_json(
                    {
                        "type": "question",
                        "id": key,
                        "question": question,
                        "image": base64.b64encode(picture).decode() if picture else None,
                    }
                )
                return await asyncio.wait_for(future, 160)
            except TimeoutError as exc:
                raise ValueError(
                    "Ответ не подтверждён. Проверьте чат; автоматического повтора нет."
                ) from exc
            finally:
                self.pending.pop(key, None)

    async def diagnose(self, question: str):
        """Compare one expected turn with the current page without returning page text."""
        if (await self.status())["state"] != "ready" or not self.socket:
            raise ValueError("Расширение ChatGPT не подключено")
        key = secrets.token_hex(16)
        future = asyncio.get_running_loop().create_future()
        self.pending[key] = future
        try:
            await self.socket.send_json({"type": "diagnostic", "id": key, "question": question})
            return await asyncio.wait_for(future, 10)
        finally:
            self.pending.pop(key, None)


chat_bridge = ChatBridge()
