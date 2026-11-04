"""Pick a file from a cloud-drive share link and use it like an upload.

Works with Seafile share links (e.g. https://cloud.tsinghua.edu.cn/d/<token>/ for a folder,
/f/<token>/ for one file). Only hosts in CLOUD_DRIVE_HOSTS are contacted, over https, and
redirects must stay on those hosts, so a link can't make the server fetch anything else.
"""

from __future__ import annotations

import re
import shutil
import uuid
from email.message import Message
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.analysis import _upload_user
from app.config import get_settings
from app.database import get_db
from app.models import UploadedFile, User
from app.schemas import FileUploadRead
from app.services.book_structure import page_count
from app.services.visual_processor import VISUAL_SUPPORTED_EXTENSIONS

router = APIRouter(tags=["cloud"])

LINK_ERROR = "链接打不开：可能需要密码、已经过期，或者文件已被删除"


def _http() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=False, headers={"User-Agent": "CourseReplay"})


class CloudRequest(BaseModel):
    link: str = Field(min_length=8, max_length=500)
    path: str = Field(default="", max_length=1000)


class CloudEntry(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int | None = None
    modified: str | None = None


class CloudListing(BaseModel):
    kind: Literal["dir", "file"]
    path: str
    entries: list[CloudEntry]


def _hosts() -> set[str]:
    return {host.strip().lower() for host in get_settings().cloud_drive_hosts.split(",") if host.strip()}


def _parse(link: str) -> tuple[str, str, str, str]:
    """→ (host, 'd' | 'f', token, starting folder)."""
    parsed = urlparse(link.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in _hosts():
        raise HTTPException(status_code=400, detail=f"只支持这些网盘的共享链接：{'、'.join(sorted(_hosts())) or '（未开启）'}")
    match = re.fullmatch(r"/(d|f)/([0-9A-Za-z]{6,64})/?(?:files/)?", parsed.path)
    if not match:
        raise HTTPException(status_code=400, detail="这不是网盘的共享链接（应该像 https://…/d/xxxx/ 或 /f/xxxx/）")
    start = unquote(parse_qs(parsed.query).get("p", ["/"])[0]) or "/"
    return host, match.group(1), match.group(2), start


def _clean_path(path: str) -> str:
    """A path inside the share: "/a/../b/" → "/b" (never above the share's root)."""
    parts: list[str] = []
    for part in path.replace("\\", "/").split("/"):
        if part == "..":
            if parts:
                parts.pop()
        elif part and part != ".":
            parts.append(part)
    return "/" + "/".join(parts)


async def _get(client: httpx.AsyncClient, url: str, *, stream: bool = False) -> httpx.Response:
    """GET following at most 3 redirects, each on an allowed https host."""
    for _ in range(4):
        request = client.build_request("GET", url)
        response = await client.send(request, stream=stream)
        if response.status_code in {301, 302, 303, 307, 308} and response.headers.get("location"):
            next_url = urljoin(url, response.headers["location"])
            target = urlparse(next_url)
            await response.aclose()
            if target.scheme != "https" or (target.hostname or "").lower() not in _hosts():
                raise HTTPException(status_code=502, detail=LINK_ERROR)
            url = next_url
            continue
        return response
    raise HTTPException(status_code=502, detail=LINK_ERROR)


def _filename(response: httpx.Response, fallback: str) -> str:
    header = response.headers.get("content-disposition", "")
    if header:
        message = Message()
        message["content-disposition"] = header
        name = message.get_filename()
        if name:
            return Path(unquote(name)).name
    return Path(unquote(fallback)).name or "file"


@router.post("/cloud/list", response_model=CloudListing)
async def list_cloud(payload: CloudRequest, _user: User | None = Depends(_upload_user)) -> CloudListing:
    host, kind, token, start = _parse(payload.link)
    async with _http() as client:
        if kind == "f":
            response = await _get(client, f"https://{host}/f/{token}/?dl=1", stream=True)
            try:
                if response.status_code != 200 or response.headers.get("content-type", "").startswith("text/html"):
                    raise HTTPException(status_code=400, detail=LINK_ERROR)
                name = _filename(response, token)
                size = int(response.headers.get("content-length") or 0) or None
            finally:
                await response.aclose()
            return CloudListing(kind="file", path="/", entries=[CloudEntry(name=name, path="/", is_dir=False, size=size)])
        path = _clean_path(payload.path or start)
        response = await _get(client, f"https://{host}/api/v2.1/share-links/{token}/dirents/?path={quote(path)}")
    try:
        dirents = response.json().get("dirent_list") if response.status_code == 200 else None
    except ValueError:
        dirents = None
    if not isinstance(dirents, list):
        raise HTTPException(status_code=400, detail=LINK_ERROR)
    entries = []
    for item in dirents:
        is_dir = bool(item.get("is_dir"))
        entry_path = item.get("folder_path" if is_dir else "file_path") or item.get("file_path") or ""
        name = item.get("folder_name" if is_dir else "file_name") or item.get("file_name") or Path(entry_path.rstrip("/")).name
        if not name or not entry_path:
            continue
        entries.append(CloudEntry(name=name, path=_clean_path(entry_path), is_dir=is_dir, size=None if is_dir else item.get("size"), modified=item.get("last_modified")))
    entries.sort(key=lambda entry: (not entry.is_dir, entry.name.lower()))
    return CloudListing(kind="dir", path=path, entries=entries)


@router.post("/cloud/import", response_model=FileUploadRead, status_code=201)
async def import_cloud(payload: CloudRequest, user: User | None = Depends(_upload_user), db: Session = Depends(get_db)) -> FileUploadRead:
    """Download one file from the share link into the user's uploads (same as uploading it)."""
    settings = get_settings()
    host, kind, token, _ = _parse(payload.link)
    path = _clean_path(payload.path)
    url = f"https://{host}/f/{token}/?dl=1" if kind == "f" else f"https://{host}/d/{token}/files/?p={quote(path)}&dl=1"
    if kind == "d" and path == "/":
        raise HTTPException(status_code=400, detail="请选择一个文件")
    upload_id = str(uuid.uuid4())
    folder = settings.artifacts_dir / "uploads" / upload_id
    max_bytes = settings.max_upload_mb * 1024 * 1024
    async with _http() as client:
        response = await _get(client, url, stream=True)
        try:
            if response.status_code != 200 or response.headers.get("content-type", "").startswith("text/html"):
                raise HTTPException(status_code=400, detail=LINK_ERROR)
            name = _filename(response, path if kind == "d" else token)
            suffix = Path(name).suffix.lower()
            if suffix not in VISUAL_SUPPORTED_EXTENSIONS:
                raise HTTPException(status_code=415, detail=f"不支持的文件格式：{name}")
            folder.mkdir(parents=True, exist_ok=True)
            destination = folder / f"original{suffix}"
            size = 0
            with destination.open("wb") as output:
                async for chunk in response.aiter_bytes(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise HTTPException(status_code=413, detail=f"文件不能超过 {settings.max_upload_mb} MB：{name}")
                    output.write(chunk)
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        finally:
            await response.aclose()
    db.add(UploadedFile(id=upload_id, user_id=user.id if user else None, filename=name, stored_path=str(destination), size=size))
    db.commit()
    return FileUploadRead(id=upload_id, filename=name, size=size, pages=page_count(destination))
