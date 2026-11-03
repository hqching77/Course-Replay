"""导入课本 / 批量导入: propose a split by chapter, let the user review it, split only on confirm.

1. POST /import/analyze   files are kept in a temporary area; returns the proposed chapters. Nothing is split.
2. GET  /import/{id}/thumb page thumbnails so the user can check each cut.
3. POST /import/{id}/apply the reviewed chapters → split PDFs saved as normal uploads (one 小节 per chapter).
   DELETE /import/{id}    cancel: the temporary files are deleted.
"""

from __future__ import annotations

import json
import re
import shutil
import time
import uuid
from pathlib import Path

import fitz
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import UploadedFile, User
from app.security import get_optional_user
from app.services.book_structure import Chapter, analyze_book, analyze_files, pdf_pages
from app.services.visual_processor import VISUAL_SUPPORTED_EXTENSIONS

router = APIRouter(tags=["import"])

MAX_FILES = 200
KEEP_SECONDS = 24 * 3600
_ID = re.compile(r"^[0-9a-f]{32}$")


class ImportPart(BaseModel):
    file_index: int = Field(ge=0)
    start: int = Field(ge=1)
    end: int = Field(ge=1)


class ImportChapter(BaseModel):
    key: str
    number: int | None = None
    label: str = "chapter"
    title: str = ""
    parts: list[ImportPart]
    pages: int = 0
    files: list[str] = Field(default_factory=list)
    excluded: str | None = None


class ImportFile(BaseModel):
    name: str
    pages: int | None = None
    size: int


class ImportProposal(BaseModel):
    import_id: str
    mode: str  # "book" (one PDF split by page ranges) | "files" (files grouped by chapter)
    method: str  # bookmarks | contents | headings | filenames | manual
    total_pages: int
    files: list[ImportFile]
    chapters: list[ImportChapter]


class ApplyChapter(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    parts: list[ImportPart] = Field(min_length=1, max_length=MAX_FILES)


class ApplyRequest(BaseModel):
    chapters: list[ApplyChapter] = Field(min_length=1, max_length=300)


class AppliedUpload(BaseModel):
    id: str
    filename: str
    size: int
    pages: int | None = None


class AppliedChapter(BaseModel):
    title: str
    uploads: list[AppliedUpload]


class ApplyResponse(BaseModel):
    chapters: list[AppliedChapter]


def _import_user(user: User | None = Depends(get_optional_user)) -> User | None:
    if user is None and get_settings().ai_requires_login:
        raise HTTPException(status_code=401, detail="请先登录后再上传文件", headers={"WWW-Authenticate": "Bearer"})
    return user


def _root() -> Path:
    return get_settings().artifacts_dir / "imports"


def _cleanup_old() -> None:
    root = _root()
    if not root.exists():
        return
    for folder in root.iterdir():
        if folder.is_dir() and time.time() - folder.stat().st_mtime > KEEP_SECONDS:
            shutil.rmtree(folder, ignore_errors=True)


def _load(import_id: str, user: User | None) -> tuple[Path, dict]:
    if not _ID.match(import_id):
        raise HTTPException(status_code=404, detail="导入任务不存在或已过期")
    folder = _root() / import_id
    meta_path = folder / "meta.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="导入任务不存在或已过期")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("owner_id") != (user.id if user else None):
        raise HTTPException(status_code=404, detail="导入任务不存在或已过期")
    return folder, meta


def _chapter_out(index: int, chapter: Chapter) -> ImportChapter:
    return ImportChapter(
        key=f"c{index}",
        number=chapter.number,
        label=chapter.label,
        title=chapter.title,
        parts=[ImportPart(file_index=part.file_index, start=part.start, end=max(part.start, part.end)) for part in chapter.parts],
        pages=sum(max(0, part.end - part.start + 1) for part in chapter.parts),
        files=chapter.files,
        excluded=chapter.excluded,
    )


@router.post("/import/analyze", response_model=ImportProposal)
async def analyze_import(files: list[UploadFile] = File(...), user: User | None = Depends(_import_user)) -> ImportProposal:
    """Propose chapters for one textbook PDF or many files. Read-only: nothing is split or created."""
    settings = get_settings()
    if not files or len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"一次最多导入 {MAX_FILES} 个文件")
    _cleanup_old()
    import_id = uuid.uuid4().hex
    folder = _root() / import_id
    folder.mkdir(parents=True, exist_ok=True)
    stored: list[dict] = []
    max_bytes = settings.max_upload_mb * 1024 * 1024
    try:
        for index, upload in enumerate(files):
            name = Path(upload.filename or f"file-{index}").name
            suffix = Path(name).suffix.lower()
            if suffix not in VISUAL_SUPPORTED_EXTENSIONS:
                raise HTTPException(status_code=415, detail=f"不支持的文件格式：{name}")
            path = folder / f"{index}{suffix}"
            size = 0
            with path.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise HTTPException(status_code=413, detail=f"文件不能超过 {settings.max_upload_mb} MB：{name}")
                    output.write(chunk)
            await upload.close()
            stored.append({"name": name, "path": path.name, "size": size, "pages": pdf_pages(path)})

        paths = [(item["name"], folder / item["path"]) for item in stored]
        if len(stored) == 1 and (stored[0]["pages"] or 0) > 1:
            method, chapters, total = analyze_book(paths[0][1])
            mode = "book"
            if method == "manual" and (stored[0]["pages"] or 0) <= 60:
                mode, method = "files", "filenames"
                chapters = analyze_files(paths)
        else:
            mode, method = "files", "filenames"
            chapters = analyze_files(paths)
            total = sum(item["pages"] or 0 for item in stored)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise

    owner = user.id if user else None
    (folder / "meta.json").write_text(json.dumps({"owner_id": owner, "mode": mode, "files": stored}, ensure_ascii=False), encoding="utf-8")
    return ImportProposal(
        import_id=import_id,
        mode=mode,
        method=method,
        total_pages=total,
        files=[ImportFile(name=item["name"], pages=item["pages"], size=item["size"]) for item in stored],
        chapters=[_chapter_out(index, chapter) for index, chapter in enumerate(chapters)],
    )


