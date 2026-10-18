import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Chunk, Course, Document, ProcessingTask
from app.schemas import ChunkRead, DocumentRead, TaskRead, UploadResponse
from app.services.document_service import process_document
from app.services.parser import SUPPORTED_EXTENSIONS

router = APIRouter(tags=["documents"])


async def save_upload(file: UploadFile, destination: Path, max_bytes: int) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail=f"File exceeds {max_bytes // 1024 // 1024} MB")
                digest.update(chunk)
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    return size, digest.hexdigest()


@router.post(
    "/courses/{course_id}/documents",
    response_model=UploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_documents(
    course_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> UploadResponse:
    if db.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="Course not found")
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    uploaded: list[DocumentRead] = []

    for file in files:
        original_name = Path(file.filename or "upload").name
        suffix = Path(original_name).suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported file type {suffix or '<none>'}; allowed: {sorted(SUPPORTED_EXTENSIONS)}",
            )

        stored_name = f"{uuid4()}{suffix}"
        destination = settings.artifacts_dir / course_id / "uploads" / stored_name
        _, sha256 = await save_upload(file, destination, max_bytes)

        existing = db.scalar(
            select(Document).where(Document.course_id == course_id, Document.sha256 == sha256)
        )
        if existing is not None:
            destination.unlink(missing_ok=True)
            uploaded.append(DocumentRead.model_validate(existing))
            continue

        document = Document(
            course_id=course_id,
            filename=original_name,
            stored_path=str(destination.resolve()),
            file_type=suffix.lstrip("."),
            sha256=sha256,
        )
        db.add(document)
        db.flush()
        task = ProcessingTask(course_id=course_id, document_id=document.id)
        db.add(task)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            destination.unlink(missing_ok=True)
            existing = db.scalar(
                select(Document).where(Document.course_id == course_id, Document.sha256 == sha256)
            )
            if existing is None:
                raise
            uploaded.append(DocumentRead.model_validate(existing))
            continue

        db.refresh(document)
        db.refresh(task)
        uploaded.append(DocumentRead.model_validate(document))
        background_tasks.add_task(process_document, document.id, task.id)

    return UploadResponse(documents=uploaded)


@router.get("/courses/{course_id}/documents", response_model=list[DocumentRead])
def list_documents(course_id: str, db: Session = Depends(get_db)) -> list[Document]:
    if db.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return list(
        db.scalars(select(Document).where(Document.course_id == course_id).order_by(Document.created_at.desc()))
    )


@router.get("/tasks/{task_id}", response_model=TaskRead)
def get_task(task_id: str, db: Session = Depends(get_db)) -> ProcessingTask:
    task = db.get(ProcessingTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/documents/{document_id}/content", response_model=list[ChunkRead])
def get_document_content(document_id: str, db: Session = Depends(get_db)) -> list[Chunk]:
    if db.get(Document, document_id) is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return list(
        db.scalars(
            select(Chunk)
            .where(Chunk.document_id == document_id)
            .order_by(Chunk.page, Chunk.slide, Chunk.id)
        )
    )
