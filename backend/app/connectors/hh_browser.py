"""Browser integration for HH without API keys or credential handling."""

import asyncio
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

from playwright.async_api import BrowserContext, Page, Playwright, TimeoutError, async_playwright

RESPONSE_BUTTON = '[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"]'
LETTER_FIELD = 'textarea[data-qa*="letter"], textarea[name*="letter"], textarea[placeholder*="сопровод" i]'
LETTER_TOGGLE = '[data-qa*="letter-toggle"], button:has-text("Сопроводительное письмо"), button:has-text("Добавить письмо")'
FINAL_SUBMIT = '[data-qa="vacancy-response-submit-popup"], [data-qa*="response-submit"]'


def vacancy_url(value: str) -> str:
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not (host == "hh.ru" or host.endswith(".hh.ru")):
        raise ValueError("Разрешены только страницы вакансий hh.ru")
    match = re.fullmatch(r"/vacancy/(\d+)/?", parsed.path)
    if not match or parsed.port not in (None, 443) or parsed.username:
        raise ValueError("Некорректная ссылка на вакансию")
    return f"https://hh.ru/vacancy/{match[1]}"


def response_form_url(href: str, vacancy: str) -> str:
    target = urljoin("https://hh.ru", href)
    parsed = urlsplit(target)
    vacancy_id = vacancy_url(vacancy).rsplit("/", 1)[1]
    if (parsed.scheme != "https" or parsed.hostname != "hh.ru"
            or parsed.port not in (None, 443) or parsed.username
            or parsed.path != "/applicant/vacancy_response"
            or parse_qs(parsed.query).get("vacancyId") != [vacancy_id]):
        raise ValueError("Не удалось подтвердить безопасную форму отклика HH; откройте её вручную")
    return target


