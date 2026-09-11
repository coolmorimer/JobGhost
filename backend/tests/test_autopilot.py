import asyncio

import pytest

from app.db.models import Resume, Vacancy
from app.db.session import SessionLocal
from app.workers.autopilot import Autopilot, PilotConfig


async def test_cycle_saved_and_pause(monkeypatch):
    pilot = Autopilot()

    async def mode(enabled):
        assert enabled

    async def search(data, db):
        return {"found": 2, "saved": 1}

    monkeypatch.setattr("app.workers.autopilot.hh_browser.set_background", mode)
    monkeypatch.setattr("app.workers.autopilot.search", search)
    await pilot.start(PilotConfig(query="Python", interval_minutes=5))
    for _ in range(100):
        if pilot.state.get("next_run"):
            break
        await asyncio.sleep(0.01)
    assert pilot.state["result"]["saved"] == 1
    await pilot.shutdown()
    restored = Autopilot()
    await restored.restore()
    assert restored.state["enabled"]
    assert len(restored.state["history"]) == 1
    await restored.pause()
    assert restored.task is None
    assert restored.state["status"] == "paused"


async def test_failure_stops_without_retry(monkeypatch):
    pilot = Autopilot()

    async def fail(enabled):
        raise ValueError("blocked")

    monkeypatch.setattr("app.workers.autopilot.hh_browser.set_background", fail)
    pilot.state.update(enabled=True, query="Python", interval_minutes=5)
    await pilot.loop()
    assert pilot.state["status"] == "needs_attention"
    assert pilot.state["enabled"] is False
    assert pilot.state["error"] == "blocked"


async def test_bad_config(client):
    assert (
        await client.post("/api/autopilot/start", json={"query": "Python", "interval_minutes": 1})
    ).status_code == 422
    assert (await client.post("/api/autopilot/start", json={"query": " "})).status_code == 422
    assert (await client.get("/api/autopilot/status")).json()["mode"] == "search_only"
    with pytest.raises(ValueError):
        PilotConfig(query="Python", auto_apply=True)


async def test_auto_apply_builds_letter_and_sends_only_one(monkeypatch):
    async with SessionLocal() as db:
        resume = Resume(
            name="Основное HH", hh_resume_id="resume123", description="Python FastAPI"
        )
        vacancies = [
            Vacancy(
                provider="hh_browser",
                external_id=f"auto-{index}",
                url=f"https://hh.ru/vacancy/{100 + index}",
                title="Python developer",
                company="Test company",
            )
            for index in range(2)
        ]
        db.add_all([resume, *vacancies])
        await db.commit()
        resume_id = resume.id
        vacancy_ids = [vacancy.id for vacancy in vacancies]

    async def detail(_url):
        return {
            "title": "Python developer",
            "description": "Подробное описание " * 20,
            "skills": ["Python"],
            "source": "visible_vacancy_detail",
        }

    async def answer(_prompt):
        return "П" * 700

    sent = []

    async def send(_db, application_id, **options):
        sent.append((application_id, options))

    monkeypatch.setattr("app.workers.autopilot.hh_browser.read_vacancy", detail)
    monkeypatch.setattr("app.workers.autopilot.generate_letter", answer)
    monkeypatch.setattr("app.workers.autopilot.send_application", send)
    pilot = Autopilot()
    pilot.state.update(auto_apply=True, resume_id=resume_id)
    result = await pilot._apply_one(vacancy_ids)
    assert result == {"applied": 1, "skipped": 0}
    assert len(sent) == 1
    assert sent[0][1] == {"confirmed_real": True, "require_score": False}
    # An existing draft must not be re-generated or reset, even if result is uncertain.
    from app.db.models import Application
    async with SessionLocal() as db:
        application = await db.get(Application, sent[0][0])
        application.status = "NEEDS_REVIEW"
        await db.commit()
    sent.clear()
    result = await pilot._apply_one(vacancy_ids[:1])
    assert result == {"applied": 0, "skipped": 1}
    assert not sent
    pilot.state.update(prepare_only=True)
    result = await pilot._apply_one(vacancy_ids[1:])
    assert result == {"applied": 0, "prepared": 1, "skipped": 0}
    assert not sent


def test_pilot_limits_and_safe_default():
    config = PilotConfig(query="Python",auto_apply=True,resume_id="resume")
    assert config.prepare_only is True
    with pytest.raises(ValueError):
        PilotConfig(query="Python",daily_limit=51)
