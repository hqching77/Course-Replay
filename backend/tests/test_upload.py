def test_upload_and_parse_text_file(client):
    course = client.post("/api/courses", json={"name": "Test Course"}).json()
    response = client.post(
        f"/api/courses/{course['id']}/documents",
        files={"files": ("lesson.md", b"# Logic\nBoolean algebra and truth tables.", "text/markdown")},
    )
    assert response.status_code == 202
    document = response.json()["documents"][0]

    documents = client.get(f"/api/courses/{course['id']}/documents")
    assert documents.status_code == 200
    assert documents.json()[0]["id"] == document["id"]
    assert documents.json()[0]["status"] == "ready"
    assert documents.json()[0]["progress"] == 100

    content = client.get(f"/api/documents/{document['id']}/content")
    assert content.status_code == 200
    assert "Boolean algebra" in content.json()[0]["text"]


def test_rejects_unsupported_file(client):
    course = client.post("/api/courses", json={"name": "Test Course"}).json()
    response = client.post(
        f"/api/courses/{course['id']}/documents",
        files={"files": ("malware.exe", b"nope", "application/octet-stream")},
    )
    assert response.status_code == 415
