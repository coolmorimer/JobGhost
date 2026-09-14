import pytest

from app.connectors.hh_browser import (
    HHBrowser,
    recommendations_url,
    response_form_url,
    vacancy_url,
)


async def test_sent_confirmation_normalizes_nonbreaking_space():
    class Locator:
        async def count(self):
            return 0

        async def inner_text(self):
            return "Вы\u00a0откликнулись"

    class Page:
        def locator(self, selector):
            return Locator()

    assert await HHBrowser._response_sent(Page())


def test_response_form_requires_exact_vacancy():
    assert (
        response_form_url("/applicant/vacancy_response?vacancyId=123", "https://hh.ru/vacancy/123")
        == "https://hh.ru/applicant/vacancy_response?vacancyId=123"
    )
    for href in [
        "",
        "https://evil.com/applicant/vacancy_response?vacancyId=123",
        "/applicant/vacancy_response?vacancyId=456",
        "/vacancy/123",
        "/applicant/vacancy_response?vacancyId=123&vacancyId=456",
    ]:
        with pytest.raises(ValueError):
            response_form_url(href, "https://hh.ru/vacancy/123")


def test_recommendations_url_is_read_only_hh_page():
    assert (
        recommendations_url("/applicant/resumes/recommendations?resume=abc")
        == "https://hh.ru/applicant/resumes/recommendations?resume=abc"
    )
    assert (
        recommendations_url("https://ulyanovsk.hh.ru/search/vacancy?resume=abc&hhtmFrom=resume")
        == "https://ulyanovsk.hh.ru/search/vacancy?resume=abc&hhtmFrom=resume"
    )
    for href in (
        "https://evil.com/applicant/resumes/recommendations",
        "/applicant/vacancy_response?vacancyId=123",
        "/account/login",
    ):
        with pytest.raises(ValueError):
            recommendations_url(href)


@pytest.mark.parametrize(
    "url", ["https://hh.ru/vacancy/123?from=search", "https://ulyanovsk.hh.ru/vacancy/123"]
)
def test_vacancy_url(url):
    assert vacancy_url(url) == "https://hh.ru/vacancy/123"


@pytest.mark.parametrize(
    "url",
    [
        "http://hh.ru/vacancy/123",
        "https://hh.ru.evil.com/vacancy/123",
        "https://evil.com/vacancy/123",
        "https://hh.ru/account/login",
        "https://user@hh.ru/vacancy/123",
        "https://hh.ru:999/vacancy/123",
    ],
)
def test_reject_url(url):
    with pytest.raises(ValueError):
        vacancy_url(url)


async def test_origin_and_validation(client):
    assert (
        await client.post("/api/hh-browser/open", json={}, headers={"Origin": "https://evil.com"})
    ).status_code == 403
    assert (await client.post("/api/hh-browser/open")).status_code == 415
    assert (await client.post("/api/hh-browser/search", json={"query": "  "})).status_code == 422


async def test_search_import_deduplicated(client, monkeypatch):
    async def search(query):
        return [
            {
                "external_id": "123",
                "provider": "hh_browser",
                "title": "Python",
                "company": "Test",
                "url": "https://hh.ru/vacancy/123",
            }
        ]

    monkeypatch.setattr("app.api.hh_browser.hh_browser.search", search)
    first = await client.post("/api/hh-browser/search", json={"query": "Python"})
    assert first.status_code == 200
    assert first.json()["saved"] == 1
    assert (await client.post("/api/hh-browser/search", json={"query": "Python"})).json()[
        "saved"
    ] == 0


async def test_recommendations_require_exact_hh_resume(client, monkeypatch):
    assert (
        await client.post("/api/hh-browser/recommendations", json={"resume_id": "missing"})
    ).status_code == 409
