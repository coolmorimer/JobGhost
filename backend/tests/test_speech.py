import base64


async def test_speech_not_ready(client, monkeypatch):
    monkeypatch.setattr("app.api.speech.speech.model", None)
    assert (await client.post("/api/speech/transcribe", json={"audio": "YQ=="})).status_code == 409


async def test_speech_validation_and_question(client, monkeypatch):
    monkeypatch.setattr("app.api.speech.speech.model", object())
    monkeypatch.setattr(
        "app.api.speech.speech.transcribe",
        lambda content: {"text": "Как работает Python?", "language": "ru", "local": True},
    )
    assert (await client.post("/api/speech/transcribe", json={"audio": "!!!"})).status_code == 422
    result = await client.post(
        "/api/speech/transcribe", json={"audio": base64.b64encode(b"test fixture").decode()}
    )
    assert result.status_code == 200
    assert result.json()["is_question"] is True
    assert result.json()["local"] is True


async def test_speech_blocks_external_origin(client):
    assert (
        await client.post("/api/speech/load", json={}, headers={"Origin": "https://evil.example"})
    ).status_code == 403


async def test_question_detection_understands_russian_and_english_interview_phrases():
    from app.services.core import detect_question

    assert detect_question("Ну расскажите о вашем опыте с Kubernetes")
    assert detect_question("Расскажите, как работает асинхронное программирование")
    assert detect_question("Could you explain how an event loop works")
    assert detect_question("Walk me through your last Python project")
    assert not detect_question("Я работал с Python и FastAPI")
    assert not detect_question("OK")
