import pytest


@pytest.mark.asyncio
async def test_end_to_end_dry_run(client):
    assert (await client.get("/api/health")).json() == {"status": "ok"}
    result = (await client.post("/api/vacancies/search?query=Python")).json()
    assert result["saved"] > 0
    vacancies = (await client.get("/api/vacancies")).json()
    vacancy = vacancies[0]
    resumes = (await client.get("/api/resumes")).json()
    score = {
        "vacancy_id": vacancy["id"],
        "score": 90,
        "decision": "apply",
        "strengths": ["Python"],
        "gaps": [],
        "risks": [],
        "reason": "Strong fit",
        "best_resume_id": resumes[0]["id"],
    }
    assert (await client.post("/api/scores", json=score)).status_code == 200
    app = (
        await client.post(
            "/api/applications",
            json={
                "vacancy_id": vacancy["id"],
                "resume_id": resumes[0]["id"],
                "cover_letter": "draft",
                "mode": "MANUAL",
            },
        )
    ).json()
    sent = (await client.post(f"/api/applications/{app['id']}/send")).json()
    assert sent["status"] == "DRY_RUN_VALIDATED" and sent["dry_run"] is True
    assert sent["sent_at"] is None and sent["provider_application_id"] is None


@pytest.mark.asyncio
async def test_profile_roundtrip(client):
    profile = (await client.get("/api/profile")).json()
    profile.pop("id")
    profile["name"] = "Test Candidate"
    response = await client.put("/api/profile", json=profile)
    assert response.json()["name"] == "Test Candidate"


@pytest.mark.asyncio
async def test_interview_transcript(client):
    await client.post("/api/vacancies/search?query=Python")
    vacancy = (await client.get("/api/vacancies")).json()[0]
    session = (await client.post(f"/api/interviews?vacancy_id={vacancy['id']}")).json()
    row = (
        await client.post(
            f"/api/interviews/{session['id']}/transcript",
            json={"text": "Как устроен event loop?", "speaker": "interviewer"},
        )
    ).json()
    assert row["is_question"]
    transcript = (await client.get(f"/api/interviews/{session['id']}/transcript")).json()
    assert transcript[0]["text"].endswith("?")
