"""Shared response models for the Delta API."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class APIError(ContractModel):
    code: str
    message: str
    retryable: bool


class APIErrorResponse(ContractModel):
    error: APIError


class HealthResponse(ContractModel):
    status: Literal['ok']
    service: Literal['delta']
    version: str


class RoleOption(ContractModel):
    id: str
    label: str


class AnalysisAccepted(ContractModel):
    analysis_id: str


AnalysisState = Literal[
    'queued',
    'reading_pdf',
    'collecting_jobs',
    'analyzing',
    'done',
    'failed',
    'cancelled',
]


class AnalysisStatusResponse(ContractModel):
    status: AnalysisState
    progress_percent: int = Field(ge=0, le=100)
    stage_message: str
    warnings: list[str]
    error: APIError | None


class AnalysisCancelResponse(ContractModel):
    status: AnalysisState


class CurriculumEvidence(ContractModel):
    page: int = Field(ge=1)
    excerpt: str


class JobEvidence(ContractModel):
    url: str
    excerpt: str


CurriculumStatus = Literal[
    'explicit',
    'inferred',
    'not_found',
    'insufficient_evidence',
]


class SkillReport(ContractModel):
    name: str
    job_count: int = Field(ge=0)
    share_percent: float = Field(ge=0, le=100)
    curriculum_status: CurriculumStatus
    curriculum_evidence: list[CurriculumEvidence]
    job_evidence: list[JobEvidence]


class SyllabusAnchor(ContractModel):
    page: int = Field(ge=1)
    excerpt: str


class CourseOutcome(ContractModel):
    id: str
    statement: str
    page: int = Field(ge=1)


class SkillGap(ContractModel):
    name: str
    job_count: int = Field(ge=0)
    share_percent: float = Field(ge=0, le=100)
    category: str
    priority: str
    foundation: str
    syllabus_anchor: SyllabusAnchor | None
    course_outcome: CourseOutcome | None
    interpretation: str
    curriculum_evidence: list[CurriculumEvidence]
    job_evidence: list[JobEvidence]


class LabSuggestion(ContractModel):
    name: str
    title: str
    duration_minutes: int = Field(gt=0)
    foundation: str
    page: int = Field(ge=1)
    course_outcome: CourseOutcome | None
    faculty_review_required: bool
    prerequisites: str
    tasks: list[str]
    rubric: dict[str, int]
    verification_checklist: list[str]
    faculty_notes: str


class JobPosting(ContractModel):
    title: str
    company: str
    location: str
    url: str
    date_posted: str | None


class MarketSource(ContractModel):
    source: str
    status: str
    fetched: int = Field(ge=0)


class MarketReport(ContractModel):
    sample_size: int = Field(ge=0)
    collected_at: str
    cached: bool
    sources: list[MarketSource]
    excluded: dict[str, int]
    warnings: list[str]


class AnalysisSummary(ContractModel):
    analyzed_jobs: int = Field(ge=0)
    mention_coverage_percent: float | None = Field(default=None, ge=0, le=100)
    detected_curriculum_skills: int = Field(ge=0)
    demanded_skills: int = Field(ge=0)
    missing_skills: int = Field(ge=0)


class AIReport(ContractModel):
    available: bool
    explanations: list[str] = Field(
        description='AI-generated explanations only; never use for deterministic counts or evidence.'
    )
    roadmap: list[str] = Field(
        description='AI-generated suggestions only; never invent jobs or syllabus content.'
    )


class AnalysisReport(ContractModel):
    role: str
    generated_at: str
    filename: str
    market: MarketReport
    summary: AnalysisSummary
    skills: list[SkillReport]
    gaps: list[SkillGap]
    lab_suggestions: list[LabSuggestion]
    jobs: list[JobPosting]
    methodology: str
    limitations: list[str]
    ai: AIReport
