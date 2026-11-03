from __future__ import annotations

import asyncio
import json
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_db
from app.models import UploadedFile, User
from app.schemas import (
    AICheckResponse,
    ClassAskRequest,
    ClassAskResponse,
    StudyAskRequest,
    StudyAskResponse,
    FileUploadRead,
    SttCheckResponse,
    TranscribeResponse,
    VisualDocumentInfo,
    VisualJobStartResponse,
    VisualJobStatus,
    VisualProcessResponse,
)
from app.services.ai_provider import AIConfigurationError, AIProvider
from app.services.material_analyzer import analyze_materials
from app.services.visual_processor import (
    VISUAL_SUPPORTED_EXTENSIONS,
    VisualProcessingError,
    prepare_visual_document,
)
from app.crypto import decrypt_text, encrypt_text
from app.providers import effective_settings, language_rule, reply_language, stt_config, transcribe_audio
from app.security import get_optional_user, require_ai_access, require_stt_access


router = APIRouter(tags=["visual-analysis"])
JobState = Literal["queued", "running", "completed", "failed", "cancelled"]


@dataclass
class VisualJob:
    job_id: str
    filenames: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    status: JobState = "queued"
    stage: str = "queued"
    progress: int = 8
    message: str = "文件已上传，等待处理"
    error: str | None = None
    result: VisualProcessResponse | None = None
    work_dir: Path | None = None
    preview_paths: dict[int, Path] | None = None
    files_total: int = 0
    files_done: int = 0
    current_file: str | None = None
    pages_total: int = 0
    pages_done: int = 0
    batches_total: int = 0
    batches_done: int = 0
    # Who started the build; only they can read its status, result and files.
    owner_id: str | None = None


jobs: dict[str, VisualJob] = {}
tasks: dict[str, asyncio.Task[None]] = {}


def _status(job: VisualJob) -> VisualJobStatus:
    return VisualJobStatus(
        job_id=job.job_id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
        result=job.result,
        files_total=job.files_total,
        files_done=job.files_done,
        current_file=job.current_file,
        pages_total=job.pages_total,
        pages_done=job.pages_done,
        batches_total=job.batches_total,
        batches_done=job.batches_done,
    )


def _load_completed_job(job_id: str) -> VisualJob | None:
    try:
        normalized_id = str(uuid.UUID(job_id))
    except ValueError:
        return None
    work_dir = get_settings().artifacts_dir / "visual_jobs" / normalized_id
    result_path = work_dir / "result.json"
    if not result_path.exists():
        return None
    try:
        result = VisualProcessResponse.model_validate_json(decrypt_text(result_path.read_text(encoding="utf-8")))
        owner_id = json.loads((work_dir / "owner.json").read_text(encoding="utf-8")).get("owner_id")
    except (OSError, ValueError):
        return None

    preview_paths: dict[int, Path] = {}
    for index, document in enumerate(result.documents):
        original = work_dir / f"{index}-{Path(document.filename).name}"
        converted = work_dir / f"{Path(document.filename).stem}.pdf"
        candidate = converted if document.media_type == "application/pdf" and converted.exists() else original
        if candidate.exists():
            preview_paths[index] = candidate
    job = VisualJob(
        job_id=normalized_id,
        filenames=[document.filename for document in result.documents],
        status="completed",
        stage="completed",
        progress=100,
        message="分析完成，结果已保存",
        result=result,
        work_dir=work_dir,
        preview_paths=preview_paths,
        owner_id=owner_id,
    )
    jobs[normalized_id] = job
    return job


def _get_job(job_id: str) -> VisualJob | None:
    return jobs.get(job_id) or _load_completed_job(job_id)


