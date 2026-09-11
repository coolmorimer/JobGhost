"""Application-flow regression tests. HH dispatch is always mocked here."""

from app.core.config import get_settings
from app.db.models import Resume, Vacancy
from app.db.session import SessionLocal


async def prepare_fixture(client, resume_id=None, letter=""):
    async with SessionLocal() as db:
        vacancy = Vacancy(
            provider="hh_browser",
            external_id="audit-only",
            url="https://hh.ru/vacancy/0",
            title="Audit Python",
            company="AUDIT ONLY",
        )
        resume = Resume(
            name="HH audit resume", hh_resume_id="audit-resume", description="Python experience"
        )
        db.add_all([vacancy, resume])
        await db.commit()
        vacancy_id, real_resume_id = vacancy.id, resume.id
    await client.post(
        "/api/scores",
        json={
            "vacancy_id": vacancy_id,
            "score": 95,
            "decision": "apply",
            "best_resume_id": real_resume_id,
        },
    )
    payload = {"vacancy_id": vacancy_id, "cover_letter": letter}
    if resume_id != "omit":
        payload["resume_id"] = resume_id or real_resume_id
    response = await client.post("/api/applications", json=payload)
    return response, real_resume_id


async def test_send_rejects_empty_letter(client):
    response, _ = await prepare_fixture(client)
    sent = await client.post(f"/api/applications/{response.json()['id']}/send")
    assert sent.status_code == 400


async def test_dry_run_does_not_claim_sent(client):
    response, _ = await prepare_fixture(client, letter="Audit draft")
    sent = await client.post(f"/api/applications/{response.json()['id']}/send")
    assert sent.json()["status"] != "APPLIED"


async def test_missing_resume_rejected(client):
    response, _ = await prepare_fixture(client, resume_id="nonexistent-resume")
    assert response.status_code == 400


async def test_resume_selection_uses_hh_resume(client):
    response, expected = await prepare_fixture(client, resume_id="omit")
    assert response.json()["resume_id"] == expected


async def test_real_hh_dispatch_uses_selected_resume_and_marks_sent(client, monkeypatch):
    calls = []

    async def apply(url, resume_id, letter):
        calls.append((url, resume_id, letter))
        return {"id": "hh:audit-only", "state": "sent"}

    monkeypatch.setattr("app.connectors.hh_browser.hh_browser.apply", apply)
    monkeypatch.setattr(get_settings(), "dry_run", False)
    response, _ = await prepare_fixture(client, letter="Audit draft; not sent")
    sent = await client.post(f"/api/applications/{response.json()['id']}/send")
    assert sent.status_code == 200
    assert sent.json()["status"] == "APPLIED"
    assert calls == [
        ("https://hh.ru/vacancy/0", "audit-resume", "Audit draft; not sent")
    ]
    applications = (await client.get("/api/applications")).json()
    assert applications[0]["sent_at"] is not None


async def test_prepare_does_not_generate_letter(client):
    response, _ = await prepare_fixture(client)
    assert response.json()["cover_letter"] == ""


async def test_uncertain_hh_result_blocks_retry(client, monkeypatch):
    calls = []

    async def apply(*args):
        calls.append(args)
        raise ValueError("HH did not confirm submission")

    monkeypatch.setattr("app.connectors.hh_browser.hh_browser.apply", apply)
    monkeypatch.setattr(get_settings(), "dry_run", False)
    response, _ = await prepare_fixture(client, letter="Audit draft; not sent")
    endpoint = f"/api/applications/{response.json()['id']}/send"
    assert (await client.post(endpoint)).status_code == 400
    assert (await client.get('/api/applications')).json()[0]['status'] == 'NEEDS_REVIEW'
    assert (await client.post(endpoint)).status_code == 400
    assert len(calls) == 1
