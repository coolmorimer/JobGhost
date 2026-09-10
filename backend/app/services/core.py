import re
import secrets
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.connectors.mock import MockVacancyProvider
from app.core.config import get_settings
from app.db.models import (
    Application,
    AuditLog,
    CandidateProfile,
    InterviewSession,
    Resume,
    SearchProfile,
    Vacancy,
    VacancyScore,
)
from app.schemas import ApplicationPrepare, CandidateIn, ScoreIn


async def audit(
    db: AsyncSession, action: str, entity_id: str | None = None, **details: Any
) -> None:
    db.add(AuditLog(action=action, entity_id=entity_id, details=details))


async def get_or_create_profile(db: AsyncSession) -> CandidateProfile:
    profile = await db.scalar(select(CandidateProfile).limit(1))
    if not profile:
        profile = CandidateProfile(
            name="Demo Candidate",
            location="Москва",
            remote=True,
            desired_roles=["Python Backend Developer"],
            skills={"Python": "advanced", "FastAPI": "advanced", "PostgreSQL": "intermediate"},
            strengths=["Системное мышление"],
            preferences={"application_mode": "MANUAL"},
        )
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
    return profile


async def update_profile(db: AsyncSession, data: CandidateIn) -> CandidateProfile:
    profile = await get_or_create_profile(db)
    for key, value in data.model_dump().items():
        setattr(profile, key, value)
    await db.commit()
    await db.refresh(profile)
    return profile


async def seed(db: AsyncSession) -> None:
    await get_or_create_profile(db)
    if not await db.scalar(select(Resume).limit(1)):
        db.add_all(
            [
                Resume(
                    name="Backend",
                    description="Python backend",
                    preferred_roles=["Backend"],
                    skills=["Python", "FastAPI", "PostgreSQL"],
                ),
                Resume(
                    name="Fullstack",
                    description="React + Python",
                    preferred_roles=["Fullstack"],
                    skills=["React", "TypeScript", "Python"],
                ),
            ]
        )
    if not await db.scalar(select(SearchProfile).limit(1)):
        db.add(
            SearchProfile(
                name="Python Backend",
                keywords=["Python", "Backend"],
                excluded_keywords=["стажёр"],
                salary_min=150000,
                remote=True,
                providers=["mock"],
                minimum_score=70,
            )
        )
    await db.commit()


def local_filter(
    item: dict[str, Any],
    profile: CandidateProfile,
    search: SearchProfile | None,
    existing: set[tuple[str, str]],
) -> tuple[bool, str]:
    text = f"{item.get('title', '')} {item.get('description', '')}".lower()
    if (item["provider"], item["external_id"]) in existing:
        return False, "duplicate"
    if any(x.lower() in item.get("company", "").lower() for x in profile.blacklisted_companies):
        return False, "company_blacklist"
    blocked = profile.blacklisted_keywords + (search.excluded_keywords if search else [])
    if any(x.lower() in text for x in blocked):
        return False, "excluded_keyword"
    salary_min = search.salary_min if search else profile.minimum_salary
    if salary_min and item.get("salary_to") and item["salary_to"] < salary_min:
        return False, "salary"
    if search and search.remote is True and not item.get("remote"):
        return False, "remote"
    return True, "accepted"


async def search_mock(
    db: AsyncSession, query: str = "", search_profile_id: str | None = None
) -> dict[str, int]:
    profile = await get_or_create_profile(db)
    search = (
        await db.get(SearchProfile, search_profile_id)
        if search_profile_id
        else await db.scalar(select(SearchProfile).limit(1))
    )
    rows = (await db.execute(select(Vacancy.provider, Vacancy.external_id))).all()
    existing: set[tuple[str, str]] = {(row[0], row[1]) for row in rows}
    found = saved = filtered = 0
    for item in await MockVacancyProvider().search(query=query):
        found += 1
        ok, reason = local_filter(item, profile, search, existing)
        if not ok:
            filtered += 1
            await audit(db, "vacancy_filtered", reason=reason)
            continue
        vacancy = Vacancy(**item)
        db.add(vacancy)
        await db.flush()
        await audit(db, "vacancy_found", vacancy.id)
        existing.add((item["provider"], item["external_id"]))
        saved += 1
    await db.commit()
    return {"found": found, "saved": saved, "filtered": filtered}


async def save_score(db: AsyncSession, data: ScoreIn) -> VacancyScore:
    vacancy = await db.get(Vacancy, data.vacancy_id)
    if not vacancy:
        raise ValueError("Vacancy not found")
    score = VacancyScore(**data.model_dump())
    db.add(score)
    vacancy.status = "SUITABLE" if data.decision == "apply" else "SCORED"
    await audit(db, "vacancy_scored", vacancy.id, score=data.score)
    await db.commit()
    await db.refresh(score)
    return score


async def prepare_application(db: AsyncSession, data: ApplicationPrepare) -> Application:
    vacancy = await db.get(Vacancy, data.vacancy_id)
    if not vacancy:
        raise ValueError("Vacancy not found")
    if existing := await db.scalar(
        select(Application).where(Application.vacancy_id == data.vacancy_id)
    ):
        return existing
    score = await db.scalar(
        select(VacancyScore)
        .where(VacancyScore.vacancy_id == vacancy.id)
        .order_by(VacancyScore.created_at.desc())
    )
    resume_id = data.resume_id or (score.best_resume_id if score else None)
    if not resume_id and vacancy.provider == "mock":
        resume_id = await db.scalar(select(Resume.id).where(Resume.is_active.is_(True)).limit(1))
    if not resume_id:
        raise ValueError("Active resume required")
    resume = await db.get(Resume, resume_id)
    if not resume or not resume.is_active:
        raise ValueError("Active resume required")
    if vacancy.provider == "hh_browser" and not resume.hh_resume_id:
        raise ValueError("HH resume required")
    values = data.model_dump(exclude={"resume_id"})
    app = Application(**values, resume_id=resume_id, dry_run=get_settings().dry_run)
    db.add(app)
    await audit(db, "application_prepared", data.vacancy_id)
    await db.commit()
    await db.refresh(app)
    return app


