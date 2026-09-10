from abc import ABC, abstractmethod
from typing import Any


class VacancyProvider(ABC):
    @abstractmethod
    async def search(self, **params: Any) -> list[dict[str, Any]]: ...
    @abstractmethod
    async def get_vacancy(self, vacancy_id: str) -> dict[str, Any]: ...
    async def get_company(self, company_id: str) -> dict[str, Any]:
        return {}

    @abstractmethod
    async def apply(self, vacancy_id: str, resume_id: str, cover_letter: str) -> dict[str, Any]: ...
    async def get_applications(self) -> list[dict[str, Any]]:
        return []

    async def get_messages(self) -> list[dict[str, Any]]:
        return []
