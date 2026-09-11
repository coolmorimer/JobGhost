from app.db.models import Application, Resume, Vacancy
from app.db.session import SessionLocal


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