async def send_application(
    db: AsyncSession,
    application_id: str,
    *,
    confirmed_real: bool = False,
    require_score: bool = True,
) -> Application:
    app = await db.get(Application, application_id)
    if not app:
        raise ValueError("Application not found")
    if app.status == "APPLIED":
        raise ValueError("Duplicate application")
    if not app.resume_id:
        raise ValueError("Resume required")
    resume = await db.get(Resume, app.resume_id)
    if not resume or not resume.is_active:
        raise ValueError("Active resume required")
    if not app.cover_letter.strip():
        raise ValueError("Cover letter required")
    vacancy = await db.get(Vacancy, app.vacancy_id)
    if not vacancy:
        raise ValueError("Vacancy not found")
    profile = await get_or_create_profile(db)
    if any(x.lower() in vacancy.company.lower() for x in profile.blacklisted_companies):
        raise ValueError("Company is blacklisted")
    if require_score:
        score = await db.scalar(
            select(VacancyScore)
            .where(VacancyScore.vacancy_id == app.vacancy_id)
            .order_by(VacancyScore.created_at.desc())
        )
        if not score or score.decision != "apply":
            raise ValueError("Positive vacancy score required")
        search = await db.scalar(select(SearchProfile).limit(1))
        if search and score.score < search.minimum_score:
            raise ValueError("Score below configured minimum")
    day = datetime.utcnow() - timedelta(days=1)
    count = (
        await db.scalar(
            select(func.count()).select_from(Application).where(Application.sent_at >= day)
        )
        or 0
    )
    if count >= get_settings().max_applications_per_day:
        raise ValueError("Daily application limit reached")
    last = await db.scalar(
        select(Application)
        .where(Application.sent_at.is_not(None))
        .order_by(Application.sent_at.desc())
        .limit(1)
    )
    if (
        last
        and last.sent_at
        and (datetime.utcnow() - last.sent_at).total_seconds()
        < get_settings().application_cooldown_seconds
    ):
        raise ValueError("Application cooldown active")
    if get_settings().dry_run and not confirmed_real:
        app.status = "DRY_RUN_VALIDATED"
        app.dry_run = True
        app.sent_at = None
        app.provider_application_id = None
        await audit(db, "application_dry_run_validated", app.id)
        await db.commit()
        await db.refresh(app)
        return app
    if vacancy.provider == "mock":
        provider_id = (
            await MockVacancyProvider().apply(vacancy.external_id, app.resume_id, app.cover_letter)
        )["id"]
    elif vacancy.provider == "hh_browser":
        if not resume.hh_resume_id:
            raise ValueError("HH resume required")
        from app.connectors.hh_browser import hh_browser

        provider_id = (
            await hh_browser.apply(vacancy.url, resume.hh_resume_id, app.cover_letter)
        )["id"]
    else:
        raise ValueError("Provider dispatch is not available through this runtime")
    app.status = "APPLIED"
    app.sent_at = datetime.utcnow()
    app.dry_run = False
    app.provider_application_id = provider_id
    await audit(db, "application_sent", app.id, dry_run=app.dry_run)
    await db.commit()
    await db.refresh(app)
    return app


def detect_question(text: str) -> bool:
    value = " ".join(text.strip().lower().replace("ё", "е").split())
    if len(value) < 3:
        return False
    if "?" in value:
        return True
    # Whisper often omits punctuation and may preserve a short conversational
    # prefix, so interview prompts are matched at a word boundary, not only at
    # character zero.
    prefixes = (
        "как", "почему", "зачем", "что", "кто", "где", "когда", "куда", "откуда",
        "сколько", "какой", "какая", "какие", "какое", "чем", "чей", "правда ли",
        "можно ли", "можете ли", "могли бы", "расскажите", "опишите", "объясните",
        "назовите", "сравните", "приведите пример", "представьте", "допустим",
        "how", "why", "what", "who", "where", "when", "which", "whose", "whom",
        "can you", "could you", "would you", "do you", "did you", "have you",
        "are you", "is it", "tell me", "describe", "explain", "compare", "name",
        "give me an example", "walk me through", "suppose", "imagine",
    )
    fillers = (
        "ну", "так", "хорошо", "итак", "скажите", "пожалуйста", "тогда", "а теперь",
        "okay", "ok", "so", "well", "please", "now", "all right",
    )
    words = re.findall(r"[a-zа-я0-9]+", value)
    if len(words) < 2:
        return False
    separator = r"[\s,;:—-]+"
    return bool(re.search(rf"(?:^|[.!])\s*(?:(?:{'|'.join(re.escape(x) for x in fillers)}){separator})*(?:{'|'.join(re.escape(x) for x in prefixes)})(?:{separator}|$)", value))


async def start_interview(db: AsyncSession, vacancy_id: str) -> InterviewSession:
    if not await db.get(Vacancy, vacancy_id):
        raise ValueError("Vacancy not found")
    session = InterviewSession(
        vacancy_id=vacancy_id,
        pin=f"{secrets.randbelow(10000):04d}",
        token=secrets.token_urlsafe(24),
    )
    db.add(session)
    await audit(db, "interview_started", session.id)
    await db.commit()
    await db.refresh(session)
    return session
