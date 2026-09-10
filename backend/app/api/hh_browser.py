import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from playwright.async_api import Error as BrowserError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.connectors.hh_browser import hh_browser
from app.db.models import Application, Resume, Vacancy
from app.db.session import get_db
from app.services.core import send_application


async def local_request(request: Request):
    allowed = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8765",
        "http://127.0.0.1:8765",
    }
    if request.url.hostname not in {"127.0.0.1", "localhost", "test"}:
        raise HTTPException(403, "Недопустимый Host")
    if request.headers.get("origin") not in (None, *allowed):
        raise HTTPException(403, "Только локальный интерфейс JobGhost")
    if (
        request.method == "POST"
        and request.headers.get("content-type", "").split(";")[0] != "application/json"
    ):
        raise HTTPException(415, "Требуется application/json")


router = APIRouter(prefix="/api/hh-browser", dependencies=[Depends(local_request)])
import_lock = asyncio.Lock()


@router.post("/resumes/import")
async def import_resumes(db: AsyncSession = Depends(get_db)):
    from app.workers.autopilot import autopilot

    if autopilot.state.get("enabled"):
        raise HTTPException(409, "Сначала поставьте фоновый поиск на паузу")
    async with import_lock:
        try:
            items = await hh_browser.read_resumes()
        except (BrowserError, ValueError) as exc:
            raise HTTPException(
                409,
                str(exc)
                if isinstance(exc, ValueError)
                else "Не удалось прочитать резюме HH. Проверьте открытый браузер.",
            ) from exc
        result = []
        for item in items:
            row = await db.scalar(select(Resume).where(Resume.hh_resume_id == item["id"]))
            if row is None:
                row = Resume(name=item["title"][:120], hh_resume_id=item["id"])
                db.add(row)
            row.name = (item.get("heading") or item["title"])[:120]
            row.description = item["text"]
            await db.flush()
            result.append({"id": row.id, "name": row.name, "characters": len(row.description)})
        await db.commit()
    return {
        "resumes": result,
        "message": "Резюме прочитаны и сохранены локально. Профиль кандидата не перезаписан; отправки нет.",
    }


class SearchInput(BaseModel):
    query: str = Field(min_length=1, max_length=200, pattern=r"\S")


class ConfirmSend(BaseModel):
    confirm: Literal[True]


@router.get("/status")
async def status():
    try:
        return await hh_browser.status()
    except BrowserError:
        return {"state": "closed", "message": "Браузер закрывается или перезапускается"}


@router.post("/open")
async def open_login():
    from app.workers.autopilot import autopilot

    await autopilot.pause()
    try:
        return await hh_browser.open_login()
    except BrowserError as exc:
        raise HTTPException(
            503, "Не удалось открыть Microsoft Edge. Проверьте установку и повторите."
        ) from exc


@router.post("/search")
async def search(data: SearchInput, db: AsyncSession = Depends(get_db)):
    async with import_lock:
        return await import_search(data, db)


async def import_search(data: SearchInput, db: AsyncSession):
    try:
        rows = await hh_browser.search(data.query.strip())
    except (BrowserError, ValueError) as exc:
        raise HTTPException(
            409,
            str(exc)
            if isinstance(exc, ValueError)
            else "HH не ответил. Проверьте браузер и повторите.",
        ) from exc
    saved = 0
    vacancy_ids = []
    for row in rows:
        exists = await db.scalar(
            select(Vacancy).where(
                Vacancy.provider == "hh_browser", Vacancy.external_id == row["external_id"]
            )
        )
        if not exists:
            exists = Vacancy(**row)
            db.add(exists)
            await db.flush()
            saved += 1
        elif not exists.company and row.get("company"):
            exists.company = row["company"]
        vacancy_ids.append(exists.id)
    await db.commit()
    return {
        "found": len(rows),
        "saved": saved,
        "vacancy_ids": vacancy_ids,
        "message": f"HH: найдено {len(rows)}, добавлено {saved}. Карточки поиска, без AI-оценки.",
    }


@router.post("/vacancies/{vacancy_id}/open")
async def open_vacancy(vacancy_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(Vacancy, vacancy_id)
    if not row or row.provider != "hh_browser":
        raise HTTPException(404, "Вакансия HH не найдена")
    from app.workers.autopilot import autopilot

    await autopilot.pause()
    try:
        return await hh_browser.open_vacancy(row.url)
    except (BrowserError, ValueError) as exc:
        raise HTTPException(409, "Не удалось открыть вакансию HH") from exc


@router.post("/vacancies/{vacancy_id}/read")
async def read_vacancy(vacancy_id: str, db: AsyncSession = Depends(get_db)):
    from app.workers.autopilot import autopilot

    if autopilot.state.get("enabled"):
        raise HTTPException(409, "Сначала поставьте фоновый поиск на паузу")
    row = await db.get(Vacancy, vacancy_id)
    if not row or row.provider != "hh_browser":
        raise HTTPException(404, "Вакансия HH не найдена")
    try:
        data = await hh_browser.read_vacancy(row.url)
    except (ValueError, BrowserError) as exc:
        raise HTTPException(
            409,
            "Не удалось подтвердить полное описание. Проверьте окно HH; сохранённые данные не изменены.",
        ) from exc
    row.title = data["title"]
    row.description = data["description"]
    row.skills = data["skills"]
    row.raw_data = {**row.raw_data, "source": data["source"]}
    await db.commit()
    return {
        "id": row.id,
        "description": row.description,
        "skills": row.skills,
        "characters": len(row.description),
    }


async def _application_context(application_id: str, db: AsyncSession):
    application = await db.get(Application, application_id)
    if not application:
        raise HTTPException(404, "Черновик отклика не найден")
    vacancy = await db.get(Vacancy, application.vacancy_id)
    resume = await db.get(Resume, application.resume_id)
    if not vacancy or vacancy.provider != "hh_browser":
        raise HTTPException(409, "Это не вакансия HH")
    if not resume or not resume.is_active or not resume.hh_resume_id:
        raise HTTPException(409, "Выберите действующее резюме, импортированное из HH")
    if not application.cover_letter.strip():
        raise HTTPException(409, "Сначала сохраните сопроводительное письмо")
    return application, vacancy, resume


@router.post("/applications/{application_id}/preflight")
async def response_preflight(application_id: str, db: AsyncSession = Depends(get_db)):
    application, vacancy, resume = await _application_context(application_id, db)
    if application.status == "APPLIED" or application.sent_at:
        return {"state": "already_applied", "message": "Отклик уже отмечен отправленным"}
    from app.workers.autopilot import autopilot

    await autopilot.pause()
    await hh_browser.set_background(True)
    try:
        return await hh_browser.response_preflight(vacancy.url, resume.hh_resume_id)
    except (BrowserError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/applications/{application_id}/send")
async def send_real_response(
    application_id: str,
    _: ConfirmSend,
    db: AsyncSession = Depends(get_db),
):
    await _application_context(application_id, db)
    from app.workers.autopilot import autopilot

    await autopilot.pause()
    await hh_browser.set_background(True)
    try:
        result = await send_application(
            db, application_id, confirmed_real=True, require_score=False
        )
    except (BrowserError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc
    return {
        "id": result.id,
        "status": result.status,
        "sent_at": result.sent_at,
        "message": "Отклик подтверждён сайтом HH",
    }
