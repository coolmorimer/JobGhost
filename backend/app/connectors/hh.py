from typing import Any
from urllib.parse import urlencode

import httpx
import keyring

from app.connectors.base import VacancyProvider
from app.core.config import get_settings


class HHProvider(VacancyProvider):
    api = "https://api.hh.ru"
    auth = "https://hh.ru/oauth/authorize"

    def authorization_url(self, redirect_uri: str, state: str) -> str:
        cfg = get_settings()
        return f"{self.auth}?{urlencode({'response_type': 'code', 'client_id': cfg.hh_client_id, 'redirect_uri': redirect_uri, 'state': state})}"

    def _token(self) -> str:
        return keyring.get_password("JobGhost", "hh_access_token") or ""

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = {"User-Agent": "JobGhost/0.1 (local job copilot)", **kwargs.pop("headers", {})}
        if token := self._token():
            headers["Authorization"] = f"Bearer {token}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.request(method, f"{self.api}{path}", headers=headers, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else {}

    async def exchange_code(self, code: str, redirect_uri: str) -> None:
        cfg = get_settings()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://hh.ru/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": cfg.hh_client_id,
                    "client_secret": cfg.hh_client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
            )
            response.raise_for_status()
            data = response.json()
        keyring.set_password("JobGhost", "hh_access_token", data["access_token"])
        if data.get("refresh_token"):
            keyring.set_password("JobGhost", "hh_refresh_token", data["refresh_token"])

    async def search(self, **params: Any) -> list[dict[str, Any]]:
        data = await self._request("GET", "/vacancies", params=params)
        return data.get("items", [])

    async def get_vacancy(self, vacancy_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/vacancies/{vacancy_id}")

    async def get_company(self, company_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/employers/{company_id}")

    async def apply(self, vacancy_id: str, resume_id: str, cover_letter: str) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/negotiations",
            data={"vacancy_id": vacancy_id, "resume_id": resume_id, "message": cover_letter},
        )

    async def get_applications(self) -> list[dict[str, Any]]:
        return (await self._request("GET", "/negotiations")).get("items", [])

    async def get_messages(self) -> list[dict[str, Any]]:
        return []
