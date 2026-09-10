import json
from typing import Any

from mcp.server.fastmcp import FastMCP
from sqlalchemy import func, select

from app.db.models import (
    Application,
    InterviewHint,
    InterviewSession,
    InterviewSummary,
    Message,
    Resume,
    SearchProfile,
    TranscriptSegment,
    Vacancy,
    VacancyScore,
)
from app.db.session import SessionLocal
from app.schemas import ApplicationPrepare, CandidateIn, ScoreIn
from app.services.core import (
    get_or_create_profile,
    save_score,
    search_mock,
    send_application,
    start_interview,
    update_profile,
)
from app.services.core import prepare_application as prepare_application_service

mcp = FastMCP(
    "JobGhost",
    instructions="JobGhost is a local job copilot. Read candidate context before scoring. Search stores locally filtered vacancies; score only NEEDS_AI_SCORE items. In MANUAL mode never send until the user explicitly says to send. DRY_RUN may simulate dispatch. Never invent candidate experience. Prefer batch scoring tools.",
)


def compact(obj: Any) -> Any:
    if hasattr(obj, "__table__"):
        return {c.name: getattr(obj, c.name) for c in obj.__table__.columns if c.name != "raw_data"}
    return obj


@mcp.tool(
    description="Return compact local candidate profile for vacancy and application reasoning."
)
async def get_candidate_profile() -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(await get_or_create_profile(db))


@mcp.tool(
    description="Replace the editable candidate profile with validated fields; local storage only."
)
async def update_candidate_profile(profile: dict[str, Any]) -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(await update_profile(db, CandidateIn.model_validate(profile)))


@mcp.tool(description="List active resumes and their targeting metadata.")
async def list_resumes() -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        return [compact(x) for x in (await db.scalars(select(Resume))).all()]


@mcp.tool(description="Get one resume by local id.")
async def get_resume(resume_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(await db.get(Resume, resume_id))


@mcp.tool(description="List saved vacancy search profiles, local filters and score thresholds.")
async def list_search_profiles() -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        return [compact(x) for x in (await db.scalars(select(SearchProfile))).all()]


@mcp.tool(
    description="Search provider and persist vacancies that pass deterministic local filters. Returns counts, not raw provider payloads."
)
async def search_vacancies(query: str = "", search_profile_id: str | None = None) -> dict[str, int]:
    async with SessionLocal() as db:
        return await search_mock(db, query, search_profile_id)


@mcp.tool(description="Get one compact normalized vacancy by local id.")
async def get_vacancy(vacancy_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(await db.get(Vacancy, vacancy_id))


@mcp.tool(description="Get newest locally accepted vacancies, optionally limited.")
async def get_new_vacancies(limit: int = 20) -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        return [
            compact(x)
            for x in (
                await db.scalars(
                    select(Vacancy).order_by(Vacancy.created_at.desc()).limit(min(limit, 30))
                )
            ).all()
        ]


@mcp.tool(description="Get 1-30 compact vacancies waiting for Codex scoring in a single batch.")
async def get_vacancies_for_scoring(limit: int = 20) -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(Vacancy)
                .where(Vacancy.status == "NEEDS_AI_SCORE")
                .limit(min(max(limit, 1), 30))
            )
        ).all()
        return [
            {
                "id": x.id,
                "title": x.title,
                "company": x.company,
                "salary": [x.salary_from, x.salary_to, x.currency],
                "remote": x.remote,
                "location": x.location,
                "experience": x.experience,
                "skills": x.skills,
                "requirements": x.requirements[:1200],
                "responsibilities": x.responsibilities[:800],
            }
            for x in rows
        ]


@mcp.tool(description="Get highest latest scored vacancies suitable for application.")
async def get_best_vacancies(min_score: int = 80, limit: int = 20) -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(Vacancy, VacancyScore)
                .join(VacancyScore)
                .where(VacancyScore.score >= min_score)
                .order_by(VacancyScore.score.desc())
                .limit(limit)
            )
        ).all()
        return [
            {**compact(v), "score": s.score, "reason": s.reason, "best_resume_id": s.best_resume_id}
            for v, s in rows
        ]


@mcp.tool(description="Mark a vacancy ignored so it is excluded from active workflows.")
async def ignore_vacancy(vacancy_id: str) -> dict[str, str]:
    async with SessionLocal() as db:
        v = await db.get(Vacancy, vacancy_id)
        if not v:
            raise ValueError("Vacancy not found")
        v.status = "IGNORED"
        await db.commit()
        return {"status": "IGNORED"}


@mcp.tool(
    description="Persist one Codex score (0-100), decision, evidence, risks and selected resume."
)
async def save_vacancy_score(score: dict[str, Any]) -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(await save_score(db, ScoreIn.model_validate(score)))


@mcp.tool(
    description="Persist multiple Codex vacancy scores in one call to reduce context and tool overhead."
)
async def save_vacancy_scores(scores: list[dict[str, Any]]) -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        return [compact(await save_score(db, ScoreIn.model_validate(x))) for x in scores]


@mcp.tool(
    description="Create an idempotent application draft using a real vacancy and active resume; does not send."
)
async def prepare_application(data: dict[str, Any]) -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(
            await prepare_application_service(db, ApplicationPrepare.model_validate(data))
        )


@mcp.tool(
    description="Save or replace the personalized 600-1200 character cover letter on a draft application."
)
async def save_cover_letter(application_id: str, cover_letter: str) -> dict[str, Any]:
    if not 600 <= len(cover_letter) <= 1200:
        raise ValueError("Cover letter must be 600-1200 characters")
    async with SessionLocal() as db:
        app = await db.get(Application, application_id)
        if not app:
            raise ValueError("Application not found")
        app.cover_letter = cover_letter
        await db.commit()
        return compact(app)


