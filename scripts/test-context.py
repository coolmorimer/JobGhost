"""Real RU/EN embedding smoke, synthetic data only. Run with backend venv."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.services.knowledge import knowledge  # noqa: E402


async def main():
    docs = [
        dict(id="db", title="База данных", kind="project", source="fixture", text="Разработал PostgreSQL сервис. Оптимизировал SQL запросы и индексы базы данных."),
        dict(id="ui", title="Интерфейс", kind="project", source="fixture", text="Создал адаптивный интерфейс React с кнопками и формами."),
    ]
    await knowledge.load()
    for query in ["Как оптимизировал базу данных?", "How did you optimize database queries?"]:
        hits = await knowledge.search(query, docs)
        assert hits and hits[0]["id"] == "db", hits
        print(f"PASS RU/EN retrieval: {hits[0]['id']} score={hits[0]['score']}")
    await knowledge.clear()


asyncio.run(main())
