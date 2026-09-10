from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.db.session import get_db
from app.schemas import (
    ApplicationPrepare,
    CandidateIn,
    CandidateOut,
    HintIn,
    ScoreIn,
    TranscriptIn,
    VacancyOut,
)
from app.services.core import (
    detect_question,
    get_or_create_profile,
    prepare_application,
    save_score,
    search_mock,
    send_application,
    start_interview,
    update_profile,
)

router = APIRouter(prefix="/api")


def fail(exc: Exception) -> HTTPException:
    return HTTPException(400, str(exc))


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/profile", response_model=CandidateOut)
async def profile(db: AsyncSession = Depends(get_db)):
    return await get_or_create_profile(db)


@router.put("/profile", response_model=CandidateOut)
async def profile_update(data: CandidateIn, db: AsyncSession = Depends(get_db)):
    return await update_profile(db, data)


@router.get("/resumes")
async def resumes(db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(Resume))).all()


@router.get("/search-profiles")
async def search_profiles(db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(SearchProfile))).all()


@router.post("/vacancies/search")
async def search_vacancies(
    query: str = "", search_profile_id: str | None = None, db: AsyncSession = Depends(get_db)
):
    return await search_mock(db, query, search_profile_id)


@router.get("/vacancies", response_model=list[VacancyOut])
async def vacancies(
    status: str | None = None,
    remote: bool | None = None,
    score_min: int | None = None,
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    query = select(Vacancy).order_by(Vacancy.created_at.desc()).limit(limit)
    if status:
        query = query.where(Vacancy.status == status)
    if remote is not None:
        query = query.where(Vacancy.remote == remote)
    if score_min is not None:
        query = query.join(VacancyScore).where(VacancyScore.score >= score_min)
    return (await db.scalars(query)).unique().all()


@router.get("/vacancies/for-scoring")
async def scoring_queue(limit: int = Query(20, ge=1, le=30), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.scalars(select(Vacancy).where(Vacancy.status == "NEEDS_AI_SCORE").limit(limit))
    ).all()
    return [
        {
            "id": v.id,
            "title": v.title,
            "company": v.company,
            "salary": [v.salary_from, v.salary_to, v.currency],
            "remote": v.remote,
            "location": v.location,
            "experience": v.experience,
            "skills": v.skills,
            "requirements": v.requirements[:1200],
            "responsibilities": v.responsibilities[:800],
        }
        for v in rows
    ]


@router.get("/vacancies/{vacancy_id}", response_model=VacancyOut)
async def vacancy(vacancy_id: str, db: AsyncSession = Depends(get_db)):
    if not (value := await db.get(Vacancy, vacancy_id)):
        raise HTTPException(404, "Vacancy not found")
    return value


@router.post("/vacancies/{vacancy_id}/ignore")
async def ignore(vacancy_id: str, db: AsyncSession = Depends(get_db)):
    if not (value := await db.get(Vacancy, vacancy_id)):
        raise HTTPException(404, "Vacancy not found")
    value.status = "IGNORED"
    await db.commit()
    return {"status": "IGNORED"}


@router.post("/scores")
async def score(data: ScoreIn, db: AsyncSession = Depends(get_db)):
    try:
        return await save_score(db, data)
    except ValueError as exc:
        raise fail(exc) from exc


@router.post("/scores/batch")
async def scores(data: list[ScoreIn], db: AsyncSession = Depends(get_db)):
    try:
        return [await save_score(db, item) for item in data]
    except ValueError as exc:
        raise fail(exc) from exc


@router.get("/applications")
async def applications(db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(Application).order_by(Application.created_at.desc()))).all()


@router.post("/applications")
async def application_prepare(data: ApplicationPrepare, db: AsyncSession = Depends(get_db)):
    try:
        return await prepare_application(db, data)
    except ValueError as exc:
        raise fail(exc) from exc


@router.post("/applications/{application_id}/send")
async def application_send(application_id: str, db: AsyncSession = Depends(get_db)):
    try:
        return await send_application(db, application_id)
    except ValueError as exc:
        raise fail(exc) from exc


