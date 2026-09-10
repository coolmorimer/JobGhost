"""Ordinary ChatGPT UI, isolated local login. No private HTTP APIs or cookie export."""

import asyncio
import time
from pathlib import Path

from playwright.async_api import BrowserContext, Page, Playwright, async_playwright


class ChatBrowser:
    def __init__(self):
        self.runtime: Playwright | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self.lock = asyncio.Lock()

    async def open(self):
        raise ValueError(
            "Вход через управляемый браузер отключён после отказа Google. Требуется другой способ подключения ChatGPT; повторять вход здесь не нужно."
        )

    async def _experimental_open(self):
        if self.context is None:
            if self.runtime:
                await self.runtime.stop()
            self.runtime = await async_playwright().start()
            profile = Path(__file__).resolve().parents[3] / ".jobghost/browser/chatgpt"
            self.context = await self.runtime.chromium.launch_persistent_context(
                str(profile),
                channel="msedge",
                headless=False,
                viewport={"width": 1100, "height": 850},
            )
            self.context.on("close", self.closed)
        if self.page is None or self.page.is_closed():
            self.page = await self.context.new_page()
            await self.page.goto("https://chatgpt.com/", wait_until="domcontentloaded")
        return self.page

    def closed(self, *_):
        self.context = None
        self.page = None

    async def close(self):
        if self.context:
            await self.context.close()
        if self.runtime:
            await self.runtime.stop()
            self.runtime = None

    async def status(self):
        return {
            "state": "integration_blocked",
            "message": "Google отклонил вход через управляемый браузер. Этот способ отключён; ChatGPT пока не подключён.",
        }

    async def _experimental_status(self):
        if not self.page or self.page.is_closed():
            return {"state": "closed", "message": "Откройте вход в ChatGPT"}
        composer = self.page.locator("#prompt-textarea")
        if await composer.count() and await composer.is_visible():
            login = self.page.get_by_role("button", name="Log in", exact=True).or_(
                self.page.get_by_role("button", name="Войти", exact=True)
            )
            if not await login.count():
                return {
                    "state": "ready",
                    "message": "Поле ChatGPT доступно; можно проверить запрос",
                }
        return {
            "state": "needs_login",
            "message": "Войдите в ChatGPT или завершите проверку в открытом Edge",
        }

    async def ask(self, question: str, picture: bytes | None = None) -> dict:
        if self.lock.locked():
            raise ValueError("ChatGPT ещё отвечает на предыдущий вопрос")
        async with self.lock:
            page = await self.open()
            if (await self.status())["state"] != "ready":
                raise ValueError("Требуется вход в отдельном окне ChatGPT")
            composer = page.locator("#prompt-textarea")
            if (await composer.inner_text()).strip():
                raise ValueError(
                    "В ChatGPT уже есть неотправленный текст. Отправьте или очистите его вручную."
                )
            if picture:
                upload = page.locator("input[type=file]")
                if not await upload.count():
                    raise ValueError(
                        "Поле загрузки изображения не найдено. Откройте прикрепление файла в ChatGPT."
                    )
                await upload.first.set_input_files(
                    {"name": "jobghost-screen.jpg", "mimeType": "image/jpeg", "buffer": picture}
                )
            messages = page.locator('[data-message-author-role="assistant"]')
            previous = await messages.count()
            await composer.fill(question)
            await composer.press("Enter")
            deadline = time.monotonic() + 150
            last, stable = "", 0
            while time.monotonic() < deadline:
                await asyncio.sleep(1)
                if await messages.count() <= previous:
                    continue
                answer = (await messages.last.inner_text()).strip()
                stop = page.locator('[data-testid="stop-button"]')
                if answer and answer == last and not await stop.count():
                    stable += 1
                    if stable >= 3:
                        return {"answer": answer, "channel": "chatgpt_browser", "url": page.url}
                else:
                    stable = 0
                last = answer
            raise ValueError(
                "Ответ ChatGPT не подтверждён за 150 секунд. Проверьте окно; автоматически повторно вопрос не отправляю."
            )


chat_browser = ChatBrowser()
