import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def uid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class ApplicationStatus(enum.StrEnum):
    FOUND = "FOUND"
    SUITABLE = "SUITABLE"
    PREPARED = "PREPARED"
    APPLIED = "APPLIED"
    HR_REPLY = "HR_REPLY"
    INTERVIEW = "INTERVIEW"
    TEST_TASK = "TEST_TASK"
    OFFER = "OFFER"
    REJECTED = "REJECTED"
    IGNORED = "IGNORED"


class CandidateProfile(Base):
    __tablename__ = "candidate_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200), default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    relocation: Mapped[bool] = mapped_column(Boolean, default=False)
    remote: Mapped[bool] = mapped_column(Boolean, default=True)
    employment_types: Mapped[list[str]] = mapped_column(JSON, default=list)
    desired_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    excluded_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    minimum_salary: Mapped[int | None] = mapped_column(Integer)
    desired_salary: Mapped[int | None] = mapped_column(Integer)
    skills: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    experience: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    projects: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    education: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    languages: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    links: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    strengths: Mapped[list[str]] = mapped_column(JSON, default=list)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    blacklisted_companies: Mapped[list[str]] = mapped_column(JSON, default=list)
    blacklisted_keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class Resume(Base):
    __tablename__ = "resumes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    hh_resume_id: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    preferred_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    file_path: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class SearchProfile(Base):
    __tablename__ = "search_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    excluded_keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    salary_min: Mapped[int | None] = mapped_column(Integer)
    locations: Mapped[list[str]] = mapped_column(JSON, default=list)
    remote: Mapped[bool | None] = mapped_column(Boolean)
    experience: Mapped[list[str]] = mapped_column(JSON, default=list)
    providers: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["mock"])
    minimum_score: Mapped[int] = mapped_column(Integer, default=70)
    auto_apply: Mapped[bool] = mapped_column(Boolean, default=False)


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    provider: Mapped[str] = mapped_column(String(30))
    external_id: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(250))
    raw_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("provider", "external_id"),)


class Vacancy(Base):
    __tablename__ = "vacancies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    external_id: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(30), index=True)
    url: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str] = mapped_column(String(300), index=True)
    company: Mapped[str] = mapped_column(String(250), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    requirements: Mapped[str] = mapped_column(Text, default="")
    responsibilities: Mapped[str] = mapped_column(Text, default="")
    skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    salary_from: Mapped[int | None] = mapped_column(Integer)
    salary_to: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(10), default="RUR")
    location: Mapped[str] = mapped_column(String(200), default="")
    remote: Mapped[bool] = mapped_column(Boolean, default=False)
    employment: Mapped[str] = mapped_column(String(100), default="full")
    experience: Mapped[str] = mapped_column(String(100), default="")
    status: Mapped[str] = mapped_column(String(40), default="NEEDS_AI_SCORE", index=True)
    raw_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    published_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    scores: Mapped[list["VacancyScore"]] = relationship(back_populates="vacancy")
    __table_args__ = (
        UniqueConstraint("provider", "external_id"),
        Index("ix_vacancy_status_created", "status", "created_at"),
    )


class VacancyScore(Base):
    __tablename__ = "vacancy_scores"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    vacancy_id: Mapped[str] = mapped_column(ForeignKey("vacancies.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)
    decision: Mapped[str] = mapped_column(String(30))
    strengths: Mapped[list[str]] = mapped_column(JSON, default=list)
    gaps: Mapped[list[str]] = mapped_column(JSON, default=list)
    risks: Mapped[list[str]] = mapped_column(JSON, default=list)
    reason: Mapped[str] = mapped_column(Text, default="")
    best_resume_id: Mapped[str | None] = mapped_column(ForeignKey("resumes.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    vacancy: Mapped[Vacancy] = relationship(back_populates="scores")


class Application(Base):
    __tablename__ = "applications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    vacancy_id: Mapped[str] = mapped_column(ForeignKey("vacancies.id"), unique=True, index=True)
    resume_id: Mapped[str | None] = mapped_column(ForeignKey("resumes.id"))
    status: Mapped[str] = mapped_column(
        String(40), default=ApplicationStatus.PREPARED.value, index=True
    )
    mode: Mapped[str] = mapped_column(String(20), default="MANUAL")
    cover_letter: Mapped[str] = mapped_column(Text, default="")
    provider_application_id: Mapped[str | None] = mapped_column(String(200))
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id"), index=True)
    direction: Mapped[str] = mapped_column(String(10))
    text: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    vacancy_id: Mapped[str] = mapped_column(ForeignKey("vacancies.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    pin: Mapped[str] = mapped_column(String(10))
    token: Mapped[str] = mapped_column(String(100), unique=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime)


class TranscriptSegment(Base):
    __tablename__ = "interview_transcript_segments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("interview_sessions.id"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    speaker: Mapped[str] = mapped_column(String(30), default="interviewer")
    text: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    is_question: Mapped[bool] = mapped_column(Boolean, default=False)


class InterviewHint(Base):
    __tablename__ = "interview_hints"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("interview_sessions.id"), index=True)
    question: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(20), default="Hint")
    hints: Mapped[list[str]] = mapped_column(JSON, default=list)
    example_from_experience: Mapped[str] = mapped_column(Text, default="")
    warning: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class InterviewSummary(Base):
    __tablename__ = "interview_summaries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("interview_sessions.id"), unique=True)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(1000), default="Введено пользователем")


class AssistantSession(Base):
    """Only explicitly saved sessions belong here; ephemeral sessions never touch disk."""
    __tablename__ = "assistant_context_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    content: Mapped[dict[str, Any]] = mapped_column(JSON)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), index=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
