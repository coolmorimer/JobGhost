from datetime import datetime, timedelta
from typing import Any

from app.connectors.base import VacancyProvider


class MockVacancyProvider(VacancyProvider):
    roles = [
        "Python Backend Developer",
        "AI Automation Engineer",
        "Fullstack Developer",
        "DevOps Engineer",
    ]
    skills = [
        ["Python", "FastAPI", "PostgreSQL"],
        ["Python", "Playwright", "AI"],
        ["React", "TypeScript", "Python"],
        ["Docker", "Kubernetes", "CI/CD"],
    ]

    async def search(self, **params: Any) -> list[dict[str, Any]]:
        query = str(params.get("query", "")).lower()
        result = []
        for i in range(20):
            role = self.roles[i % 4]
            item = {
                "external_id": f"mock-{i + 1}",
                "provider": "mock",
                "url": f"https://example.test/vacancies/{i + 1}",
                "title": role,
                "company": f"Demo Company {i % 7 + 1}",
                "description": f"Разработка продукта: {role}. Команда ищет инженера для production-систем.",
                "requirements": ", ".join(self.skills[i % 4]),
                "responsibilities": "Проектирование, разработка, тестирование и эксплуатация.",
                "skills": self.skills[i % 4],
                "salary_from": 180000 + i * 5000,
                "salary_to": 280000 + i * 5000,
                "currency": "RUR",
                "location": "Москва" if i % 3 else "Санкт-Петербург",
                "remote": i % 2 == 0,
                "employment": "full",
                "experience": "3-6",
                "published_at": datetime.utcnow() - timedelta(hours=i),
                "raw_data": {"mock": True},
            }
            if (
                not query
                or query in role.lower()
                or any(word in role.lower() for word in query.split())
            ):
                result.append(item)
        return result

    async def get_vacancy(self, vacancy_id: str) -> dict[str, Any]:
        return next((v for v in await self.search() if v["external_id"] == vacancy_id), {})

    async def apply(self, vacancy_id: str, resume_id: str, cover_letter: str) -> dict[str, Any]:
        return {"id": f"mock-application-{vacancy_id}", "status": "sent"}
