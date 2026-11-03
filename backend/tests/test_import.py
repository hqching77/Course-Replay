
import fitz

from app.config import get_settings
from tests.test_auth import auth_header, register


def textbook(chapters=(9, 12, 10, 8), bookmarks=True) -> bytes:
    doc = fitz.open()
    toc = []

    def page(big=(), body=1):
        p = doc.new_page()
        y = 90
        for line in big:
            p.insert_text((72, y), line, fontsize=24)
            y += 36
        for _ in range(body):
            p.insert_text((72, y), "body text " * 6, fontsize=10)
            y += 14
        return p

    page(["LINEAR ALGEBRA"], 0)
    toc.append([1, "Preface", 2])
    page(["Preface"])
    toc.append([1, "Contents", 3])
    page(["Contents"])
    for number, length in enumerate(chapters, 1):
        toc.append([1, f"Chapter {number} Topic {number}", doc.page_count + 1])
        page([f"Chapter {number}", f"Topic {number}"], 20)
        for _ in range(length - 1):
            page((), 30)
    toc.append([1, "Index", doc.page_count + 1])
    page(["Index"])
    if bookmarks:
        doc.set_toc(toc)
    return doc.tobytes()


def small_pdf(text="section") -> bytes:
    doc = fitz.open()
    doc.new_page().insert_text((72, 90), text, fontsize=12)
    return doc.tobytes()


def test_textbook_is_proposed_by_chapter_and_split_only_on_apply(client, monkeypatch):
    headers = auth_header(register(client, "hq").json()["token"])
    uploads_dir = get_settings().artifacts_dir / "uploads"
    before = set(uploads_dir.iterdir()) if uploads_dir.exists() else set()
    response = client.post("/api/import/analyze", files=[("files", ("线性代数.pdf", textbook(), "application/pdf"))], headers=headers)
    assert response.status_code == 200
    proposal = response.json()
    assert proposal["mode"] == "book" and proposal["method"] == "bookmarks" and proposal["total_pages"] == 43
    included = [c for c in proposal["chapters"] if not c["excluded"]]
    excluded = {c["excluded"] for c in proposal["chapters"] if c["excluded"]}
    assert [(c["number"], c["title"], c["parts"][0]["start"], c["parts"][0]["end"]) for c in included] == [
        (1, "Topic 1", 4, 12), (2, "Topic 2", 13, 24), (3, "Topic 3", 25, 34), (4, "Topic 4", 35, 42),
    ]
    assert excluded == {"front", "preface", "contents", "index"}

    # Review: nothing has been split or saved as an upload yet.
    assert (set(uploads_dir.iterdir()) if uploads_dir.exists() else set()) == before
    thumb = client.get(f"/api/import/{proposal['import_id']}/thumb?file=0&page=4", headers=headers)
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/png"
    other = auth_header(register(client, "bob").json()["token"])
    assert client.get(f"/api/import/{proposal['import_id']}/thumb?file=0&page=4", headers=other).status_code == 404

    # Apply "只导入到第 2 章", with chapter 2 nudged one page later.
    chapters = [
        {"title": "第 1 章 · Topic 1", "parts": [{"file_index": 0, "start": 4, "end": 13}]},
        {"title": "第 2 章 · Topic 2", "parts": [{"file_index": 0, "start": 14, "end": 24}]},
    ]
    applied = client.post(f"/api/import/{proposal['import_id']}/apply", json={"chapters": chapters}, headers=headers).json()
    assert [(c["title"], c["uploads"][0]["pages"]) for c in applied["chapters"]] == [("第 1 章 · Topic 1", 10), ("第 2 章 · Topic 2", 11)]
    assert applied["chapters"][0]["uploads"][0]["filename"] == "第 1 章 · Topic 1.pdf"
    assert not (get_settings().artifacts_dir / "imports" / proposal["import_id"]).exists()  # temporary files gone
    assert client.post(f"/api/import/{proposal['import_id']}/apply", json={"chapters": chapters}, headers=headers).status_code == 404

    # The split chapters are normal uploads, private to their owner.
    monkeypatch.setattr(get_settings(), "openai_api_key", "k")
    monkeypatch.setattr(get_settings(), "openai_chat_model", "m")
    upload_id = applied["chapters"][0]["uploads"][0]["id"]
    start = client.post("/api/process/start", data={"upload_ids": f'["{upload_id}"]'}, headers=other)
    assert start.status_code == 404  # not bob's


def test_many_files_are_grouped_by_chapter(client):
    headers = auth_header(register(client, "hq").json()["token"])
    names = ["LA_1.2.pdf", "LA_1.1.pdf", "LA_2.10.pdf", "LA_2.2.pdf", "notes.pdf", "1-3 dot product.pdf"]
    files = [("files", (name, small_pdf(), "application/pdf")) for name in names]
    proposal = client.post("/api/import/analyze", files=files, headers=headers).json()
    assert proposal["mode"] == "files" and proposal["method"] == "filenames"
    assert [(c["number"], c["files"]) for c in proposal["chapters"]] == [
        (1, ["LA_1.1.pdf", "LA_1.2.pdf", "1-3 dot product.pdf"]),
        (2, ["LA_2.2.pdf", "LA_2.10.pdf"]),
        (None, ["notes.pdf"]),
    ]
    chapter_one = proposal["chapters"][0]
    applied = client.post(f"/api/import/{proposal['import_id']}/apply", json={"chapters": [{"title": "第 1 章", "parts": chapter_one["parts"]}]}, headers=headers).json()
    assert [upload["filename"] for upload in applied["chapters"][0]["uploads"]] == ["LA_1.1.pdf", "LA_1.2.pdf", "1-3 dot product.pdf"]


def test_cancel_deletes_everything_and_bad_input_is_rejected(client):
    headers = auth_header(register(client, "hq").json()["token"])
    assert client.post("/api/import/analyze", files=[("files", ("a.pdf", small_pdf(), "application/pdf"))]).status_code == 401
    assert client.post("/api/import/analyze", files=[("files", ("virus.exe", b"MZ", "application/octet-stream"))], headers=headers).status_code == 415
    proposal = client.post("/api/import/analyze", files=[("files", ("book.pdf", textbook(), "application/pdf"))], headers=headers).json()
    bad = {"chapters": [{"title": "x", "parts": [{"file_index": 0, "start": 40, "end": 99}]}]}
    assert client.post(f"/api/import/{proposal['import_id']}/apply", json=bad, headers=headers).status_code == 400
    assert client.delete(f"/api/import/{proposal['import_id']}", headers=headers).status_code == 204
    assert not (get_settings().artifacts_dir / "imports" / proposal["import_id"]).exists()
    assert client.get("/api/import/not-an-id/thumb", headers=headers).status_code == 404


def test_book_without_bookmarks_uses_the_headings(client):
    headers = auth_header(register(client, "hq").json()["token"])
    proposal = client.post("/api/import/analyze", files=[("files", ("book.pdf", textbook(bookmarks=False), "application/pdf"))], headers=headers).json()
    assert proposal["method"] == "headings"
    assert [c["parts"][0]["start"] for c in proposal["chapters"] if not c["excluded"]] == [4, 13, 25, 35]
