import asyncio
from pathlib import Path

from app.database import SessionLocal
from app.models import Chunk, Document, DocumentStatus, ProcessingTask
from app.services.chunker import chunk_sections
from app.services.parser import parse_document


async def process_document(document_id: str, task_id: str) -> None:
    await asyncio.to_thread(_process_document_sync, document_id, task_id)


def _process_document_sync(document_id: str, task_id: str) -> None:
    with SessionLocal() as db:
        document = db.get(Document, document_id)
        task = db.get(ProcessingTask, task_id)
        if document is None or task is None:
            return

        try:
            task.status = "running"
            task.stage = "extracting"
            task.progress = 20
            task.message = "Extracting document text"
            document.progress = 20
            db.commit()

            sections = parse_document(Path(document.stored_path))
            document.total_pages = len(sections)

            task.stage = "chunking"
            task.progress = 60
            task.message = "Building searchable chunks"
            document.progress = 60
            db.commit()

            db.query(Chunk).filter(Chunk.document_id == document.id).delete()
            for chunk in chunk_sections(sections):
                db.add(
                    Chunk(
                        course_id=document.course_id,
                        document_id=document.id,
                        text=chunk.text,
                        page=chunk.page,
                        slide=chunk.slide,
                        section=chunk.section,
                        source_location=chunk.source_location,
                        text_hash=chunk.text_hash,
                    )
                )

            document.status = DocumentStatus.READY.value
            document.progress = 100
            document.error = None
            task.stage = "completed"
            task.progress = 100
            task.message = "Document ready"
            task.status = "completed"
            db.commit()
        except Exception as exc:  # noqa: BLE001
            document.status = DocumentStatus.FAILED.value
            document.error = str(exc)[:1000]
            task.stage = "failed"
            task.status = "failed"
            task.error = str(exc)[:1000]
            task.message = "Document processing failed"
            db.commit()