@router.get("/messages")
async def messages(unread: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(Message).order_by(Message.created_at.desc())
    if unread:
        query = query.where(Message.is_read.is_(False))
    return (await db.scalars(query)).all()


@router.post("/messages/{application_id}")
async def send_message(
    application_id: str, text: str, draft: bool = True, db: AsyncSession = Depends(get_db)
):
    msg = Message(
        application_id=application_id, direction="OUT", text=text, is_read=True, is_draft=draft
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg


@router.post("/interviews")
async def interview_start(vacancy_id: str, db: AsyncSession = Depends(get_db)):
    try:
        return await start_interview(db, vacancy_id)
    except ValueError as exc:
        raise fail(exc) from exc


@router.post("/interviews/{session_id}/stop")
async def interview_stop(session_id: str, db: AsyncSession = Depends(get_db)):
    if not (value := await db.get(InterviewSession, session_id)):
        raise HTTPException(404, "Interview not found")
    value.status = "STOPPED"
    value.stopped_at = datetime.utcnow()
    await db.commit()
    return value


@router.get("/interviews/{session_id}/context")
async def interview_context(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(InterviewSession, session_id)
    if not session:
        raise HTTPException(404, "Interview not found")
    vacancy = await db.get(Vacancy, session.vacancy_id)
    if not vacancy:
        raise HTTPException(404, "Vacancy not found")
    profile = await get_or_create_profile(db)
    return {
        "session": {"id": session.id, "status": session.status},
        "vacancy": {
            "id": vacancy.id,
            "title": vacancy.title,
            "company": vacancy.company,
            "requirements": vacancy.requirements[:1600],
            "skills": vacancy.skills,
        },
        "candidate": {
            "desired_roles": profile.desired_roles,
            "skills": profile.skills,
            "strengths": profile.strengths,
            "projects": profile.projects[:5],
        },
    }


@router.get("/interviews/{session_id}/transcript")
async def recent_transcript(
    session_id: str,
    last_seconds: int = Query(60, ge=1, le=3600),
    max_chars: int = Query(4000, ge=100, le=20000),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.scalars(
            select(TranscriptSegment)
            .where(
                TranscriptSegment.session_id == session_id,
                TranscriptSegment.timestamp >= datetime.utcnow() - timedelta(seconds=last_seconds),
            )
            .order_by(TranscriptSegment.timestamp)
        )
    ).all()
    result = [
        {
            "timestamp": r.timestamp.isoformat(),
            "speaker": r.speaker,
            "text": r.text,
            "confidence": r.confidence,
            "is_question": r.is_question,
        }
        for r in rows
    ]
    while len(str(result)) > max_chars and result:
        result.pop(0)
    return result


@router.post("/interviews/{session_id}/transcript")
async def add_transcript(session_id: str, data: TranscriptIn, db: AsyncSession = Depends(get_db)):
    session = await db.get(InterviewSession, session_id)
    if not session or session.status == "STOPPED":
        raise HTTPException(409, "Interview is missing or stopped")
    row = TranscriptSegment(
        session_id=session_id, **data.model_dump(), is_question=detect_question(data.text)
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/interviews/{session_id}/hints")
async def hint(session_id: str, data: HintIn, db: AsyncSession = Depends(get_db)):
    session = await db.get(InterviewSession, session_id)
    if not session or session.status == "STOPPED":
        raise HTTPException(409, "Interview is missing or stopped")
    row = InterviewHint(session_id=session_id, **data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await hub.publish(session_id, {"type": "hint", **data.model_dump()})
    return row


@router.post("/interviews/{session_id}/summary")
async def summary(session_id: str, content: dict[str, Any], db: AsyncSession = Depends(get_db)):
    row = InterviewSummary(session_id=session_id, content=content)
    db.add(row)
    await db.commit()
    return row


@router.get("/statistics")
async def statistics(db: AsyncSession = Depends(get_db)):
    vacancies_count = await db.scalar(select(func.count()).select_from(Vacancy)) or 0
    result: dict[str, int] = {"found": vacancies_count}
    for status in [
        "SUITABLE",
        "PREPARED",
        "APPLIED",
        "HR_REPLY",
        "INTERVIEW",
        "TEST_TASK",
        "OFFER",
        "REJECTED",
    ]:
        result[status.lower()] = await db.scalar(
            select(func.count()).select_from(Application).where(Application.status == status)
        ) or (
            await db.scalar(
                select(func.count()).select_from(Vacancy).where(Vacancy.status == status)
            )
            or 0
        )
    return result


class Hub:
    sockets: dict[str, list[WebSocket]] = {}

    async def connect(self, session_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.sockets.setdefault(session_id, []).append(ws)

    async def publish(self, session_id: str, data: dict[str, Any]) -> None:
        for ws in self.sockets.get(session_id, []):
            await ws.send_json(data)


hub = Hub()


@router.websocket("/ws/interview/{session_id}")
async def interview_ws(ws: WebSocket, session_id: str, token: str):
    async with __import__("app.db.session", fromlist=["SessionLocal"]).SessionLocal() as db:
        session = await db.get(InterviewSession, session_id)
        if not session or not secrets_compare(token, session.token):
            await ws.close(code=1008)
            return
        await hub.connect(session_id, ws)
        try:
            while True:
                data = await ws.receive_json()
                if data.get("type") == "transcript":
                    await db.refresh(session)
                    if session.status == "STOPPED":
                        await ws.close(code=1008)
                        break
                    row = TranscriptSegment(
                        session_id=session_id,
                        speaker=data.get("speaker", "interviewer"),
                        text=data["text"],
                        confidence=data.get("confidence", 1),
                        is_question=detect_question(data["text"]),
                    )
                    db.add(row)
                    await db.commit()
                await hub.publish(session_id, data)
        except WebSocketDisconnect:
            pass
        finally:
            if ws in hub.sockets.get(session_id, []):
                hub.sockets[session_id].remove(ws)


def secrets_compare(left: str, right: str) -> bool:
    import secrets

    return secrets.compare_digest(left, right)
