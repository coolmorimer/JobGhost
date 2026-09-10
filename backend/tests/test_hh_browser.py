import pytest

from app.connectors.hh_browser import vacancy_url


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
