from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import get_settings
from app.schemas import VisualDocumentInfo, VisualProcessResponse
from app.services.ai_provider import AIConfigurationError, AIProvider
from app.services.material_analyzer import analyze_materials
from app.services.visual_processor import (
    VISUAL_SUPPORTED_EXTENSIONS,
    VisualProcessingError,
    prepare_visual_document,
)


router = APIRouter(tags=["visual-analysis"])


@router.post("/process", response_model=VisualProcessResponse)
async def process_visual_materials(files: list[UploadFile] = File(...)) -> VisualProcessResponse:
    settings = get_settings()
    if not settings.ai_configured:
        raise HTTPException(
            status_code=503,
            detail="请在项目根目录 .env 配置 OPENAI_API_KEY 和 OPENAI_CHAT_MODEL",
        )
    if not files:
        raise HTTPException(status_code=400, detail="至少上传一个文件")

    prepared = []
    total_bytes = 0
    max_bytes = settings.max_upload_mb * 1024 * 1024
    try:
        with tempfile.TemporaryDirectory(prefix="course-replay-") as temporary_directory:
            work_dir = Path(temporary_directory)
            for index, upload in enumerate(files):
                safe_name = Path(upload.filename or f"upload-{index}").name
                if Path(safe_name).suffix.lower() not in VISUAL_SUPPORTED_EXTENSIONS:
                    raise HTTPException(status_code=415, detail=f"不支持的文件格式：{safe_name}")
                stored_path = work_dir / f"{index}-{safe_name}"
                with stored_path.open("wb") as output:
                    while chunk := await upload.read(1024 * 1024):
                        total_bytes += len(chunk)
                        if total_bytes > max_bytes:
                            raise HTTPException(
                                status_code=413,
                                detail=f"本次上传总大小不能超过 {settings.max_upload_mb} MB",
                            )
                        output.write(chunk)
                prepared.append(prepare_visual_document(stored_path, safe_name, work_dir, settings))

            analysis, usage = await analyze_materials(prepared, AIProvider(settings))
    except HTTPException:
        raise
    except (VisualProcessingError, AIConfigurationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"上游模型调用失败：{exc}") from exc
    finally:
        for upload in files:
            await upload.close()

    return VisualProcessResponse(
        documents=[
            VisualDocumentInfo(
                filename=document.filename,
                media_type=document.media_type,
                pages=document.pages,
                processing=document.processing,
            )
            for document in prepared
        ],
        analysis=analysis,
        model=settings.openai_chat_model,
        usage=usage,
    )
