from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    ai_configured: bool
    configured: bool
    provider: str
    base_url: str
    model: str | None
    office_conversion: bool
    processing_mode: str


class CourseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=20)


class CourseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str
    tags: list[str]
    status: str
    document_count: int = 0
    knowledge_count: int = 0
    mastery: float = 0.0
    created_at: datetime
    updated_at: datetime


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    file_type: str
    status: str
    progress: int
    total_pages: int
    error: str | None
    created_at: datetime


class UploadResponse(BaseModel):
    documents: list[DocumentRead]


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    document_id: str
    stage: str
    progress: int
    message: str
    status: str
    error: str | None
    created_at: datetime
    updated_at: datetime


class ChunkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    text: str
    page: int | None
    slide: int | None
    section: str | None
    source_location: str


class VisualDocumentInfo(BaseModel):
    filename: str
    media_type: str
    pages: int = 1
    processing: str
    preview_url: str


class CourseMaterialAnalysis(BaseModel):
    title: str = "课堂材料分析"
    summary: str
    learning_path: list[str] = Field(default_factory=list)
    key_concepts: list[str] = Field(default_factory=list)
    review_questions: list[str] = Field(default_factory=list)
    raw: str | None = None


class VisualProcessResponse(BaseModel):
    documents: list[VisualDocumentInfo]
    analysis: CourseMaterialAnalysis
    model: str
    provider: str = "CheapRouter"
    usage: dict[str, Any] | None = None


class VisualJobStartResponse(BaseModel):
    job_id: str
    status: str = "queued"


class VisualJobStatus(BaseModel):
    job_id: str
    status: str
    stage: str
    progress: int
    message: str
    error: str | None = None
    result: VisualProcessResponse | None = None


class StudyAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    course_title: str = Field(default="课程", max_length=200)
    current_topic: str = Field(default="", max_length=300)
    summary: str = Field(default="", max_length=4000)
    learning_path: list[str] = Field(default_factory=list, max_length=20)
    key_concepts: list[str] = Field(default_factory=list, max_length=30)
    existing_nodes: list[str] = Field(default_factory=list, max_length=50)


class StudyAskResponse(BaseModel):
    answer: str
    add_node: bool = False
    node_title: str | None = None
    relation: str | None = None