@router.get("/import/{import_id}/thumb")
def import_thumbnail(import_id: str, file: int = 0, page: int = 1, user: User | None = Depends(_import_user)) -> Response:
    """A small image of one page, to check where a chapter starts and ends."""
    folder, meta = _load(import_id, user)
    if not 0 <= file < len(meta["files"]):
        raise HTTPException(status_code=404, detail="文件不存在")
    path = folder / meta["files"][file]["path"]
    if path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=404, detail="只有 PDF 有页面预览")
    with fitz.open(path) as doc:
        if not 1 <= page <= len(doc):
            raise HTTPException(status_code=404, detail="页码超出范围")
        target = doc[page - 1]
        zoom = 260 / max(target.rect.width, 1)
        image = target.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False).tobytes("png")
    return Response(content=image, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


def _safe_filename(title: str, suffix: str) -> str:
    clean = re.sub(r'[\\/:*?"<>|\n\r\t]+', " ", title).strip()[:120] or "chapter"
    return f"{clean}{suffix}"


def _save_upload(db: Session, user: User | None, source: Path | None, data: bytes | None, filename: str) -> AppliedUpload:
    upload_id = str(uuid.uuid4())
    folder = get_settings().artifacts_dir / "uploads" / upload_id
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / f"original{Path(filename).suffix.lower()}"
    if data is not None:
        destination.write_bytes(data)
    else:
        shutil.copyfile(source, destination)  # type: ignore[arg-type]
    size = destination.stat().st_size
    db.add(UploadedFile(id=upload_id, user_id=user.id if user else None, filename=filename, stored_path=str(destination), size=size))
    return AppliedUpload(id=upload_id, filename=filename, size=size, pages=pdf_pages(destination))


@router.post("/import/{import_id}/apply", response_model=ApplyResponse)
def apply_import(
    import_id: str,
    request: ApplyRequest,
    user: User | None = Depends(_import_user),
    db: Session = Depends(get_db),
) -> ApplyResponse:
    """Split for real, as reviewed: one PDF per chapter (textbook) or the chapter's files (many files)."""
    folder, meta = _load(import_id, user)
    files = meta["files"]
    for chapter in request.chapters:
        for part in chapter.parts:
            if part.file_index >= len(files) or part.end < part.start:
                raise HTTPException(status_code=400, detail="章节范围无效")
            pages = files[part.file_index]["pages"]
            if pages and part.end > pages:
                raise HTTPException(status_code=400, detail="章节范围超出页数")

    result: list[AppliedChapter] = []
    for chapter in request.chapters:
        uploads: list[AppliedUpload] = []
        if meta["mode"] == "book":
            # One PDF per chapter, copied page ranges (no re-rendering, so it is fast).
            out = fitz.open()
            for part in chapter.parts:
                with fitz.open(folder / files[part.file_index]["path"]) as source:
                    out.insert_pdf(source, from_page=part.start - 1, to_page=part.end - 1)
            uploads.append(_save_upload(db, user, None, out.tobytes(garbage=3, deflate=True), _safe_filename(chapter.title, ".pdf")))
            out.close()
        else:
            for part in chapter.parts:
                item = files[part.file_index]
                source = folder / item["path"]
                whole = not item["pages"] or (part.start == 1 and part.end >= item["pages"])
                if whole:
                    uploads.append(_save_upload(db, user, source, None, item["name"]))
                else:
                    out = fitz.open()
                    with fitz.open(source) as doc:
                        out.insert_pdf(doc, from_page=part.start - 1, to_page=part.end - 1)
                    name = f"{Path(item['name']).stem} p{part.start}-{part.end}.pdf"
                    uploads.append(_save_upload(db, user, None, out.tobytes(garbage=3, deflate=True), name))
                    out.close()
        result.append(AppliedChapter(title=chapter.title, uploads=uploads))
    db.commit()
    shutil.rmtree(folder, ignore_errors=True)
    return ApplyResponse(chapters=result)


@router.delete("/import/{import_id}", status_code=204)
def cancel_import(import_id: str, user: User | None = Depends(_import_user)) -> None:
    folder, _ = _load(import_id, user)
    shutil.rmtree(folder, ignore_errors=True)