async def _run_visual_job(
    job: VisualJob,
    stored_files: list[tuple[Path, str]],
    class_questions: list[str] | None = None,
    *,
    ai_settings: Settings | None = None,
    transcript: str = "",
    language: str = "zh",
) -> None:
    settings = get_settings()
    ai_settings = ai_settings or settings
    prepared = []
    try:
        job.status = "running"
        total = max(len(stored_files), 1)
        job.files_total = len(stored_files)
        for index, (stored_path, safe_name) in enumerate(stored_files):
            job.stage = "rendering"
            job.files_done = index
            job.current_file = safe_name
            job.progress = 18 + round(index / total * 35)
            job.message = f"正在逐页渲染 {safe_name}（第 {index + 1}/{job.files_total} 个文件）"
            document = await asyncio.to_thread(
                prepare_visual_document,
                stored_path,
                safe_name,
                job.work_dir or stored_path.parent,
                settings,
            )
            prepared.append(document)
            job.pages_done += document.pages
            job.message = f"已渲染 {safe_name} · {document.pages} 页（累计 {job.pages_done} 页）"
            await asyncio.sleep(0)

        job.files_done = job.files_total
        job.current_file = None
        total_pages = sum(item.pages for item in prepared)
        job.pages_total = total_pages
        job.pages_done = total_pages

        job.stage = "model"
        job.progress = 58
        job.message = (
            f"AI 正在逐文件分析 {len(prepared)} 个文件共 {total_pages} 页"
            if prepared
            else "AI 正在根据课堂转写整理笔记"
        )
        def batch_progress(done: int, total: int) -> None:
            job.batches_done, job.batches_total = done, total
            job.progress = 58 + round(done / max(total, 1) * 28)
            job.message = f"AI 正在分批阅读 {total_pages} 页（已完成 {done}/{total} 批）"

        analysis, usage = await analyze_materials(
            prepared,
            AIProvider(ai_settings),
            class_questions=class_questions,
            transcript=transcript,
            language=language,
            max_pages_per_request=settings.max_pages_per_ai_request,
            pages_per_batch=settings.pages_per_batch,
            concurrency=settings.ai_batch_concurrency,
            on_progress=batch_progress,
        )

        job.stage = "finalizing"
        job.progress = 92
        job.message = "正在整理学习路径与关键概念"
        job.preview_paths = {index: document.preview_path for index, document in enumerate(prepared)}
        job.result = VisualProcessResponse(
            documents=[
                VisualDocumentInfo(
                    filename=document.filename,
                    media_type=("application/pdf" if document.preview_path.suffix.lower() == ".pdf" else document.media_type),
                    pages=document.pages,
                    processing=document.processing,
                    preview_url=f"/api/process/{job.job_id}/files/{index}",
                )
                for index, document in enumerate(prepared)
            ],
            analysis=analysis,
            model=ai_settings.openai_chat_model,
            usage=usage,
        )
        if job.work_dir:
            (job.work_dir / "result.json").write_text(
                encrypt_text(json.dumps(job.result.model_dump(mode="json"), ensure_ascii=False)),
                encoding="utf-8",
            )
        job.status = "completed"
        job.stage = "completed"
        job.progress = 100
        job.message = "分析完成，已保存到当前课程"
    except asyncio.CancelledError:
        job.status = "cancelled"
        job.stage = "cancelled"
        job.message = "任务已取消"
        raise
    except (VisualProcessingError, AIConfigurationError) as exc:
        job.status = "failed"
        job.stage = "failed"
        job.error = str(exc)
        job.message = "材料准备失败"
    except Exception as exc:
        job.status = "failed"
        job.stage = "failed"
        job.error = f"上游模型调用失败：{exc}"
        job.message = "模型处理失败，可重试或取消"


def _parse_class_questions(raw: str | None) -> list[str]:
    """Questions the student asked in class (JSON list of strings), fed into the build."""
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(items, list):
        return []
    cleaned = [str(item).strip()[:300] for item in items if str(item).strip()]
    return cleaned[:40]


def _parse_upload_ids(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="upload_ids 格式错误") from exc
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="upload_ids 格式错误")
    return [str(item) for item in items][:50]


MAX_TRANSCRIPT_CHARS = 60000


