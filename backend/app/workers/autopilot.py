"""Durable single-process HH search with explicit opt-in auto application."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import JSON, String, func, select
from sqlalchemy.orm import Mapped, mapped_column

from app.api.hh_browser import (
    RecommendationsInput,
    SearchInput,
    import_recommendations,
    search,
)
from app.api.letters import build_prompt, generate_valid_letter
from app.connectors.hh_browser import hh_browser
from app.db.models import Application, Base, Resume, Vacancy
from app.db.session import SessionLocal
from app.schemas import ApplicationPrepare
from app.services.core import prepare_application


class PilotState(Base):
    __tablename__ = "autopilot_state"
    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class PilotConfig(BaseModel):
    query: str = Field(min_length=1, max_length=200, pattern=r"\S")
    source: Literal["recommendations", "search"] = "recommendations"
    interval_minutes: int = Field(default=30, ge=5, le=1440)
    auto_apply: bool = False
    resume_id: str | None = None
    prepare_only: bool = True
    daily_limit: int = Field(default=5, ge=1, le=50)
    excluded_companies: str = Field(default="", max_length=2000)
    excluded_words: str = Field(default="", max_length=2000)
    required_words: str = Field(default="python", max_length=2000)
    letter_instructions: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def resume_required_for_applications(self):
        if self.auto_apply and not self.resume_id:
            raise ValueError("Для автооткликов выберите резюме HH")
        if self.source == "recommendations" and not self.resume_id:
            raise ValueError("Для рекомендаций HH выберите резюме")
        if not self.prepare_only:
            raise ValueError(
                "Фоновая отправка отключена: автопилот только готовит черновики для проверки"
            )
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
        # Old releases could persist unattended sending. Every upgrade fails closed.
        self.state["prepare_only"] = True
        if self.state.get("auto_apply"):
            self.state["mode"] = "prepare_drafts"
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
            mode = "prepare_drafts" if config.auto_apply else "search_only"
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
            if self.state.get("source") == "recommendations":
                result = await import_recommendations(
                    RecommendationsInput(resume_id=self.state["resume_id"]), db
                )
            else:
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
            today = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
            prepared = (
                await db.scalar(
                    select(func.count())
                    .select_from(Application)
                    .where(Application.created_at >= today, Application.mode == "AUTO")
                )
                or 0
            )
            if prepared >= self.state.get("daily_limit", 5):
                return {
                    "applied": 0,
                    "prepared": 0,
                    "skipped": 0,
                    "message": "Достигнут лимит черновиков за 24 часа",
                }
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
                if existing:
                    skipped += 1
                    continue
                companies = [
                    part.strip().lower()
                    for part in self.state.get("excluded_companies", "").split(",")
                    if part.strip()
                ]
                words = [
                    part.strip().lower()
                    for part in self.state.get("excluded_words", "").split(",")
                    if part.strip()
                ]
                required = [
                    part.strip().lower()
                    for part in self.state.get("required_words", "").split(",")
                    if part.strip()
                ]
                if any(part in vacancy.company.lower() for part in companies) or any(
                    part in vacancy.title.lower() for part in words
                ):
                    skipped += 1
                    continue
                detail = await hh_browser.read_vacancy(vacancy.url)
                vacancy.title = detail["title"]
                vacancy.description = detail["description"]
                vacancy.skills = detail["skills"]
                vacancy.raw_data = {**vacancy.raw_data, "source": detail["source"]}
                await db.commit()
                full_text = (vacancy.title + " " + vacancy.description).lower()
                if any(part in full_text for part in words):
                    skipped += 1
                    continue
                if required and not all(part in full_text for part in required):
                    skipped += 1
                    continue
                prompt = build_prompt(resume, vacancy)
                instructions = self.state.get("letter_instructions", "").strip()
                if instructions:
                    prompt += "\nПОЖЕЛАНИЯ К СТИЛЮ (не источник фактов об опыте):\n" + instructions
                answer = await generate_valid_letter(prompt, resume, vacancy)
                await prepare_application(
                    db,
                    ApplicationPrepare(
                        vacancy_id=vacancy.id,
                        resume_id=resume.id,
                        cover_letter=answer,
                        mode="AUTO",
                    ),
                )
                return {"applied": 0, "prepared": 1, "skipped": skipped}
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
                or (str(exc) if isinstance(exc, ValueError) else None)
                or "Фоновый поиск остановлен. Откройте HH, проверьте вход/капчу и запустите снова."
            )
            self.state.update(
                status="needs_attention", enabled=False, next_run=None, error=str(message)
            )
            await self.save()


autopilot = Autopilot()
