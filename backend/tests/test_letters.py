import pytest

from app.api.letters import validate_generated_letter
from app.db.models import Application, Resume, Vacancy
from app.db.session import SessionLocal


def test_letter_rejects_placeholders_and_unsupported_numbers():
    resume = Resume(name="Python", description="Опыт 2 года")
    vacancy = Vacancy(title="Python",company="Компания")
    text = "Разрабатываю сервисы на Python. " * 22
    validate_generated_letter(text, resume, vacancy)
    for suffix in [" [Имя]", " Ускорил на 90%."]:
        with pytest.raises(ValueError):
            validate_generated_letter(text + suffix, resume, vacancy)


@pytest.mark.parametrize("provider", ["openai", "openrouter"])
async def test_letter_uses_selected_api_not_browser(monkeypatch, provider):
    from app.api.letters import generate_letter
    captured = []
    monkeypatch.setattr("app.api.letters.ai_provider.options", lambda: {"provider": provider})

    async def stream(prompt, image, *, role):
        captured.append((prompt, image, role))
        yield "Подтверждённый опыт. "
        yield "Конец письма."

    async def browser(*args):
        raise AssertionError("Browser must not be called for API letters")

    monkeypatch.setattr("app.api.letters.ai_provider.stream_answer", stream)
    monkeypatch.setattr("app.api.letters.chat_browser.ask", browser)
    assert await generate_letter("Факты резюме") == "Подтверждённый опыт. Конец письма."
    assert captured[0][0] == "Факты резюме"
    assert "Не выдумывай" in captured[0][2]


async def fixture():
    async with SessionLocal() as db:
        resume = Resume(
            name="Fullstack",
            hh_resume_id="test",
            description="Контакты\nprivate@example.com\nОпыт работы: Python",
        )
        vacancy = Vacancy(
            provider="hh_browser",
            external_id="letter-test",
            url="https://hh.ru/vacancy/0",
            title="Python developer",
            company="Test",
            description="Python",
        )
        vacancy.raw_data = {"source": "visible_vacancy_detail"}
        db.add_all([resume, vacancy])
        await db.flush()
        application = Application(
            vacancy_id=vacancy.id, resume_id=resume.id, cover_letter="Исходный черновик"
        )
        db.add(application)
        await db.commit()
        return application.id


async def test_preview_and_save(client):
    aid = await fixture()
    result = (await client.get(f"/api/application-letters/{aid}")).json()
    assert "private@example.com" not in result["prompt"]
    assert "Опыт работы: Python" in result["prompt"]
    assert (
        await client.post(f"/api/application-letters/{aid}/save", json={"text": "коротко"})
    ).status_code == 422
    letter = "Подтверждённый опыт разработки. " * 25
    response = await client.post(f"/api/application-letters/{aid}/save", json={"text": letter})
    assert response.status_code == 200
    async with SessionLocal() as db:
        application = await db.get(Application, aid)
        assert application.cover_letter == letter.strip()
        assert application.sent_at is None


async def test_failure_preserves_draft(client, monkeypatch):
    aid = await fixture()

    async def fail(*args):
        raise ValueError("login blocked")

    monkeypatch.setattr("app.api.letters.generate_letter", fail)
    assert (
        await client.post(f"/api/application-letters/{aid}/generate", json={})
    ).status_code == 409
    assert (await client.get(f"/api/application-letters/{aid}")).json()[
        "text"
    ] == "Исходный черновик"


async def test_generation_requires_review(client, monkeypatch):
    aid = await fixture()

    async def generate(*args):
        return "Тестовое письмо без отправки. " * 25

    monkeypatch.setattr("app.api.letters.generate_letter", generate)
    response = await client.post(f"/api/application-letters/{aid}/generate", json={})
    assert response.status_code == 200
    assert response.json()["requires_review"]
