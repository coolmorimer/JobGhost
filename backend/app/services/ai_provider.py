from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import keyring
from keyring.errors import PasswordDeleteError

from app.connectors.chat_bridge import chat_bridge

OPENAI_MODELS = (
    {"id": "gpt-4o-mini", "name": "GPT-4o mini — быстрый и надёжный"},
    {"id": "gpt-5.6-luna", "name": "GPT-5.6 Luna — новый быстрый"},
    {"id": "gpt-5.4-nano", "name": "GPT-5.4 nano — минимальная задержка"},
    {"id": "gpt-5.4-mini", "name": "GPT-5.4 mini — больше качества"},
)
PROVIDERS = {"browser", "openai", "openrouter"}
KEY_ACCOUNTS = {"openai": "openai_api_key", "openrouter": "openrouter_api_key"}
DEFAULT_INSTRUCTIONS = (
    "Ты быстрый помощник на техническом интервью. Отвечай на языке вопроса: "
    "сначала прямой ответ, затем 3–5 коротких пунктов. Не выдумывай личный опыт."
)
NON_CHAT_MODELS = ("content-safety", "moderation", "embedding", "rerank", "reward", "classifier")


class AIProviderError(ValueError):
    pass


class AIProviderService:
    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client
        self._owns_client = client is None
        self._lock = asyncio.Lock()
        self._role = ""
        self._catalog: list[dict[str, str]] = []
        self._catalog_at = 0.0

    @staticmethod
    def _data_dir() -> Path:
        if configured := os.environ.get("JOBGHOST_USER_DATA"):
            return Path(configured)
        return Path(__file__).resolve().parents[3] / ".jobghost"

    @classmethod
    def _settings_path(cls) -> Path:
        return cls._data_dir() / "ai-settings.json"

    def options(self) -> dict[str, str]:
        defaults = {
            "provider": "browser",
            "openai_model": "gpt-4o-mini",
            "openrouter_model": "auto",
        }
        try:
            stored = json.loads(self._settings_path().read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                defaults.update({key: str(value) for key, value in stored.items() if key in defaults})
        except (OSError, ValueError, TypeError):
            pass
        if defaults["provider"] not in PROVIDERS:
            defaults["provider"] = "browser"
        if defaults["openai_model"] not in {item["id"] for item in OPENAI_MODELS}:
            defaults["openai_model"] = "gpt-4o-mini"
        if not self._valid_openrouter_model(defaults["openrouter_model"]):
            defaults["openrouter_model"] = "auto"
        return defaults

    @staticmethod
    def _valid_openrouter_model(value: str) -> bool:
        return value in {"auto", "openrouter/free"} or bool(
            re.fullmatch(r"[a-z0-9_.-]+/[a-z0-9_.:-]+:free", value)
        )

    def save_options(self, provider: str, openai_model: str, openrouter_model: str) -> None:
        if provider not in PROVIDERS:
            raise AIProviderError("Неизвестный канал ИИ")
        if openai_model not in {item["id"] for item in OPENAI_MODELS}:
            raise AIProviderError("Выберите быструю модель OpenAI из списка")
        if not self._valid_openrouter_model(openrouter_model):
            raise AIProviderError("В OpenRouter разрешены только бесплатные модели")
        path = self._settings_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(
                {
                    "provider": provider,
                    "openai_model": openai_model,
                    "openrouter_model": openrouter_model,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        temporary.replace(path)

    @staticmethod
    def _key(provider: str) -> str:
        environment = os.environ.get("OPENAI_API_KEY" if provider == "openai" else "OPENROUTER_API_KEY")
        if environment:
            return environment.strip()
        try:
            return (keyring.get_password("JobGhost", KEY_ACCOUNTS[provider]) or "").strip()
        except Exception:
            return ""

    @staticmethod
    def save_key(provider: str, value: str) -> None:
        account = KEY_ACCOUNTS[provider]
        try:
            if value:
                if len(value.strip()) < 8:
                    raise AIProviderError("Ключ слишком короткий")
                keyring.set_password("JobGhost", account, value.strip())
            else:
                try:
                    keyring.delete_password("JobGhost", account)
                except PasswordDeleteError:
                    pass
        except AIProviderError:
            raise
        except Exception as exc:
            raise AIProviderError("Не удалось сохранить ключ в Windows Credential Manager") from exc

    async def public_settings(self) -> dict[str, Any]:
        options = self.options()
        return {
            **options,
            "openai_key_saved": bool(self._key("openai")),
            "openrouter_key_saved": bool(self._key("openrouter")),
            "openai_models": list(OPENAI_MODELS),
        }

    async def status(self) -> dict[str, Any]:
        options = self.options()
        provider = options["provider"]
        if provider == "browser":
            state = await chat_bridge.status()
            return {**state, "provider": provider, "label": "ChatGPT в Chrome"}
        key_saved = bool(self._key(provider))
        label = "OpenAI API" if provider == "openai" else "OpenRouter API"
        model = options[f"{provider}_model"]
        return {
            "state": "ready" if key_saved else "needs_key",
            "provider": provider,
            "label": label,
            "model": model,
            "message": (
                f"{label} готов · {model if model != 'auto' else 'авто: самая быстрая бесплатная'}"
                if key_saved
                else f"Добавьте API-ключ {label} в настройках"
            ),
        }

    async def ensure_ready(self) -> None:
        if (await self.status())["state"] != "ready":
            raise AIProviderError("Выбранный канал ИИ не настроен")

    def set_role(self, value: str) -> None:
        self._role = value

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5, read=45, write=10, pool=5),
                limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
            )
        return self._client

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def free_models(self, *, refresh: bool = False) -> list[dict[str, str]]:
        if self._catalog and not refresh and time.monotonic() - self._catalog_at < 600:
            return self._catalog
        client = await self._http()
        headers = {"Authorization": f"Bearer {self._key('openrouter')}"} if self._key("openrouter") else {}
        try:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                params={"sort": "latency-low-to-high"},
                headers=headers,
            )
            response.raise_for_status()
            models = []
            for item in response.json().get("data", []):
                pricing = item.get("pricing") or {}
                output = (item.get("architecture") or {}).get("output_modalities") or ["text"]
                model_id = str(item.get("id", ""))
                searchable = f"{model_id} {item.get('name', '')}".lower()
                try:
                    free = float(pricing.get("prompt", 1)) == 0 and float(
                        pricing.get("completion", 1)
                    ) == 0
                except (ValueError, TypeError):
                    free = False
                if (
                    self._valid_openrouter_model(model_id)
                    and "text" in output
                    and free
                    and not any(marker in searchable for marker in NON_CHAT_MODELS)
                ):
                    models.append({"id": model_id, "name": str(item.get("name") or model_id)})
                if len(models) >= 12:
                    break
            if models:
                self._catalog, self._catalog_at = models, time.monotonic()
        except (httpx.HTTPError, ValueError, TypeError):
            pass
        return self._catalog

    @staticmethod
    async def _upstream_error(response: httpx.Response, label: str) -> AIProviderError:
        await response.aread()
        message = ""
        try:
            payload = response.json()
            error = payload.get("error", payload)
            message = str(error.get("message", "")) if isinstance(error, dict) else str(error)
        except (ValueError, TypeError):
            pass
        return AIProviderError(f"{label}: {message or f'ошибка HTTP {response.status_code}'}"[:600])

    async def _openai_stream(self, question: str, image: str | None) -> AsyncIterator[str]:
        options = self.options()
        model = options["openai_model"]
        user_content: list[dict[str, str]] = [{"type": "input_text", "text": question}]
        if image:
            user_content.append(
                {"type": "input_image", "image_url": f"data:image/jpeg;base64,{image}"}
            )
        payload: dict[str, Any] = {
            "model": model,
            "instructions": self._role or DEFAULT_INSTRUCTIONS,
            "input": [{"role": "user", "content": user_content}],
            "stream": True,
            "store": False,
            "max_output_tokens": 700,
        }
        if model.startswith("gpt-5"):
            payload["reasoning"] = {"effort": "none"}
            payload["text"] = {"verbosity": "low"}
        client = await self._http()
        async with client.stream(
            "POST",
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {self._key('openai')}"},
            json=payload,
        ) as response:
            if response.status_code >= 400:
                raise await self._upstream_error(response, "OpenAI")
            emitted = False
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if event.get("type") == "response.output_text.delta" and event.get("delta"):
                    emitted = True
                    yield str(event["delta"])
                elif event.get("type") == "response.output_text.done" and not emitted and event.get("text"):
                    yield str(event["text"])
                elif event.get("type") == "error":
                    raise AIProviderError(f"OpenAI: {event.get('message') or 'ошибка потока'}")

    async def _openrouter_stream(self, question: str, image: str | None) -> AsyncIterator[str]:
        options = self.options()
        selected = options["openrouter_model"]
        user_content: Any = question
        if image:
            user_content = [
                {"type": "text", "text": question},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image}"}},
            ]
        payload: dict[str, Any] = {
            "messages": [
                {"role": "system", "content": self._role or DEFAULT_INSTRUCTIONS},
                {"role": "user", "content": user_content},
            ],
            "stream": True,
            "temperature": 0.2,
            "max_tokens": 700,
            "provider": {"sort": "latency", "allow_fallbacks": True},
        }
        if selected == "auto":
            fastest = await self.free_models()
            if fastest:
                payload["models"] = [item["id"] for item in fastest[:4]]
                payload["provider"]["sort"] = {"by": "latency", "partition": "none"}
            else:
                payload["model"] = "openrouter/free"
        else:
            payload["model"] = selected
        client = await self._http()
        async with client.stream(
            "POST",
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self._key('openrouter')}",
                "HTTP-Referer": "https://github.com/coolmorimer/JobGhost",
                "X-OpenRouter-Title": "JobGhost",
            },
            json=payload,
        ) as response:
            if response.status_code >= 400:
                raise await self._upstream_error(response, "OpenRouter")
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if event.get("error"):
                    error = event["error"]
                    raise AIProviderError(
                        f"OpenRouter: {error.get('message', 'ошибка потока') if isinstance(error, dict) else error}"
                    )
                choices = event.get("choices") or []
                content = (choices[0].get("delta") or {}).get("content") if choices else None
                if isinstance(content, str) and content:
                    yield content
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("text"):
                            yield str(part["text"])

    async def stream_answer(self, question: str, image: str | None) -> AsyncIterator[str]:
        async with self._lock:
            await self.ensure_ready()
            provider = self.options()["provider"]
            if provider == "openai":
                async for delta in self._openai_stream(question, image):
                    yield delta
            elif provider == "openrouter":
                async for delta in self._openrouter_stream(question, image):
                    yield delta
            else:
                picture = base64.b64decode(image) if image else None
                try:
                    result = await chat_bridge.ask(question, picture)
                except ValueError as exc:
                    raise AIProviderError(str(exc)) from exc
                answer = str(result.get("answer", ""))
                for part in re.findall(r"\S+\s*|\s+", answer):
                    yield part
                    await asyncio.sleep(0.006)


ai_provider = AIProviderService()
