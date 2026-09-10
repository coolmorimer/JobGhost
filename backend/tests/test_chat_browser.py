async def test_chat_validation(client):
    assert (await client.post("/api/chat-browser/ask", json={"question": " "})).status_code == 422
    assert (
        await client.post("/api/chat-browser/ask", json={"question": "test", "image": "!!!"})
    ).status_code == 422
    assert (
        await client.post(
            "/api/chat-browser/open", json={}, headers={"Origin": "https://evil.example"}
        )
    ).status_code == 403


async def test_chat_answer_contract(client, monkeypatch):
    async def ask(question, picture):
        assert question == "test"
        assert picture is None
        return {"answer": "fixture only", "channel": "chatgpt_browser"}

    monkeypatch.setattr("app.api.chat_browser.chat_browser.ask", ask)
    result = await client.post("/api/chat-browser/ask", json={"question": "test"})
    assert result.status_code == 200
    assert result.json()["answer"] == "fixture only"


async def test_session_role_uses_resume_and_strips_contacts(client, monkeypatch):
    from app.db.models import Resume
    from app.db.session import SessionLocal

    async with SessionLocal() as db:
        resume = Resume(
            name="Python HH",
            hh_resume_id="resume-role",
            description="Python FastAPI\nmail@example.com\n+7 999 123-45-67",
        )
        db.add(resume)
        await db.commit()
        resume_id = resume.id

    async def ask(prompt):
        assert "Python FastAPI" in prompt
        assert "mail@example.com" not in prompt
        assert "+7 999 123-45-67" not in prompt
        assert len(prompt) < 10000
        return {"answer": "Роль по резюме загружена.", "channel": "chatgpt_extension"}

    monkeypatch.setattr("app.api.chat_browser.chat_browser.ask", ask)
    result = await client.post(
        "/api/chat-browser/session/start", json={"resume_id": resume_id}
    )
    assert result.status_code == 200
    assert result.json()["initialized"] is True
    assert result.json()["resume"] == "Python HH"
