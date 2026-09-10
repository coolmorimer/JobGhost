from pathlib import Path
from typing import Any


class BrowserProvider:
    """Playwright extension point for allowed, user-visible browser sessions."""

    def __init__(self, state_path: Path = Path(".jobghost/browser-state.json")) -> None:
        self.state_path = state_path

    async def open_login(self, url: str) -> None:
        from playwright.async_api import async_playwright

        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=False)
            context = await browser.new_context()
            page = await context.new_page()
            await page.goto(url)
            input("Завершите разрешённую авторизацию в браузере и нажмите Enter...")
            await context.storage_state(path=self.state_path)
            await browser.close()

    async def fetch(self, url: str) -> dict[str, Any]:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch()
            context = await browser.new_context(
                storage_state=self.state_path if self.state_path.exists() else None
            )
            page = await context.new_page()
            response = await page.goto(url)
            result = {
                "url": page.url,
                "title": await page.title(),
                "status": response.status if response else None,
            }
            await browser.close()
            return result
