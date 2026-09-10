"""Durable single-process HH search with explicit opt-in auto application."""

import asyncio
from datetime import UTC, datetime

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import JSON, String, select
from sqlalchemy.orm import Mapped, mapped_column

from app.api.hh_browser import SearchInput, search
from app.api.letters import build_prompt
from app.connectors.chat_bridge import chat_bridge
from app.connectors.hh_browser import hh_browser
from app.db.models import Application, Base, Resume, Vacancy
from app.db.session import SessionLocal
from app.schemas import ApplicationPrepare
from app.services.core import prepare_application, send_application


class PilotState(Base):
    __tablename__ = "autopilot_state"
    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class PilotConfig(BaseModel):
    query: str = Field(min_length=1, max_length=200, pattern=r"\S")
    interval_minutes: int = Field(default=30, ge=5, le=1440)
    auto_apply: bool = False
    resume_id: str | None = None

    @model_validator(mode="after")
    def resume_required_for_applications(self):
        if self.auto_apply and not self.resume_id:
            raise ValueError("Для автооткликов выберите резюме HH")
        return self


class Autopilot:
    def __init__(self):
        self.task: asyncio.Task | None = None
        self.control = asyncio.Lock()
        self.state: dict = {
            "status": "paused",
            "enabled": False,
            "mode": "search_only",
            "history": [],
        }

    async def save(self):
        async with SessionLocal() as db:
            row = await db.get(PilotState, "main")
            if row is None:
                row = PilotState(id="main", data=dict(self.state))
                db.add(row)
            else:
                row.data = dict(self.state)
            await db.commit()

    async def restore(self):
        async with SessionLocal() as db:
            row = await db.get(PilotState, "main")
            if row:
                self.state = dict(row.data)
        if self.state.get("enabled"):
            self.task = asyncio.create_task(self.loop())

    async def shutdown(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    async def start(self, config: PilotConfig):
        async with self.control:
            await self.shutdown()
            self.state.update(config.model_dump())
            mode = "auto_apply" if config.auto_apply else "search_only"
            self.state.update(enabled=True, status="starting", error=None, mode=mode)
            self.state["next_run"] = None
            await self.save()
            self.task = asyncio.create_task(self.loop())
        return dict(self.state)

    async def pause(self):
        async with self.control:
            await self.shutdown()
            self.state.update(enabled=False, status="paused", next_run=None)
            await self.save()
            await hh_browser.close()
        return dict(self.state)

    async def run_once(self):
        self.state.update(status="running", next_run=None)
        await self.save()
        await hh_browser.set_background(True)
        async with SessionLocal() as db:
            result = await search(SearchInput(query=self.state["query"]), db)
        if self.state.get("auto_apply"):
            result = {**result, **await self._apply_one(result.get("vacancy_ids", []))}
        stamp = datetime.now(UTC).isoformat()
        history = [*self.state.get("history", []), {"at": stamp, **result}][-30:]
        self.state.update(
            status="waiting", last_run=stamp, result=result, history=history, error=None
        )
        await self.save()

    async def _apply_one(self, vacancy_ids: list[str]) -> dict:
        resume_id = self.state.get("resume_id")
        if not resume_id:
            raise ValueError("Для автооткликов не выбрано резюме HH")
        skipped = 0
        async with SessionLocal() as db:
            resume = await db.get(Resume, resume_id)
            if not resume or not resume.is_active or not resume.hh_resume_id:
                raise ValueError("Выбранное резюме HH недоступно; автоотклики остановлены")
            for vacancy_id in vacancy_ids:
                vacancy = await db.get(Vacancy, vacancy_id)
                if not vacancy or vacancy.provider != "hh_browser":
                    skipped += 1
                    continue
                existing = await db.scalar(
                    select(Application).where(Application.vacancy_id == vacancy.id)
                )
                if existing and existing.status == "APPLIED":
                    skipped += 1
                    continue
                if existing and existing.resume_id != resume.id:
                    skipped += 1
                    continue
                detail = await hh_browser.read_vacancy(vacancy.url)
                vacancy.title = detail["title"]
                vacancy.description = detail["description"]
                vacancy.skills = detail["skills"]
                vacancy.raw_data = {**vacancy.raw_data, "source": detail["source"]}
                await db.commit()
                application = await prepare_application(
                    db,
                    ApplicationPrepare(
                        vacancy_id=vacancy.id,
                        resume_id=resume.id,
                        cover_letter="",
                        mode="AUTO",
                    ),
                )
                answer = (await chat_bridge.ask(build_prompt(resume, vacancy)))["answer"].strip()
                if not 600 <= len(answer) <= 1200:
                    raise ValueError(
                        "ChatGPT вернул некорректную длину письма; автоотклики остановлены"
                    )
                application.cover_letter = answer
                application.status = "PREPARED"
                await db.commit()
                await send_application(
                    db, application.id, confirmed_real=True, require_score=False
                )
                return {"applied": 1, "skipped": skipped}
        return {"applied": 0, "skipped": skipped}

    async def loop(self):
        try:
            while self.state.get("enabled"):
                if self.state.get("next_run"):
                    remaining = (
                        datetime.fromisoformat(self.state["next_run"]) - datetime.now(UTC)
                    ).total_seconds()
                    if remaining > 0:
                        await asyncio.sleep(remaining)
                await self.run_once()
                delay = self.state["interval_minutes"] * 60
                self.state["next_run"] = datetime.fromtimestamp(
                    datetime.now(UTC).timestamp() + delay, UTC
                ).isoformat()
                await self.save()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # A failed page is not an empty successful search; no blind retry storm.
            message = (
                getattr(exc, "detail", None)
                or "Фоновый поиск остановлен. Откройте HH, проверьте вход/капчу и запустите снова."
            )
            self.state.update(
                status="needs_attention", enabled=False, next_run=None, error=str(message)
            )
            await self.save()


autopilot = Autopilot()
