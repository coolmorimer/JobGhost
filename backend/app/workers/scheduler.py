from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.db.session import SessionLocal
from app.services.core import search_mock


async def search_job() -> None:
    async with SessionLocal() as db:
        await search_mock(db)


def build_scheduler(minutes: int = 30) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        search_job,
        "interval",
        minutes=minutes,
        id="search_vacancies",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    return scheduler
