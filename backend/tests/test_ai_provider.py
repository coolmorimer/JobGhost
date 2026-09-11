import json

import httpx

from app.services.ai_provider import AIProviderError, AIProviderService


async def collect(stream):
    return "".join([part async for part in stream])


async def test_openai_responses_are_streamed_and_not_stored(monkeypatch):
    captured = {}

    async def handler(request: httpx.Request):
        captured.update(json.loads((await request.aread()).decode()))
        return httpx.Response(
            200,
            text=(
                'data: {"type":"response.output_text.delta","delta":"Очень "}\n\n'
                'data: {"type":"response.output_text.delta","delta":"быстро"}\n\n'
                "data: [DONE]\n\n"
            ),
            headers={"Content-Type": "text/event-stream"},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = AIProviderService(client)
    monkeypatch.setattr(
        service,
        "options",
        lambda: {
            "provider": "openai",
            "openai_model": "gpt-4o-mini",
            "openrouter_model": "auto",
        },
    )
    monkeypatch.setattr(service, "_key", lambda provider: "test-key")
    assert await collect(service.stream_answer("Что такое API?", None)) == "Очень быстро"
    assert captured["model"] == "gpt-4o-mini"
    assert captured["stream"] is True
    assert captured["store"] is False
    assert captured["input"][0]["content"][0]["type"] == "input_text"
    await client.aclose()


async def test_openrouter_auto_uses_fastest_free_models(monkeypatch):
    captured = {}

    async def handler(request: httpx.Request):
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "fast/content-safety:free",
                            "name": "Content Safety",
                            "pricing": {"prompt": 0, "completion": 0},
                            "architecture": {"output_modalities": ["text"]},
                        },
                        {
                            "id": "fast/model:free",
                            "name": "Fast Free",
                            "pricing": {"prompt": 0, "completion": 0},
                            "architecture": {"output_modalities": ["text"]},
                        },
                        {
                            "id": "paid/model",
                            "pricing": {"prompt": "0.1", "completion": "0.1"},
                        },
                    ]
                },
            )
        captured.update(json.loads((await request.aread()).decode()))
        return httpx.Response(
            200,
            text=(
                'data: {"choices":[{"delta":{"content":"Поток"}}]}\n\n'
                'data: {"choices":[{"delta":{"content":" работает"}}]}\n\n'
                "data: [DONE]\n\n"
            ),
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = AIProviderService(client)
    monkeypatch.setattr(
        service,
        "options",
        lambda: {
            "provider": "openrouter",
            "openai_model": "gpt-4o-mini",
            "openrouter_model": "auto",
        },
    )
    monkeypatch.setattr(service, "_key", lambda provider: "test-key")
    assert await collect(service.stream_answer("Вопрос", None)) == "Поток работает"
    assert captured["models"] == ["fast/model:free"]
    assert captured["provider"]["sort"] == {"by": "latency", "partition": "none"}
    await client.aclose()


async def test_openai_audio_transcription_keeps_key_on_backend(monkeypatch):
    captured = {}

    async def handler(request: httpx.Request):
        captured["url"] = str(request.url)
        captured["authorization"] = request.headers.get("authorization")
        captured["body"] = (await request.aread()).decode(errors="ignore")
        return httpx.Response(200, json={"text": "Как работает Kubernetes?"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = AIProviderService(client)
    monkeypatch.setattr(service, "_key", lambda provider: "secret-test-key")
    result = await service.transcribe_audio(b"audio", language="ru", context="Контекст")
    assert result["text"] == "Как работает Kubernetes?"
    assert result["local"] is False
    assert captured["url"].endswith("/v1/audio/transcriptions")
    assert captured["authorization"] == "Bearer secret-test-key"
    assert "gpt-4o-mini-transcribe" in captured["body"]
    assert "secret-test-key" not in captured["body"]
    await client.aclose()


def test_openrouter_rejects_paid_or_arbitrary_model():
    assert AIProviderService._valid_openrouter_model("vendor/model:free") is True
    assert AIProviderService._valid_openrouter_model("vendor/model") is False
    assert AIProviderService._valid_openrouter_model("openrouter/free") is True


async def test_ai_settings_never_return_secret(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.ai.ai_provider.public_settings",
        lambda: _async_value(
            {
                "provider": "openai",
                "openai_model": "gpt-4o-mini",
                "openrouter_model": "auto",
                "openai_key_saved": True,
                "openrouter_key_saved": False,
                "openai_models": [],
            }
        ),
    )
    response = await client.get("/api/ai/settings")
    assert response.status_code == 200
    assert "api_key" not in response.text
    assert "test-key" not in response.text


async def _async_value(value):
    return value


def test_provider_error_is_user_facing():
    assert str(AIProviderError("Нет ключа")) == "Нет ключа"