@router.post("/process/start", response_model=VisualJobStartResponse)
async def start_visual_processing(
    request: Request,
    files: list[UploadFile] | None = File(default=None),
    upload_ids: str | None = Form(default=None),
    transcript: str | None = Form(default=None),
    class_questions: str | None = Form(default=None),
    user: User | None = Depends(require_ai_access),
    db: Session = Depends(get_db),
) -> VisualJobStartResponse:
    """Build notes for a section from any mix of files, earlier uploads and the class transcript."""
    settings = get_settings()
    ai_settings = effective_settings(request)
    if not ai_settings.ai_configured:
        raise HTTPException(status_code=503, detail="服务器还没有配置 AI 服务")
    files = files or []
    uploaded = _owned_uploads(db, _parse_upload_ids(upload_ids), user)
    transcript_text = (transcript or "").strip()[-MAX_TRANSCRIPT_CHARS:]
    if not files and not uploaded and not transcript_text:
        raise HTTPException(status_code=400, detail="至少上传一个文件或提供课堂转写")
    questions = _parse_class_questions(class_questions)

    job_id = str(uuid.uuid4())
    work_dir = settings.artifacts_dir / "visual_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    stored_files: list[tuple[Path, str]] = []
    total_bytes = 0
    max_bytes = settings.max_upload_mb * 1024 * 1024
    try:
        # Files uploaded earlier (e.g. during class) come first, in the order the browser listed them.
        for record in uploaded:
            safe_name = Path(record.filename).name
            stored_path = work_dir / f"{len(stored_files)}-{safe_name}"
            shutil.copyfile(record.stored_path, stored_path)
            stored_files.append((stored_path, safe_name))
        for upload in files:
            index = len(stored_files)
            safe_name = Path(upload.filename or f"upload-{index}").name
            if Path(safe_name).suffix.lower() not in VISUAL_SUPPORTED_EXTENSIONS:
                raise HTTPException(status_code=415, detail=f"不支持的文件格式：{safe_name}")
            stored_path = work_dir / f"{index}-{safe_name}"
            with stored_path.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise HTTPException(status_code=413, detail=f"本次上传总大小不能超过 {settings.max_upload_mb} MB")
                    output.write(chunk)
            stored_files.append((stored_path, safe_name))
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
    finally:
        for upload in files:
            await upload.close()

    owner_id = user.id if user else None
    (work_dir / "owner.json").write_text(json.dumps({"owner_id": owner_id}), encoding="utf-8")
    job = VisualJob(job_id=job_id, filenames=[safe_name for _, safe_name in stored_files], work_dir=work_dir, owner_id=owner_id)
    jobs[job_id] = job
    tasks[job_id] = asyncio.create_task(_run_visual_job(
        job,
        stored_files,
        questions,
        ai_settings=ai_settings,
        transcript=transcript_text,
        language=reply_language(request),
    ))
    return VisualJobStartResponse(job_id=job_id)


def _owned_uploads(db: Session, ids: list[str], user: User | None) -> list[UploadedFile]:
    records: list[UploadedFile] = []
    for upload_id in ids:
        record = db.get(UploadedFile, upload_id)
        owner = user.id if user else None
        if record is None or record.user_id != owner or not Path(record.stored_path).exists():
            raise HTTPException(status_code=404, detail="找不到之前上传的文件，请重新上传")
        records.append(record)
    return records


def _upload_user(user: User | None = Depends(get_optional_user)) -> User | None:
    if user is None and get_settings().ai_requires_login:
        raise HTTPException(status_code=401, detail="请先登录后再上传文件", headers={"WWW-Authenticate": "Bearer"})
    return user


