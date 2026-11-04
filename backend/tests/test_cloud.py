"""Picking homework from a cloud-drive share link (Seafile API, faked with httpx.MockTransport)."""


import fitz
import httpx
import pytest

from app.api import cloud
from tests.test_auth import auth_header, register

HOST = "cloud.tsinghua.edu.cn"
LINK = f"https://{HOST}/d/6682bc3001474eda8a3f/"


def pdf_bytes() -> bytes:
    doc = fitz.open()
    for _ in range(2):
        doc.new_page().insert_text((72, 90), "Homework 3", fontsize=12)
    return doc.tobytes()


@pytest.fixture
def drive(monkeypatch):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        url = request.url
        if url.host != HOST:
            return httpx.Response(200, text="should never be called")
        if url.path == "/api/v2.1/share-links/6682bc3001474eda8a3f/dirents/":
            folder = url.params.get("path")
            if folder == "/":
                return httpx.Response(200, json={"dirent_list": [
                    {"is_dir": False, "file_path": "/第3章作业.pdf", "file_name": "第3章作业.pdf", "size": 2048, "last_modified": "2026-11-01T10:00:00+08:00"},
                    {"is_dir": True, "folder_path": "/答案/", "folder_name": "答案", "last_modified": "2026-11-02T10:00:00+08:00"},
                    {"is_dir": False, "file_path": "/notes.txt", "file_name": "notes.txt", "size": 10},
                ]})
            if folder == "/答案":
                return httpx.Response(200, json={"dirent_list": [{"is_dir": False, "file_path": "/答案/1.png", "file_name": "1.png", "size": 5}]})
            return httpx.Response(404, json={"error_msg": "Folder not found."})
        if url.path == "/api/v2.1/share-links/locked000000/dirents/":
            return httpx.Response(403, json={"error_msg": "Permission denied."})
        if url.path == "/d/6682bc3001474eda8a3f/files/":
            if url.params.get("p") == "/第3章作业.pdf":
                return httpx.Response(302, headers={"location": f"https://{HOST}/seafhttp/files/abc/%E7%AC%AC3%E7%AB%A0%E4%BD%9C%E4%B8%9A.pdf"})
            if url.params.get("p") == "/evil.pdf":
                return httpx.Response(302, headers={"location": "https://169.254.169.254/latest/meta-data"})
            return httpx.Response(200, text="<!doctype html><html>login</html>", headers={"content-type": "text/html"})
        if url.path.startswith("/seafhttp/files/abc/"):
            return httpx.Response(200, content=pdf_bytes(), headers={"content-type": "application/pdf"})
        if url.path == "/f/onefile00000/":
            return httpx.Response(200, content=pdf_bytes(), headers={"content-type": "application/pdf", "content-disposition": "attachment; filename*=UTF-8''%E6%9C%9F%E4%B8%AD.pdf"})
        return httpx.Response(404)

    monkeypatch.setattr(cloud, "_http", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False))
    return requests


def test_folder_link_lists_files_and_subfolders(client, drive):
    headers = auth_header(register(client, "cloud-list").json()["token"])
    listing = client.post("/api/cloud/list", json={"link": LINK}, headers=headers).json()
    assert listing["kind"] == "dir" and listing["path"] == "/"
    assert [(e["name"], e["is_dir"], e["path"]) for e in listing["entries"]] == [("答案", True, "/答案"), ("notes.txt", False, "/notes.txt"), ("第3章作业.pdf", False, "/第3章作业.pdf")]
    inner = client.post("/api/cloud/list", json={"link": LINK, "path": "/答案/../答案"}, headers=headers).json()
    assert [e["name"] for e in inner["entries"]] == ["1.png"] and inner["path"] == "/答案"
    # a link that already points into a subfolder (?p=) opens there
    assert client.post("/api/cloud/list", json={"link": LINK + "?p=%2F%E7%AD%94%E6%A1%88"}, headers=headers).json()["path"] == "/答案"


def test_importing_a_file_makes_an_upload(client, drive):
    headers = auth_header(register(client, "cloud-import").json()["token"])
    stored = client.post("/api/cloud/import", json={"link": LINK, "path": "/第3章作业.pdf"}, headers=headers)
    assert stored.status_code == 201, stored.text
    data = stored.json()
    assert data["filename"] == "第3章作业.pdf" and data["pages"] == 2 and data["size"] > 100
    page = client.get(f"/api/uploads/{data['id']}/page", params={"width": 200}, headers=headers)
    assert page.status_code == 200
    single = client.post("/api/cloud/import", json={"link": f"https://{HOST}/f/onefile00000/"}, headers=headers).json()
    assert single["filename"] == "期中.pdf"
    assert client.post("/api/cloud/list", json={"link": f"https://{HOST}/f/onefile00000/"}, headers=headers).json()["entries"][0]["name"] == "期中.pdf"


def test_links_are_checked(client, drive):
    headers = auth_header(register(client, "cloud-safe").json()["token"])
    for link in ["https://evil.example.com/d/6682bc3001474eda8a3f/", f"http://{HOST}/d/6682bc3001474eda8a3f/", f"https://{HOST}/library/abc/"]:
        assert client.post("/api/cloud/list", json={"link": link}, headers=headers).status_code == 400
    assert client.post("/api/cloud/list", json={"link": f"https://{HOST}/d/locked000000/"}, headers=headers).json()["detail"] == cloud.LINK_ERROR
    # a redirect off the allowed host is refused, a login page isn't saved as the file
    assert client.post("/api/cloud/import", json={"link": LINK, "path": "/evil.pdf"}, headers=headers).status_code == 502
    assert client.post("/api/cloud/import", json={"link": LINK, "path": "/private.pdf"}, headers=headers).json()["detail"] == cloud.LINK_ERROR
    assert client.post("/api/cloud/import", json={"link": LINK, "path": "/notes.exe"}, headers=headers).status_code in {400, 415}
    assert not any("169.254" in url or "evil.example" in url for url in drive)
    assert client.post("/api/cloud/list", json={"link": LINK}).status_code == 401
