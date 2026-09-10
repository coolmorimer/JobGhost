"""Read-only selector audit for the logged-in HH browser profile."""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> None:
    url = sys.argv[1]
    profile = Path(__file__).resolve().parents[1] / ".jobghost/browser/hh"
    with sync_playwright() as runtime:
        context = runtime.chromium.launch_persistent_context(
            str(profile), channel="msedge", headless=True, locale="ru-RU"
        )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(url, wait_until="domcontentloaded")
            page.locator("body").wait_for()
            controls = page.locator("button, a, textarea, input").evaluate_all(
                """nodes => nodes.map(node => ({
                  tag: node.tagName,
                  qa: node.getAttribute('data-qa') || '',
                  type: node.getAttribute('type') || '',
                  name: node.getAttribute('name') || '',
                  text: (node.innerText || node.getAttribute('aria-label') || '').trim().replace(/\\s+/g,' ').slice(0,160),
                  href: node.href || '',
                  disabled: !!node.disabled
                })).filter(item => item.qa || /отклик|резюме|письм|respond|apply/i.test(item.text + ' ' + item.name)).slice(0,120)"""
            )
            body = page.locator("body").inner_text().lower()
            print(
                json.dumps(
                    {
                        "url": page.url,
                        "login": "/account/login" in page.url,
                        "captcha": "captcha" in page.url or "не робот" in body,
                        "controls": controls,
                    },
                    ensure_ascii=False,
                )
            )
        finally:
            context.close()


if __name__ == "__main__":
    main()