@router.post("/uploads", response_model=FileUploadRead, status_code=201)
async def upload_course_file(
    file: UploadFile = File(...),
    user: User | None = Depends(_upload_user),
    db: Session = Depends(get_db),
) -> FileUploadRead:
    """Store a course file right away (e.g. slides shared mid-class) so a later build can use it."""
    settings = get_settings()
    safe_name = Path(file.filename or "upload").name
    if Path(safe_name).suffix.lower() not in VISUAL_SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"不支持的文件格式：{safe_name}")
    upload_id = str(uuid.uuid4())
    folder = settings.artifacts_dir / "uploads" / upload_id
    folder.mkdir(parents=True, exist_ok=True)
    # The original name lives (encrypted) in the database, not in the path.
    destination = folder / f"original{Path(safe_name).suffix.lower()}"
    size = 0
    max_bytes = settings.max_upload_mb * 1024 * 1024
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail=f"文件不能超过 {settings.max_upload_mb} MB")
                output.write(chunk)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    finally:
        await file.close()
    db.add(UploadedFile(
        id=upload_id, user_id=user.id if user else None, filename=safe_name, stored_path=str(destination), size=size
    ))
    db.commit()
    return FileUploadRead(id=upload_id, filename=safe_name, size=size)


def _owner_matches(job: VisualJob, user: User | None) -> bool:
    return job.owner_id == (user.id if user else None)


def _owned_job(job_id: str, user: User | None) -> VisualJob:
    job = _get_job(job_id)
    if not job or not _owner_matches(job, user):
        raise HTTPException(status_code=404, detail="处理任务不存在或服务已重启")
    return job


@router.get("/process")
def list_visual_jobs(user: User | None = Depends(get_optional_user)) -> list[dict[str, object]]:
    return [
        {
            "job_id": job.job_id,
            "status": job.status,
            "stage": job.stage,
            "progress": job.progress,
            "message": job.message,
            "filenames": job.filenames,
        }
        for job in sorted(jobs.values(), key=lambda item: item.created_at, reverse=True)
        if _owner_matches(job, user)
    ]


@router.post("/study/ask", response_model=StudyAskResponse)
async def ask_study_question(
    request: StudyAskRequest,
    http_request: Request,
    _user: User | None = Depends(require_ai_access),
) -> StudyAskResponse:
    settings = effective_settings(http_request)
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="AI 服务尚未配置")
    system_prompt = """你是 Course Replay 的课程导师。请基于给定的课程材料和当前学习节点回答学生问题。
只返回 JSON，不要使用 Markdown 代码块：
{
  "answer": "使用 Markdown 排版的简洁回答，先直接解答，再用 2-4 个短段落或列表展开，不超过 500 字",
  "add_node": true,
  "node_title": "2-14 字的新拓扑节点标题",
  "relation": "前置知识/深入理解/相关概念/应用",
  "new_dialog": false,
  "dialog_title": "2-12 字的独立话题标题"
}
answer 字段内的段落之间保留空行，步骤或并列要点使用有序或无序列表，关键概念可以加粗。不要将整篇回答挤成一段，也不要每句话都加标题。代码和公式使用对应的 Markdown 格式。JSON 字符串中的换行必须正确转义，确保整个响应是有效 JSON。
只有问题引入了现有拓扑中没有的前置知识、相关概念、应用方向或值得保留的深入分支时，add_node 才为 true。
换一种说法、简单澄清、重复提问、生成练习题时不要新增节点。node_title 不得与已有节点重复。
当 allow_new_dialog 为 true，且问题与课程、当前节点和当前对话主题明显无关时，new_dialog 必须为 true，并给出简短 dialog_title。
仅仅是从当前知识点自然延伸、追问课程相关概念时不要开启新对话。当 new_dialog 为 true 时，add_node 必须为 false。
当 allow_new_dialog 为 false 时，new_dialog 必须为 false。
current_content 是学生此刻正在看的讲稿内容，回答要与它一致、可以引用其中的例子。"""
    system_prompt += language_rule(reply_language(http_request))
    context = {
        "course_title": request.course_title,
        "current_topic": request.current_topic,
        "summary": request.summary,
        "learning_path": request.learning_path,
        "key_concepts": request.key_concepts,
        "existing_nodes": request.existing_nodes,
        "current_dialog_title": request.current_dialog_title,
        "current_content": request.current_content,
        "allow_new_dialog": request.allow_new_dialog,
        "question": request.question,
    }
    try:
        raw = await AIProvider(settings).chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
            ],
            max_tokens=900,
        )
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        payload = json.loads(cleaned)
        answer = str(payload.get("answer") or raw).strip()
        add_node = bool(payload.get("add_node"))
        node_title = str(payload.get("node_title") or "").strip()[:30] or None
        relation = str(payload.get("relation") or "").strip()[:30] or None
        new_dialog = bool(payload.get("new_dialog")) and request.allow_new_dialog
        dialog_title = str(payload.get("dialog_title") or "").strip()[:30] or None
        if new_dialog:
            add_node = False
            node_title = None
            relation = None
        return StudyAskResponse(
            answer=answer,
            add_node=add_node and bool(node_title),
            node_title=node_title if add_node else None,
            relation=relation if add_node else None,
            new_dialog=new_dialog,
            dialog_title=dialog_title if new_dialog else None,
        )
    except json.JSONDecodeError:
        return StudyAskResponse(answer=raw.strip(), add_node=False)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 回答失败：{exc}") from exc