class HHBrowser:
    def __init__(self) -> None:
        self.path = Path(os.environ['JOBGHOST_USER_DATA']) / 'browser/hh' if os.environ.get('JOBGHOST_USER_DATA') else Path(__file__).resolve().parents[3] / '.jobghost/browser/hh'
        self.lock = asyncio.Lock()
        self.runtime: Playwright | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self.background = False

    async def set_background(self, enabled: bool) -> None:
        async with self.lock:
            if self.background != enabled:
                await self.close()
                self.background = enabled

    async def _page(self) -> Page:
        if self.context is None:
            if self.runtime:
                await self.runtime.stop()
            self.path.mkdir(parents=True, exist_ok=True)
            self.runtime = await async_playwright().start()
            self.context = await self.runtime.chromium.launch_persistent_context(
                str(self.path),
                channel="msedge",
                headless=self.background,
                viewport={"width": 1280, "height": 850},
                locale="ru-RU",
            )
            self.context.on("close", self._closed)
        if self.page is None or self.page.is_closed():
            self.page = await self.context.new_page()
        return self.page

    def _closed(self, *_: object) -> None:
        self.context = None
        self.page = None

    async def close(self) -> None:
        if self.context:
            await self.context.close()
        if self.runtime:
            await self.runtime.stop()
            self.runtime = None

    async def status(self) -> dict:
        if not self.page or self.page.is_closed():
            return {"state": "closed", "message": "Откройте браузер HH"}
        body = (await self.page.locator("body").inner_text())[:8000].lower()
        if (
            any(
                t in body
                for t in (
                    "подтвердите, что вы не робот",
                    "введите символы с картинки",
                    "доступ временно ограничен",
                )
            )
            or "captcha" in self.page.url
        ):
            return {"state": "manual_action", "message": "Пройдите проверку HH в открытом браузере"}
        if "/account/login" in self.page.url:
            return {"state": "login_required", "message": "Войдите в HH в открытом окне"}
        signed_in = await self.page.locator(
            '[data-qa="profileAndResumes-button"], [data-qa="applicantProfilePage-button"]'
        ).count()
        if not signed_in:
            signed_in = await self.page.get_by_role(
                "link", name=re.compile(r"^(Мои резюме|Резюме и\s+профиль)(?:\s+\d+)?$")
            ).count()
        return {
            "state": "connected" if signed_in else "open",
            "message": "Вход подтверждён"
            if signed_in
            else "Браузер открыт; вход пока не подтверждён",
        }

    async def open_login(self) -> dict:
        await self.set_background(False)
        async with self.lock:
            page = await self._page()
            await page.goto("https://hh.ru/account/login", wait_until="domcontentloaded")
            if not self.background:
                await page.bring_to_front()
            return await self.status()

    async def search(self, query: str) -> list[dict]:
        async with self.lock:
            page = await self._page()
            current = await self.status()
            if current["state"] in ("manual_action", "login_required"):
                raise ValueError(current["message"])
            await page.goto(
                "https://hh.ru/search/vacancy?" + urlencode({"text": query}),
                wait_until="domcontentloaded",
            )
            if not self.background:
                await page.bring_to_front()
            await page.locator("h1").first.wait_for(timeout=20000)
            current = await self.status()
            if current["state"] in ("manual_action", "login_required"):
                raise ValueError(current["message"])
            rows = await page.locator('a[href*="/vacancy/"]').evaluate_all("""links => links.filter(a => a.innerText.trim()).map(a => {
                let card = a.parentElement;
                for (let i=0; i<8 && card && !card.querySelector('a[href*="/employer/"]'); i++) card=card.parentElement;
                const companies = card ? [...card.querySelectorAll('a[href*="/employer/"]')].map(e=>e.innerText.trim()).filter(Boolean) : [];
                return {url:a.href,title:a.innerText.trim(),company:companies.at(-1) || '',description:card?.innerText || ''};
            })""")
            result: dict[str, dict] = {}
            for row in rows:
                try:
                    url = vacancy_url(row["url"])
                except ValueError:
                    continue
                external_id = url.rsplit("/", 1)[1]
                result.setdefault(
                    external_id,
                    {
                        "external_id": external_id,
                        "provider": "hh_browser",
                        "currency": "",
                        "url": url,
                        "title": row["title"][:300],
                        "company": row["company"][:250],
                        "description": row["description"][:12000],
                        "remote": "Можно удалённо" in row["description"],
                        "raw_data": {"source": "visible_search_card", "query": query},
                    },
                )
            if not result and not re.search(
                r"ничего не найдено|найдено 0|не нашли",
                (await page.locator("body").inner_text()).lower(),
            ):
                raise ValueError(
                    "HH не показал карточки. Проверьте окно браузера и повторите поиск."
                )
            return list(result.values())[:50]

    async def open_vacancy(self, url: str) -> dict:
        url = vacancy_url(url)
        await self.set_background(False)
        async with self.lock:
            page = await self._page()
            await page.goto(url, wait_until="domcontentloaded")
            await page.bring_to_front()
            return await self.status()

    async def read_resumes(self) -> list[dict]:
        """Read only the user's resume list and its linked resume pages."""
        async with self.lock:
            page = await self._page()
            await page.goto("https://hh.ru/applicant/resumes", wait_until="domcontentloaded")
            await page.locator("body").wait_for()
            if (await self.status())["state"] in {"login_required", "manual_action"}:
                raise ValueError("HH просит войти или пройти проверку в открытом окне")
            links = await page.locator('a[href*="/resume/"]').evaluate_all(
                "links => links.map(a => ({url:a.href,title:a.innerText.trim()}))"
            )
            candidates: dict[str, dict] = {}
            for link in links:
                parsed = urlsplit(link["url"])
                host = parsed.hostname or ""
                match = re.fullmatch(r"/resume/([a-zA-Z0-9]+)/?", parsed.path)
                if (
                    parsed.scheme == "https"
                    and (host == "hh.ru" or host.endswith(".hh.ru"))
                    and match
                    and link["title"]
                ):
                    candidates.setdefault(
                        match[1],
                        {
                            "id": match[1],
                            "title": link["title"],
                            "url": f"https://hh.ru/resume/{match[1]}",
                        },
                    )
            if not candidates:
                raise ValueError(
                    "На странице HH не найдены ссылки на ваши резюме. Проверьте открытый раздел «Мои резюме»."
                )
            results = []
            detail = await self.context.new_page() if self.context else page
            try:
                for item in list(candidates.values())[:20]:
                    await detail.goto(item["url"], wait_until="domcontentloaded")
                    if "/account/login" in detail.url or "captcha" in detail.url:
                        raise ValueError("HH запросил вход или проверку при чтении резюме")
                    await detail.locator("h1").first.wait_for(timeout=15000)
                    title = (await detail.locator("h1").first.inner_text()).strip()
                    body = await detail.locator("body").inner_text()
                    results.append({**item, "heading": title, "text": body[:80000]})
            finally:
                if detail is not page:
                    await detail.close()
            return results

    async def read_vacancy(self, url: str) -> dict:
        url = vacancy_url(url)
        async with self.lock:
            page = await self._page()
            response = await page.goto(url, wait_until="domcontentloaded")
            if response and response.status >= 400:
                raise ValueError("HH не открыл вакансию")
            if (await self.status())["state"] in {"login_required", "manual_action"}:
                raise ValueError("HH требует вход или ручную проверку")
            description = page.locator('[data-qa="vacancy-description"]')
            await description.first.wait_for(timeout=15000)
            text = (await description.first.inner_text()).strip()
            if len(text) < 80:
                raise ValueError("Полное описание вакансии не подтверждено")
            title = (await page.locator("h1").first.inner_text()).strip()
            skills = await page.locator('[data-qa="bloko-tag__text"]').all_inner_texts()
            return {
                "title": title[:300],
                "description": text[:50000],
                "skills": skills[:80],
                "source": "visible_vacancy_detail",
            }

    @staticmethod
    async def _response_sent(page: Page) -> bool:
        if await page.locator(
            '[data-qa*="response-success"], [data-qa="vacancy-response-link-view-topic"]'
        ).count():
            return True
        body = " ".join((await page.locator("body").inner_text()).lower().split())
        return any(
            phrase in body
            for phrase in ("отклик отправлен", "вы откликнулись", "отклик уже отправлен")
        )

    @staticmethod
    async def _unknown_questions(page: Page) -> list[str]:
        return await page.locator("input, textarea, select, [contenteditable=true]").evaluate_all(
            """nodes => nodes.filter(node => {
              const style=getComputedStyle(node);
              if(style.display==='none'||style.visibility==='hidden'||node.disabled||node.type==='hidden') return false;
              const meta=[node.getAttribute('data-qa'),node.name,node.id,node.getAttribute('placeholder'),node.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
              if(/letter|cover|сопровод/.test(meta)) return false;
              if(/resume|резюм/.test(meta)) return false;
              if(['radio','checkbox','submit','button'].includes((node.type||'').toLowerCase())) return false;
              return true;
            }).map(node => (node.getAttribute('aria-label')||node.getAttribute('placeholder')||node.name||node.id||node.tagName).trim()).slice(0,10)"""
        )

    @staticmethod
    async def _select_resume(page: Page, resume_id: str) -> None:
        if not re.fullmatch(r"[a-zA-Z0-9]+", resume_id):
            raise ValueError("Некорректный идентификатор резюме HH")
        exact = page.locator(f'input[type="radio"][value="{resume_id}"]')
        if await exact.count():
            await exact.first.check()
            return
        selects = page.locator('select[name*="resume" i], select[data-qa*="resume" i]')
        if await selects.count():
            options = await selects.first.locator("option").evaluate_all(
                "options => options.map(option => option.value)"
            )
            if resume_id not in options:
                raise ValueError("Выбранное резюме отсутствует в форме отклика HH")
            await selects.first.select_option(resume_id)
            return
        resume_links = page.locator('a[href*="/resume/"]:visible')
        hrefs = await resume_links.evaluate_all("links => links.map(link => link.href)")
        shown = {
            match.group(1)
            for href in hrefs
            if (match := re.search(r"/resume/([a-zA-Z0-9]+)", href))
        }
        if shown and resume_id not in shown:
            raise ValueError("HH показывает другое резюме; отклик остановлен")
        radios = page.locator('input[type="radio"][name*="resume" i]:visible')
        if await radios.count() == 1:
            await radios.first.check()
            return
        if not shown or len(shown) != 1:
            raise ValueError("Не удалось однозначно подтвердить выбранное резюме HH")

    async def response_preflight(self, url: str, resume_id: str) -> dict:
        url = vacancy_url(url)
        async with self.lock:
            page = await self._page()
            response = await page.goto(url, wait_until="domcontentloaded")
            if response and response.status >= 400:
                raise ValueError("HH не открыл вакансию")
            current = await self.status()
            if current["state"] in {"login_required", "manual_action"}:
                raise ValueError(current["message"])
            if await self._response_sent(page):
                return {"state": "already_applied", "message": "На HH уже есть отклик"}
            button = page.locator(RESPONSE_BUTTON).first
            if not await button.count() or not await button.is_visible():
                raise ValueError("HH не показал кнопку отклика для этой вакансии")
            href = await button.get_attribute("href")
            target = response_form_url(href or "", url)
            return {
                "state": "ready",
                "message": "Вакансия доступна. Резюме и письмо будут проверены в форме перед отправкой.",
                "response_url": target,
                "resume_id": resume_id,
            }

    async def apply(self, url: str, resume_id: str, letter: str) -> dict:
        """Submit once and stop if HH asks anything beyond resume and cover letter."""
        url = vacancy_url(url)
        if not letter.strip():
            raise ValueError("Сопроводительное письмо пустое")
        async with self.lock:
            page = await self._page()
            await page.goto(url, wait_until="domcontentloaded")
            current = await self.status()
            if current["state"] in {"login_required", "manual_action"}:
                raise ValueError(current["message"])
            if await self._response_sent(page):
                raise ValueError("На HH уже есть отклик на эту вакансию")
            response_button = page.locator(RESPONSE_BUTTON).first
            if not await response_button.count() or not await response_button.is_visible():
                raise ValueError("HH не показал кнопку отклика")
            # Opening a response URL can itself submit a one-click application.
            # Allow only a local modal to open; block writes/navigation until its
            # resume and letter have been verified. Never retry a blocked click.
            blocked = []

            async def guard(route):
                request = route.request
                if (request.method not in {"GET", "HEAD", "OPTIONS"}
                        or "vacancy_response" in urlsplit(request.url).path):
                    blocked.append(request.url)
                    await route.abort()
                else:
                    await route.continue_()

            await page.route("**/*", guard)
            try:
                await response_button.click()
                await page.wait_for_timeout(700)
            finally:
                await page.unroute("**/*", guard)
            if blocked:
                raise ValueError("HH предложил быстрый отклик без проверенной формы. Отправьте его вручную; автоматическая отправка заблокирована.")
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            except TimeoutError:
                pass
            await page.wait_for_timeout(700)
            current = await self.status()
            if current["state"] in {"login_required", "manual_action"}:
                raise ValueError(current["message"])
            if await self._response_sent(page):
                raise ValueError("HH уже показывает отправленный отклик; автоматический повтор остановлен")
            await self._select_resume(page, resume_id)
            field = page.locator(LETTER_FIELD)
            if not await field.count() or not await field.first.is_visible():
                toggle = page.locator(LETTER_TOGGLE).first
                if await toggle.count() and await toggle.is_visible():
                    await toggle.click()
                    await page.wait_for_timeout(250)
                    field = page.locator(LETTER_FIELD)
            if not await field.count() or not await field.first.is_visible():
                raise ValueError("HH не показал поле сопроводительного письма")
            await field.first.fill(letter.strip())
            questions = await self._unknown_questions(page)
            if questions:
                raise ValueError(
                    "HH запросил дополнительные ответы: " + ", ".join(questions[:3])
                )
            submit = page.locator(FINAL_SUBMIT).first
            if not await submit.count() or not await submit.is_visible():
                submit = page.get_by_role(
                    "button", name=re.compile(r"^(Откликнуться|Отправить отклик|Отправить)$")
                ).last
            if not await submit.count() or not await submit.is_visible():
                raise ValueError("Не найдена финальная кнопка отправки HH")
            await submit.click()
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            except TimeoutError:
                pass
            await page.wait_for_timeout(700)
            if not await self._response_sent(page):
                raise ValueError("HH не подтвердил отправку; повтор автоматически не выполняется")
            return {"id": f"hh:{url.rsplit('/', 1)[1]}", "state": "sent"}


hh_browser = HHBrowser()
