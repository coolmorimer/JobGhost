from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class CandidateIn(BaseModel):
    name: str = ""
    location: str = ""
    relocation: bool = False
    remote: bool = True
    employment_types: list[str] = Field(default_factory=list)
    desired_roles: list[str] = Field(default_factory=list)
    excluded_roles: list[str] = Field(default_factory=list)
    minimum_salary: int | None = None
    desired_salary: int | None = None
    skills: dict[str, str] = Field(default_factory=dict)
    experience: list[dict[str, Any]] = Field(default_factory=list)
    projects: list[dict[str, Any]] = Field(default_factory=list)
    education: list[dict[str, Any]] = Field(default_factory=list)
    languages: dict[str, str] = Field(default_factory=dict)
    links: dict[str, str] = Field(default_factory=dict)
    strengths: list[str] = Field(default_factory=list)
    preferences: dict[str, Any] = Field(default_factory=dict)
    blacklisted_companies: list[str] = Field(default_factory=list)
    blacklisted_keywords: list[str] = Field(default_factory=list)


class CandidateOut(CandidateIn, ORM):
    id: str


class ScoreIn(BaseModel):
    vacancy_id: str
    score: int = Field(ge=0, le=100)
    decision: str
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    reason: str = ""
    best_resume_id: str | None = None


class ApplicationPrepare(BaseModel):
    vacancy_id: str
    resume_id: str | None = None
    cover_letter: str = ""
    mode: str = "MANUAL"


class TranscriptIn(BaseModel):
    speaker: str = "interviewer"
    text: str
    confidence: float = Field(default=1, ge=0, le=1)


class HintIn(BaseModel):
    question: str
    mode: str = "Hint"
    hints: list[str] = Field(min_length=1, max_length=7)
    example_from_experience: str = ""
    warning: str = ""


class VacancyOut(ORM):
    id: str
    external_id: str
    provider: str
    url: str
    title: str
    company: str
    description: str
    requirements: str
    responsibilities: str
    skills: list[str]
    salary_from: int | None
    salary_to: int | None
    currency: str
    location: str
    remote: bool
    employment: str
    experience: str
    status: str
    published_at: datetime
