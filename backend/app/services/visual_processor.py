from __future__ import annotations

import base64
import mimetypes
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz

from app.config import Settings


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
PDF_EXTENSIONS = {".pdf"}
OFFICE_EXTENSIONS = {".ppt", ".pptx", ".doc", ".docx", ".odt", ".odp"}
TEXT_EXTENSIONS = {".txt", ".md", ".markdown"}
VISUAL_SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | PDF_EXTENSIONS | OFFICE_EXTENSIONS | TEXT_EXTENSIONS


class VisualProcessingError(RuntimeError):
    pass


@dataclass
class PreparedVisualDocument:
    filename: str
    media_type: str
    pages: int
    processing: str
    content_parts: list[dict[str, Any]]
    preview_path: Path


def find_libreoffice() -> str | None:
    discovered = shutil.which("soffice") or shutil.which("libreoffice")
    if discovered:
        return discovered
    for candidate in (
        Path("C:/Program Files/LibreOffice/program/soffice.exe"),
        Path("C:/Program Files (x86)/LibreOffice/program/soffice.exe"),
    ):
        if candidate.exists():
            return str(candidate)
    return None


def find_microsoft_office() -> bool:
    office_roots = (
        Path("C:/Program Files/Microsoft Office/root/Office16"),
        Path("C:/Program Files (x86)/Microsoft Office/root/Office16"),
    )
    return any((root / "POWERPNT.EXE").exists() for root in office_roots)


def office_conversion_available() -> bool:
    return bool(find_libreoffice() or find_microsoft_office())


def _as_data_url(path: Path, media_type: str) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def _convert_office_to_pdf(source: Path, output_dir: Path) -> Path:
    executable = find_libreoffice()
    if executable:
        result = subprocess.run(
            [executable, "--headless", "--convert-to", "pdf", "--outdir", str(output_dir), str(source)],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        converted = output_dir / f"{source.stem}.pdf"
        if result.returncode != 0 or not converted.exists():
            details = (result.stderr or result.stdout or "LibreOffice conversion failed").strip()
            raise VisualProcessingError(f"无法把 {source.name} 转为 PDF：{details}")
        return converted

    if find_microsoft_office() and source.suffix.lower() in {".ppt", ".pptx", ".odp"}:
        converted = output_dir / f"{source.stem}.pdf"
        try:
            import win32com.client  # type: ignore[import-untyped]

            powerpoint = win32com.client.DispatchEx("PowerPoint.Application")
            presentation = powerpoint.Presentations.Open(str(source.resolve()), WithWindow=False)
            try:
                presentation.SaveAs(str(converted.resolve()), 32)
            finally:
                presentation.Close()
                powerpoint.Quit()
        except Exception as exc:
            raise VisualProcessingError(f"PowerPoint 转换失败：{exc}") from exc
        if converted.exists():
            return converted

    if find_microsoft_office() and source.suffix.lower() in {".doc", ".docx", ".odt"}:
        converted = output_dir / f"{source.stem}.pdf"
        try:
            import win32com.client  # type: ignore[import-untyped]

            word = win32com.client.DispatchEx("Word.Application")
            document = word.Documents.Open(str(source.resolve()), ReadOnly=True)
            try:
                document.SaveAs(str(converted.resolve()), FileFormat=17)
            finally:
                document.Close(False)
                word.Quit()
        except Exception as exc:
            raise VisualProcessingError(f"Word 转换失败：{exc}") from exc
        if converted.exists():
            return converted

    if not executable:
        raise VisualProcessingError(
            "PPTX/DOCX 必须先转为 PDF 才能保留完整页面视觉。请安装 Microsoft Office 或 LibreOffice。"
        )
    raise VisualProcessingError(f"无法把 {source.name} 转为 PDF")


def _render_pdf(pdf_path: Path, source_name: str, settings: Settings) -> list[dict[str, Any]]:
    document = fitz.open(pdf_path)
    try:
        if len(document) > settings.max_pages_per_file:
            raise VisualProcessingError(
                f"{source_name} 有 {len(document)} 页，超过每份文件 {settings.max_pages_per_file} 页的上限。"
            )
        scale = settings.document_render_dpi / 72
        matrix = fitz.Matrix(scale, scale)
        parts: list[dict[str, Any]] = []
        for index, page in enumerate(document):
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            image_bytes = pixmap.tobytes(output="jpeg", jpg_quality=72)
            encoded = base64.b64encode(image_bytes).decode("ascii")
            parts.extend([
                {"type": "text", "text": f"下面是《{source_name}》第 {index + 1} / {len(document)} 页："},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{encoded}", "detail": "high"},
                },
            ])
        return parts
    finally:
        document.close()


def prepare_visual_document(
    source: Path,
    original_name: str,
    work_dir: Path,
    settings: Settings,
) -> PreparedVisualDocument:
    extension = source.suffix.lower()
    if extension not in VISUAL_SUPPORTED_EXTENSIONS:
        raise VisualProcessingError(f"暂不支持 {extension or '未知'} 格式")

    if extension in IMAGE_EXTENSIONS:
        media_type = mimetypes.guess_type(original_name)[0] or "image/jpeg"
        return PreparedVisualDocument(
            filename=original_name,
            media_type=media_type,
            pages=1,
            processing="原图视觉输入（无 OCR）",
            content_parts=[
                {"type": "text", "text": f"下面是课堂材料图片《{original_name}》："},
                {"type": "image_url", "image_url": {"url": _as_data_url(source, media_type), "detail": "high"}},
            ],
            preview_path=source,
        )

    if extension in TEXT_EXTENSIONS:
        content = source.read_text(encoding="utf-8", errors="replace")
        return PreparedVisualDocument(
            filename=original_name,
            media_type=mimetypes.guess_type(original_name)[0] or "text/plain",
            pages=1,
            processing="原始文本输入",
            content_parts=[{"type": "text", "text": f"《{original_name}》全文：\n\n{content}"}],
            preview_path=source,
        )

    pdf_path = source
    processing = "PDF 整页视觉输入（无 OCR）"
    if extension in OFFICE_EXTENSIONS:
        pdf_path = _convert_office_to_pdf(source, work_dir)
        processing = "转 PDF 后整页视觉输入（无 OCR）"

    parts = _render_pdf(pdf_path, original_name, settings)
    return PreparedVisualDocument(
        filename=original_name,
        media_type=mimetypes.guess_type(original_name)[0] or "application/octet-stream",
        pages=sum(1 for part in parts if part["type"] == "image_url"),
        processing=processing,
        content_parts=parts,
        preview_path=pdf_path,
    )
