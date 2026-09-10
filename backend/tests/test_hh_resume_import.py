from sqlalchemy import select

from app.db.models import Resume
from app.db.session import SessionLocal


async def test_resume_import_is_local_and_deduplicated(client, monkeypatch):
    async def read():
        return [{"id": "abc123", "title": "FullstackОбновлено", "heading": "Fullstack", "text": "Опыт работы\nPython"}]
    monkeypatch.setattr("app.api.hh_browser.hh_browser.read_resumes", read)
    first = await client.post("/api/hh-browser/resumes/import", json={})
    second = await client.post("/api/hh-browser/resumes/import", json={})
    assert first.status_code == 200
    assert first.json()["resumes"] == second.json()["resumes"]
    assert first.json()["resumes"][0]["name"] == "Fullstack"
    async with SessionLocal() as db:
        rows = (await db.scalars(select(Resume).where(Resume.hh_resume_id == "abc123"))).all()
        assert len(rows) == 1
        assert rows[0].description == "Опыт работы\nPython"
