from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


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
    stt_configured: bool = False
    stt_base_url: str = ""
    stt_model: str | None = None
    database: str = "sqlite"
    ai_requires_login: bool = True
    custom_providers: bool = True


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


class CourseSection(BaseModel):
    title: str
    content: str
    key_points: list[str] = Field(default_factory=list)
    source_filename: str = ""
    source_page: int = Field(default=1, ge=1)


class AnalysisKnowledgeNode(BaseModel):
    id: str = ""
    title: str = ""
    tier: str = "core"  # prereq | core | advanced
    summary: str = ""
    content: str = ""  # instructor-style Markdown (GFM + LaTeX)


class CourseMaterialAnalysis(BaseModel):
    title: str = "课堂材料分析"
    summary: str
    learning_path: list[str] = Field(default_factory=list)
    key_concepts: list[str] = Field(default_factory=list)
    review_questions: list[str] = Field(default_factory=list)
    # dev's section-based content (kept for compatibility) + this branch's tiered map
    sections: list[CourseSection] = Field(default_factory=list)
    knowledge_map: list[AnalysisKnowledgeNode] = Field(default_factory=list)
    raw: str | None = None


class VisualProcessResponse(BaseModel):
    documents: list[VisualDocumentInfo]
    analysis: CourseMaterialAnalysis
    model: str
    provider: str = ""
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
    files_total: int = 0
    files_done: int = 0
    current_file: str | None = None
    pages_total: int = 0
    pages_done: int = 0
    # Long material is read by the AI in batches; 0 when it fits in one request.
    batches_total: int = 0
    batches_done: int = 0


class StudyAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    course_title: str = Field(default="课程", max_length=200)
    current_topic: str = Field(default="", max_length=300)
    summary: str = Field(default="", max_length=4000)
    learning_path: list[str] = Field(default_factory=list, max_length=20)
    key_concepts: list[str] = Field(default_factory=list, max_length=30)
    existing_nodes: list[str] = Field(default_factory=list, max_length=50)
    current_dialog_title: str = Field(default="当前节点", max_length=100)
    allow_new_dialog: bool = True


class StudyAskResponse(BaseModel):
    answer: str
    add_node: bool = False
    node_title: str | None = None
    relation: str | None = None
    new_dialog: bool = False
    dialog_title: str | None = None


# ---------------------------------------------------------------------------
# In-class (上课中) questions
# ---------------------------------------------------------------------------


class ClassAskTurn(BaseModel):
    question: str = Field(max_length=2000)
    answer: str = Field(default="", max_length=6000)


class ClassAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    course_title: str = Field(default="课程", max_length=200)
    section_title: str = Field(default="", max_length=200)
    current_topic: str = Field(default="", max_length=300)
    summary: str = Field(default="", max_length=4000)
    key_concepts: list[str] = Field(default_factory=list, max_length=30)
    recent: list[ClassAskTurn] = Field(default_factory=list, max_length=6)
    # Last few minutes of the live transcript, so answers follow what the teacher just said.
    transcript: str = Field(default="", max_length=8000)


class ClassAskResponse(BaseModel):
    answer: str


class AICheckResponse(BaseModel):
    ok: bool
    source: str  # "server" | "custom"
    base_url: str
    model: str | None = None
    latency_ms: int | None = None
    reply: str | None = None
    error: str | None = None


class TranscribeResponse(BaseModel):
    text: str
    model: str
    source: str
    latency_ms: int


class FileUploadRead(BaseModel):
    id: str
    filename: str
    size: int


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

USERNAME_PATTERN = r"^[\w.@-]{2,32}$"


class RegisterRequest(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(default="", max_length=32)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class UserRead(BaseModel):
    id: str
    username: str
    display_name: str
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: UserRead


class UserUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=32)


# ---------------------------------------------------------------------------
# Study workspace. Field names mirror the web app's TypeScript types
# (camelCase on the wire) so the browser can send and receive them as-is.
# ---------------------------------------------------------------------------

ClientId = Annotated[str, Field(min_length=1, max_length=200)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class WorkspaceMaterial(CamelModel):
    id: ClientId
    name: str = ""
    meta: str = ""
    type: str = Field(default="", max_length=32)
    status: str = Field(default="pending", max_length=32)
    progress: int | None = None
    error: str | None = None
    preview_url: str | None = None
    pages: int | None = None
    upload_id: str | None = Field(default=None, max_length=36)


class WorkspaceTranscriptSegment(CamelModel):
    id: ClientId
    text: str = ""
    started_at: int = 0
    ended_at: int | None = None


class WorkspaceMessage(CamelModel):
    id: ClientId
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = ""
    node_id: str | None = Field(default=None, max_length=200)


class WorkspaceBranch(CamelModel):
    id: ClientId
    title: str = ""
    parent_id: str = Field(default="", max_length=200)
    question: str = ""


class WorkspaceClassQuestion(CamelModel):
    id: ClientId
    question: str = ""
    answer: str = ""
    topic: str | None = None
    status: str = Field(default="answered", pattern=r"^(answering|answered|failed)$")
    asked_at: int = 0
    answered_at: int | None = None


class WorkspaceSection(CamelModel):
    id: ClientId
    title: str = ""
    created_at: int = 0
    status: str = Field(default="empty", max_length=32)
    materials: list[WorkspaceMaterial] = Field(default_factory=list, max_length=500)
    analysis: dict[str, Any] | None = None
    analysis_job_id: str | None = Field(default=None, max_length=64)
    knowledge_map: list[dict[str, Any]] | None = None
    processing_job: dict[str, Any] | None = None
    exploration_nodes: list[WorkspaceBranch] | None = Field(default=None, max_length=1000)
    chat_history: list[WorkspaceMessage] | None = Field(default=None, max_length=5000)
    mastery: float | None = None
    class_questions: list[WorkspaceClassQuestion] | None = Field(default=None, max_length=2000)
    live_started_at: int | None = None
    live_ended_at: int | None = None
    live_topic: str | None = None
    auto_title: bool | None = None
    transcript: list[WorkspaceTranscriptSegment] | None = Field(default=None, max_length=5000)
    # Study activity: knowledge points studied, last position, minutes per day (dashboard stats).
    study: dict[str, Any] | None = None


class WorkspaceCourse(CamelModel):
    id: ClientId
    title: str = ""
    code: str = ""
    description: str = ""
    tags: list[str] = Field(default_factory=list, max_length=50)
    mastery: float = 0
    updated: str = ""
    accent: str = Field(default="#c7f45d", max_length=32)
    sections: list[WorkspaceSection] = Field(default_factory=list)


class WorkspaceRead(CamelModel):
    courses: list[WorkspaceCourse]


class WorkspaceCoursePut(CamelModel):
    """Course fields plus the ordered section ids; sections not listed are deleted."""

    id: ClientId
    title: str = ""
    code: str = ""
    description: str = ""
    tags: list[str] = Field(default_factory=list, max_length=50)
    mastery: float = 0
    updated: str = ""
    accent: str = Field(default="#c7f45d", max_length=32)
    position: int = 0
    section_ids: list[str] = Field(default_factory=list, max_length=500)


class WorkspaceSectionPut(CamelModel):
    course_id: ClientId
    position: int = 0
    section: WorkspaceSection