CLASS_ASK_PROMPT = """你是 Course Replay 的随堂助教。学生正在上课，听不懂时会即时提问，需要马上看懂、不耽误继续听课。
回答要求：
- 第一句直接给出答案或结论，不要寒暄，不要复述问题。
- 之后用最多 3 个短要点或一个小例子讲清楚；需要时给公式（LaTeX：行内 $...$，独立 $$...$$）或代码。
- 全部控制在 250 字以内，使用 Markdown。
- 结合课程、老师正在讲的内容和之前的提问理解问题；"为什么""再讲一下"这类追问默认指最近一次提问。
- 课程材料没覆盖的内容可以用通用知识回答，但不要编造课程细节。
- 如果提供了课堂语音转写，优先结合老师刚讲的内容回答；转写可能有错别字，按上下文理解。"""


@router.post("/class/ask", response_model=ClassAskResponse)
async def ask_in_class(
    request: ClassAskRequest,
    http_request: Request,
    _user: User | None = Depends(require_ai_access),
) -> ClassAskResponse:
    """上课中: answer a question immediately, in a short form suited to reading mid-lecture."""
    settings = effective_settings(http_request)
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="AI 服务尚未配置")
    context_lines = [f"课程：{request.course_title}"]
    if request.section_title:
        context_lines.append(f"本节课：{request.section_title}")
    if request.current_topic:
        context_lines.append(f"老师正在讲：{request.current_topic}")
    if request.summary:
        context_lines.append(f"本节材料摘要：{request.summary}")
    if request.key_concepts:
        context_lines.append(f"关键概念：{'、'.join(request.key_concepts)}")
    if request.transcript.strip():
        context_lines.append(f"老师最近讲的内容（语音转写，可能有错字）：\n{request.transcript.strip()[-4000:]}")
    system = f"{CLASS_ASK_PROMPT}\n\n" + "\n".join(context_lines) + language_rule(reply_language(http_request))
    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for turn in request.recent[-4:]:
        if turn.question.strip() and turn.answer.strip():
            messages.append({"role": "user", "content": turn.question})
            messages.append({"role": "assistant", "content": turn.answer[:1500]})
    messages.append({"role": "user", "content": request.question})
    try:
        raw = await AIProvider(settings).chat(messages, temperature=0.3, max_tokens=700)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 回答失败：{exc}") from exc
    answer = raw.strip()
    if answer.startswith("```") and answer.endswith("```") and answer.count("```") == 2:
        answer = answer.removeprefix("```markdown").removeprefix("```").removesuffix("```").strip()
    return ClassAskResponse(answer=answer or "我暂时无法回答这个问题，可以换个说法再问一次。")