@mcp.tool(
    description="Dispatch a prepared application after explicit user approval in MANUAL mode. Enforces duplicate, score, daily limit, cooldown, resume and DRY_RUN safeguards."
)
async def apply_to_vacancy(application_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(await send_application(db, application_id))


@mcp.tool(description="List application queue/history across all statuses.")
async def get_applications() -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        return [compact(x) for x in (await db.scalars(select(Application))).all()]


@mcp.tool(description="Get one application with its draft and dispatch state.")
async def get_application(application_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(await db.get(Application, application_id))


@mcp.tool(description="List unread incoming HR messages across applications.")
async def get_unread_messages() -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        rows = (await db.scalars(select(Message).where(Message.is_read.is_(False)))).all()
        return [compact(x) for x in rows]


@mcp.tool(description="Get the bounded conversation history for one application.")
async def get_employer_messages(application_id: str) -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(Message)
                .where(Message.application_id == application_id)
                .order_by(Message.created_at)
                .limit(100)
            )
        ).all()
        return [compact(x) for x in rows]


@mcp.tool(
    description="Save an HR reply as draft or outgoing message; connector dispatch is used only when draft is false."
)
async def send_hr_reply(application_id: str, text: str, draft: bool = True) -> dict[str, Any]:
    async with SessionLocal() as db:
        row = Message(
            application_id=application_id, direction="OUT", text=text, is_read=True, is_draft=draft
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return compact(row)


@mcp.tool(description="Return compact funnel counts for vacancies and applications.")
async def get_statistics() -> dict[str, int]:
    async with SessionLocal() as db:
        result = {"found": await db.scalar(select(func.count()).select_from(Vacancy)) or 0}
        for status in (
            "SUITABLE",
            "PREPARED",
            "APPLIED",
            "HR_REPLY",
            "INTERVIEW",
            "OFFER",
            "REJECTED",
        ):
            result[status.lower()] = (
                await db.scalar(
                    select(func.count())
                    .select_from(Application)
                    .where(Application.status == status)
                )
                or 0
            )
        return result


@mcp.tool(
    description="Start an interview session and return PIN/token for realtime companion access."
)
async def start_interview_session(vacancy_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        return compact(await start_interview(db, vacancy_id))


@mcp.tool(description="Stop and persist an active interview session.")
async def stop_interview_session(session_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        x = await db.get(InterviewSession, session_id)
        if not x:
            raise ValueError("Interview session not found")
        x.status = "STOPPED"
        await db.commit()
        return compact(x)


@mcp.tool(
    description="Return compact vacancy/candidate/resume context for interview preparation and hints."
)
async def get_interview_context(session_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        s = await db.get(InterviewSession, session_id)
        if not s:
            raise ValueError("Interview session not found")
        v = await db.get(Vacancy, s.vacancy_id)
        if not v:
            raise ValueError("Vacancy not found")
        p = await get_or_create_profile(db)
        return {
            "session_id": s.id,
            "vacancy": {
                "title": v.title,
                "company": v.company,
                "requirements": v.requirements[:1600],
                "skills": v.skills,
            },
            "candidate": {"skills": p.skills, "strengths": p.strengths, "projects": p.projects[:5]},
        }


@mcp.tool(
    description="Return only the recent bounded transcript window, never the full transcript by default."
)
async def get_recent_interview_transcript(
    session_id: str, last_seconds: int = 60, max_chars: int = 4000
) -> list[dict[str, Any]]:
    from datetime import datetime, timedelta

    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(TranscriptSegment)
                .where(
                    TranscriptSegment.session_id == session_id,
                    TranscriptSegment.timestamp
                    >= datetime.utcnow() - timedelta(seconds=last_seconds),
                )
                .order_by(TranscriptSegment.timestamp)
            )
        ).all()
        out = [compact(x) for x in rows]
        while len(json.dumps(out, default=str, ensure_ascii=False)) > max_chars and out:
            out.pop(0)
        return out


@mcp.tool(description="Save a concise 3-7 bullet interview hint produced by Codex.")
async def save_interview_hint(session_id: str, hint: dict[str, Any]) -> dict[str, Any]:
    async with SessionLocal() as db:
        x = InterviewHint(session_id=session_id, **hint)
        db.add(x)
        await db.commit()
        await db.refresh(x)
        return compact(x)


@mcp.tool(description="Persist Codex post-interview analysis and follow-up recommendations.")
async def save_interview_summary(session_id: str, summary: dict[str, Any]) -> dict[str, Any]:
    async with SessionLocal() as db:
        x = InterviewSummary(session_id=session_id, content=summary)
        db.add(x)
        await db.commit()
        await db.refresh(x)
        return compact(x)


@mcp.resource("candidate://profile")
async def candidate_profile_resource() -> str:
    return json.dumps(await get_candidate_profile(), default=str, ensure_ascii=False)


@mcp.resource("vacancy://{vacancy_id}")
async def vacancy_resource(vacancy_id: str) -> str:
    return json.dumps(await get_vacancy(vacancy_id), default=str, ensure_ascii=False)


@mcp.resource("application://{application_id}")
async def application_resource(application_id: str) -> str:
    return json.dumps(await get_application(application_id), default=str, ensure_ascii=False)


@mcp.resource("interview://{session_id}")
async def interview_resource(session_id: str) -> str:
    return json.dumps(await get_interview_context(session_id), default=str, ensure_ascii=False)


if __name__ == "__main__":
    mcp.run(transport="stdio")
