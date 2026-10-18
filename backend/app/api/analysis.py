from __future__ import annotations

import asyncio
import json
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import get_settings
from app.schemas import (
    StudyAskRequest,
    StudyAskResponse,
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
        result = VisualProcessResponse.model_validate_json(result_path.read_text(encoding="utf-8"))
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
    )
    jobs[normalized_id] = job
    return job


def _get_job(job_id: str) -> VisualJob | None:
    return jobs.get(job_id) or _load_completed_job(job_id)


async def _run_visual_job(job: VisualJob, stored_files: list[tuple[Path, str]]) -> None:
    settings = get_settings()
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
        job.message = f"AI 正在逐文件分析 {len(prepared)} 个文件共 {total_pages} 页"
        analysis, usage = await analyze_materials(prepared, AIProvider(settings))

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
            model=settings.openai_chat_model,
            usage=usage,
        )
        if job.work_dir:
            (job.work_dir / "result.json").write_text(
                json.dumps(job.result.model_dump(mode="json"), ensure_ascii=False, indent=2),
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


@router.post("/process/start", response_model=VisualJobStartResponse)
async def start_visual_processing(files: list[UploadFile] = File(...)) -> VisualJobStartResponse:
    settings = get_settings()
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="请在根目录 .env 配置 OPENAI_API_KEY 和 OPENAI_CHAT_MODEL")
    if not files:
        raise HTTPException(status_code=400, detail="至少上传一个文件")

    job_id = str(uuid.uuid4())
    work_dir = settings.artifacts_dir / "visual_jobs" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    stored_files: list[tuple[Path, str]] = []
    total_bytes = 0
    max_bytes = settings.max_upload_mb * 1024 * 1024
    try:
        for index, upload in enumerate(files):
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

    job = VisualJob(job_id=job_id, filenames=[safe_name for _, safe_name in stored_files], work_dir=work_dir)
    jobs[job_id] = job
    tasks[job_id] = asyncio.create_task(_run_visual_job(job, stored_files))
    return VisualJobStartResponse(job_id=job_id)


@router.get("/process")
def list_visual_jobs() -> list[dict[str, object]]:
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
    ]


@router.post("/study/ask", response_model=StudyAskResponse)
async def ask_study_question(request: StudyAskRequest) -> StudyAskResponse:
    settings = get_settings()
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
当 allow_new_dialog 为 false 时，new_dialog 必须为 false。默认使用简体中文。"""
    context = {
        "course_title": request.course_title,
        "current_topic": request.current_topic,
        "summary": request.summary,
        "learning_path": request.learning_path,
        "key_concepts": request.key_concepts,
        "existing_nodes": request.existing_nodes,
        "current_dialog_title": request.current_dialog_title,
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


@router.get("/process/{job_id}", response_model=VisualJobStatus)
def get_visual_job(job_id: str) -> VisualJobStatus:
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="处理任务不存在或服务已重启")
    return _status(job)


@router.delete("/process/{job_id}", response_model=VisualJobStatus)
async def cancel_visual_job(job_id: str) -> VisualJobStatus:
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="处理任务不存在")
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
def preview_visual_file(job_id: str, file_index: int) -> FileResponse:
    job = _get_job(job_id)
    path = job.preview_paths.get(file_index) if job and job.preview_paths else None
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="预览文件不存在")
    media_type = "application/pdf" if path.suffix.lower() == ".pdf" else None
    return FileResponse(path, media_type=media_type)
