from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    ai_configured: bool


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
