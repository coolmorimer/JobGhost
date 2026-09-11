import base64


async def test_speech_not_ready(client, monkeypatch):
    monkeypatch.setattr("app.api.speech.speech.model", None)
    assert (await client.post("/api/speech/transcribe", json={"audio": "YQ=="})).status_code == 409


async def test_speech_validation_and_question(client, monkeypatch):
    monkeypatch.setattr("app.api.speech.speech.model", object())
    monkeypatch.setattr(
        "app.api.speech.speech.transcribe",
        lambda content, **kwargs: {
            "text": "Как работает Python?",
            "language": "ru",
            "local": True,
        },
    )
    assert (await client.post("/api/speech/transcribe", json={"audio": "!!!"})).status_code == 422
    result = await client.post(
        "/api/speech/transcribe", json={"audio": base64.b64encode(b"test fixture").decode()}
    )
    assert result.status_code == 200
    assert result.json()["is_question"] is True
    assert result.json()["local"] is True


async def test_openai_speech_does_not_require_local_model(client, monkeypatch):
    monkeypatch.setattr("app.api.speech.speech.model", None)

    async def transcribe(content, **kwargs):
        assert content == b"cloud fixture"
        assert kwargs["language"] == "ru"
        return {"text": "Почему нужен event loop?", "language": "ru", "local": False}

    monkeypatch.setattr("app.api.speech.ai_provider.transcribe_audio", transcribe)
    response = await client.post(
        "/api/speech/transcribe",
        json={
            "audio": base64.b64encode(b"cloud fixture").decode(),
            "engine": "openai",
            "language": "ru",
        },
    )
    assert response.status_code == 200
    assert response.json()["is_question"] is True
    assert response.json()["local"] is False


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


def test_transcript_normalization_changes_only_high_confidence_technical_terms():
    from app.services.speech import normalize_transcript

    assert normalize_transcript("Что такое Nod, fast API и кубернетес?") == (
        "Что такое Node, FastAPI и Kubernetes?"
    )
    assert normalize_transcript("Please nod if you understand") == "Please nod if you understand"


def test_local_speech_prefers_cuda_when_float16_is_available(monkeypatch):
    from app.services.speech import LocalSpeech

    monkeypatch.delenv("JOBGHOST_SPEECH_DEVICE", raising=False)
    monkeypatch.setattr(
        "ctranslate2.get_supported_compute_types", lambda device: {"float16"} if device == "cuda" else {"int8"}
    )
    assert LocalSpeech._runtime_options() == [("cuda", "float16"), ("cpu", "int8")]


def test_local_speech_can_be_forced_to_cpu(monkeypatch):
    from app.services.speech import LocalSpeech

    monkeypatch.setenv("JOBGHOST_SPEECH_DEVICE", "cpu")
    assert LocalSpeech._runtime_options() == [("cpu", "int8")]


def test_failed_cuda_probe_never_leaves_model_ready(monkeypatch):
    import faster_whisper
    import pytest

    from app.services.speech import LocalSpeech

    class BrokenCudaModel:
        def __init__(self, _source, *, device, **_kwargs):
            if device == "cpu":
                raise RuntimeError("cpu unavailable")

        def transcribe(self, *_args, **_kwargs):
            raise RuntimeError("CUDA probe failed")

    service = LocalSpeech()
    monkeypatch.setattr(service, "_runtime_options", lambda: [("cuda", "float16"), ("cpu", "int8")])
    monkeypatch.setattr(faster_whisper, "WhisperModel", BrokenCudaModel)
    with pytest.raises(RuntimeError):
        service.load()
    assert service.state == "error"
    assert service.model is None


def test_realtime_session_uses_bilingual_live_transcription_and_long_vad():
    from app.api.speech import realtime_session_update

    audio = realtime_session_update()["session"]["audio"]["input"]
    assert audio["format"] == {"type": "audio/pcm", "rate": 24000}
    assert audio["transcription"]["model"] == "gpt-live-transcribe"
    assert audio["transcription"]["languages"] == ["ru", "en"]
    assert audio["turn_detection"] is None