@router.post("/ai/check", response_model=AICheckResponse)
async def check_ai(request: Request, _user: User | None = Depends(require_ai_access)) -> AICheckResponse:
    """Real round trip to the chat model the user has selected (server default or their own)."""
    settings = effective_settings(request)
    source = "custom" if request.headers.get("X-AI-Key") else "server"
    if not settings.ai_configured:
        return AICheckResponse(ok=False, source=source, base_url=settings.openai_base_url, error="AI 尚未配置")
    started = time.perf_counter()
    try:
        reply = await AIProvider(settings).chat(
            [{"role": "user", "content": "Reply with the single word OK."}], temperature=0, max_tokens=16
        )
    except Exception as exc:
        return AICheckResponse(
            ok=False, source=source, base_url=settings.openai_base_url, model=settings.openai_chat_model, error=str(exc)
        )
    return AICheckResponse(
        ok=True,
        source=source,
        base_url=settings.openai_base_url,
        model=settings.openai_chat_model,
        latency_ms=round((time.perf_counter() - started) * 1000),
        reply=reply.strip()[:40],
    )


def _check_wav(seconds: float = 1.0, rate: int = 16000) -> bytes:
    """A short, quiet WAV for testing a speech-to-text provider without a microphone."""
    import io
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"\x00\x00" * int(seconds * rate))
    return buffer.getvalue()


@router.post("/stt/check", response_model=SttCheckResponse)
async def check_stt(request: Request, _user: User | None = Depends(require_stt_access)) -> SttCheckResponse:
    """Real round trip to the speech-to-text service the user has selected (no microphone needed)."""
    config = stt_config(request)
    if not config.configured:
        return SttCheckResponse(ok=False, source=config.source, base_url=config.base_url, model=config.model,
                                error="服务器还没有配置语音识别，可以改用自己的接口或浏览器内置识别")
    try:
        _, latency = await transcribe_audio(config, _check_wav(), "check.wav", "audio/wav")
    except RuntimeError as exc:
        return SttCheckResponse(ok=False, source=config.source, base_url=config.base_url, model=config.model, error=str(exc))
    return SttCheckResponse(ok=True, source=config.source, base_url=config.base_url, model=config.model, latency_ms=latency)


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    prompt: str | None = Form(default=None),
    _user: User | None = Depends(require_stt_access),
) -> TranscribeResponse:
    """上课中: speech-to-text for one short audio chunk recorded in the browser."""
    settings = get_settings()
    config = stt_config(request)
    if not config.configured:
        raise HTTPException(status_code=503, detail="服务器还没有配置语音识别，可以在设置里填写自己的语音识别接口")
    max_bytes = settings.max_audio_mb * 1024 * 1024
    audio = await file.read(max_bytes + 1)
    await file.close()
    if len(audio) > max_bytes:
        raise HTTPException(status_code=413, detail=f"音频不能超过 {settings.max_audio_mb} MB")
    if not audio:
        raise HTTPException(status_code=400, detail="音频为空")
    try:
        text, latency = await transcribe_audio(
            config,
            audio,
            Path(file.filename or "chunk.wav").name,
            file.content_type or "audio/wav",
            language=language,
            prompt=prompt,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return TranscribeResponse(text=text, model=config.model, source=config.source, latency_ms=latency)

@router.get("/process/{job_id}", response_model=VisualJobStatus)
def get_visual_job(job_id: str, user: User | None = Depends(get_optional_user)) -> VisualJobStatus:
    return _status(_owned_job(job_id, user))


@router.delete("/process/{job_id}", response_model=VisualJobStatus)
async def cancel_visual_job(job_id: str, user: User | None = Depends(get_optional_user)) -> VisualJobStatus:
    job = _owned_job(job_id, user)
    task = tasks.get(job_id)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    if job.status not in {"completed", "failed"}:
        job.status = "cancelled"
        job.stage = "cancelled"
        job.message = "任务已取消"
    return _status(job)


@router.get("/process/{job_id}/files/{file_index}")
def preview_visual_file(job_id: str, file_index: int, user: User | None = Depends(get_optional_user)) -> FileResponse:
    job = _owned_job(job_id, user)
    path = job.preview_paths.get(file_index) if job.preview_paths else None
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="预览文件不存在")
    media_type = "application/pdf" if path.suffix.lower() == ".pdf" else None
    return FileResponse(path, media_type=media_type)
