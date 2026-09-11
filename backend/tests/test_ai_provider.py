import json

import httpx
import pytest

from app.services.ai_provider import AIProviderError, AIProviderService


async def collect(stream):
    return "".join([part async for part in stream])


async def test_structured_router_excludes_models_without_schema(monkeypatch):
    captured = {}
    def handler(request):
        if request.url.path.endswith('/models'):
            return httpx.Response(200, json={'data': [
                {'id':'fast/unsupported:free','pricing':{'prompt':0,'completion':0}},
                {'id':'valid/structured:free','pricing':{'prompt':0,'completion':0},'supported_parameters':['structured_outputs']},
            ]})
        captured.update(json.loads(request.content))
        return httpx.Response(200,text='data: {"choices":[{"delta":{"content":"{}"}}]}\n\n')
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = AIProviderService(client)
        monkeypatch.setattr(service, 'options', lambda: {'provider':'openrouter','openrouter_model':'auto'})
        monkeypatch.setattr(service, '_key', lambda _: 'fixture')
        await collect(service.stream_answer('JSON',None,json_schema={'type':'object'}))
    assert captured['models'] == ['valid/structured:free']
    assert captured['provider']['require_parameters'] is True
    assert captured['response_format']['type'] == 'json_schema'


async def test_openrouter_reports_exhausted_output_budget(monkeypatch):
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text='data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')))
    service = AIProviderService(client)
    monkeypatch.setattr(service, "options", lambda: {"provider": "openrouter", "openrouter_model": "vendor/model:free"})
    monkeypatch.setattr(service, "_key", lambda provider: "test-key")
    with pytest.raises(AIProviderError, match="исчерпала лимит"):
        await collect(service._openrouter_stream("test", None))
    await client.aclose()


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
    service.set_role("Роль из выбранного резюме")
    assert await collect(service.stream_answer("Что такое API?", None)) == "Очень быстро"
    assert captured["model"] == "gpt-4o-mini"
    assert captured["stream"] is True
    assert captured["store"] is False
    assert captured["instructions"] == "Роль из выбранного резюме"
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
                            "id": "fast/model-two:free",
                            "name": "Fast Free Two",
                            "pricing": {"prompt": 0, "completion": 0},
                            "architecture": {"output_modalities": ["text"]},
                        },
                        {
                            "id": "fast/model-three:free",
                            "name": "Fast Free Three",
                            "pricing": {"prompt": 0, "completion": 0},
                            "architecture": {"output_modalities": ["text"]},
                        },
                        {
                            "id": "fast/model-four:free",
                            "name": "Fast Free Four",
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
    service.set_role("Роль из выбранного резюме")
    assert await collect(service.stream_answer("Вопрос", None)) == "Поток работает"
    assert captured["models"] == [
        "fast/model:free",
        "fast/model-two:free",
        "fast/model-three:free",
    ]
    assert captured["provider"]["sort"] == {"by": "latency", "partition": "none"}
    assert captured["max_tokens"] == 4096
    assert captured["reasoning"] == {"effort": "low", "exclude": True}
    assert captured["messages"][0] == {
        "role": "system",
        "content": "Роль из выбранного резюме",
    }
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


async def test_custom_session_does_not_load_resume(client, monkeypatch):
    captured = []
    monkeypatch.setattr("app.api.ai.ai_provider.ensure_ready", lambda: _async_value(None))
    monkeypatch.setattr("app.api.ai.ai_provider.options", lambda: {"provider": "openrouter"})
    monkeypatch.setattr("app.api.ai.ai_provider.set_role", captured.append)
    result = await client.post('/api/ai/session/start', json={"context_mode":"custom", "custom_prompt":"Отвечай кратко", "resume_id":"nonexistent"})
    assert result.status_code == 200
    assert result.json()['resume_id'] is None
    assert 'Отвечай кратко' in captured[0]
    assert 'РЕЗЮМЕ:' not in captured[0]
    assert (await client.post('/api/ai/session/start', json={"context_mode":"custom"})).status_code == 422


def test_provider_error_is_user_facing():
    assert str(AIProviderError("Нет ключа")) == "Нет ключа"


async def test_session_start_installs_resume_role_for_api_requests(client, monkeypatch):
    captured = {}

    async def ready():
        return None

    monkeypatch.setattr("app.api.ai.ai_provider.ensure_ready", ready)
    monkeypatch.setattr(
        "app.api.ai.ai_provider.options",
        lambda: {
            "provider": "openai",
            "openai_model": "gpt-4o-mini",
            "openrouter_model": "auto",
        },
    )
    monkeypatch.setattr(
        "app.api.ai.ai_provider.set_role",
        lambda value: captured.setdefault("role", value),
    )
    resume = (await client.get("/api/resumes")).json()[0]
    response = await client.post("/api/ai/session/start", json={"resume_id": resume["id"]})
    assert response.status_code == 200
    assert response.json()["channel"] == "openai"
    assert resume["name"] in captured["role"]
    assert "не выдумывай" in captured["role"].lower()
