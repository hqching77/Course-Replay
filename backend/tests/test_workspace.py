from tests.test_auth import auth_header, register


def demo_course(**overrides):
    course = {
        "id": "programming-linux",
        "title": "计算机程序设计基础（1）",
        "code": "30230672-4 · 2026 秋",
        "description": "Linux 与 Shell",
        "tags": ["Linux"],
        "mastery": 42,
        "updated": "刚刚",
        "accent": "#7dd3fc",
        "position": 0,
        "sectionIds": ["linux-basics"],
    }
    course.update(overrides)
    return course


def demo_section(**overrides):
    section = {
        "id": "linux-basics",
        "title": "Linux 命令与 Shell 基础",
        "createdAt": 1730000000000,
        "status": "ready",
        "mastery": 47,
        "materials": [{"id": "m1", "name": "补充材料.pdf", "meta": "26 页", "type": "PDF", "status": "ready", "pages": 26, "uploadId": "u-1"}],
        "analysis": {"title": "Linux", "summary": "概览", "learning_path": ["pwd"], "key_concepts": ["路径"], "review_questions": []},
        "knowledgeMap": [{"id": "kn-1", "tier": "core", "title": "pwd", "summary": "s", "content": "## pwd"}],
        "chatHistory": [
            {"id": "u1", "role": "user", "content": "什么是 Shell？"},
            {"id": "a1", "role": "assistant", "content": "Shell 是命令解释器。", "nodeId": "branch-1"},
        ],
        "explorationNodes": [{"id": "branch-1", "title": "Shell", "parentId": "kn-1", "question": "什么是 Shell？"}],
        "classQuestions": [
            {"id": "q1", "question": "chmod 755 是什么意思？", "answer": "属主 rwx，其他人 r-x。", "topic": "权限", "status": "answered", "askedAt": 1730000100000, "answeredAt": 1730000103000},
        ],
        "liveStartedAt": 1730000000000,
        "liveEndedAt": 1730002700000,
        "liveTopic": "文件权限",
        "autoTitle": True,
        "transcript": [
            {"id": "t1", "text": "今天讲文件权限。", "startedAt": 1730000005000, "endedAt": 1730000012000},
            {"id": "t2", "text": "chmod 改权限。", "startedAt": 1730000013000},
        ],
        "study": {"studied": ["kn-1"], "lastNodeId": "kn-1", "lastAt": 1730003000000, "review": {"2024-10-27": 540}},
    }
    section.update(overrides)
    return {"courseId": "programming-linux", "position": 0, "section": section}


def test_workspace_round_trip(client):
    token = register(client, "alice").json()["token"]
    headers = auth_header(token)
    assert client.get("/api/workspace", headers=headers).json() == {"courses": []}

    assert client.put("/api/workspace/course", json=demo_course(), headers=headers).status_code == 204
    assert client.put("/api/workspace/section", json=demo_section(), headers=headers).status_code == 204

    courses = client.get("/api/workspace", headers=headers).json()["courses"]
    assert len(courses) == 1
    course = courses[0]
    assert course["id"] == "programming-linux"
    assert course["title"] == "计算机程序设计基础（1）"
    section = course["sections"][0]
    assert section["id"] == "linux-basics"
    assert section["createdAt"] == 1730000000000
    assert section["materials"][0]["type"] == "PDF"
    assert section["materials"][0]["uploadId"] == "u-1"
    assert section["knowledgeMap"][0]["content"] == "## pwd"
    assert [m["id"] for m in section["chatHistory"]] == ["u1", "a1"]
    assert section["chatHistory"][1]["nodeId"] == "branch-1"
    assert "nodeId" not in section["chatHistory"][0]  # None fields are omitted
    assert section["explorationNodes"][0]["parentId"] == "kn-1"
    assert section["classQuestions"][0]["answer"] == "属主 rwx，其他人 r-x。"
    assert section["liveTopic"] == "文件权限"
    assert section["autoTitle"] is True
    assert [seg["text"] for seg in section["transcript"]] == ["今天讲文件权限。", "chmod 改权限。"]
    assert section["transcript"][0]["endedAt"] == 1730000012000 and "endedAt" not in section["transcript"][1]
    assert "processingJob" not in section
    assert section["study"] == {"studied": ["kn-1"], "lastNodeId": "kn-1", "lastAt": 1730003000000, "review": {"2024-10-27": 540}}


def test_section_put_replaces_children(client):
    headers = auth_header(register(client, "alice").json()["token"])
    client.put("/api/workspace/course", json=demo_course(), headers=headers)
    client.put("/api/workspace/section", json=demo_section(), headers=headers)
    client.put(
        "/api/workspace/section",
        json=demo_section(chatHistory=[{"id": "u9", "role": "user", "content": "新问题"}], classQuestions=[]),
        headers=headers,
    )
    section = client.get("/api/workspace", headers=headers).json()["courses"][0]["sections"][0]
    assert [m["id"] for m in section["chatHistory"]] == ["u9"]
    assert section["classQuestions"] == []
    assert len(section["materials"]) == 1


def test_users_cannot_see_each_others_data(client):
    alice = auth_header(register(client, "alice").json()["token"])
    bob = auth_header(register(client, "bob").json()["token"])
    # Both users have the demo course under the same browser id.
    for headers, title in ((alice, "Alice 的课"), (bob, "Bob 的课")):
        client.put("/api/workspace/course", json=demo_course(title=title), headers=headers)
        client.put("/api/workspace/section", json=demo_section(title=title), headers=headers)

    assert client.get("/api/workspace", headers=alice).json()["courses"][0]["title"] == "Alice 的课"
    assert client.get("/api/workspace", headers=bob).json()["courses"][0]["title"] == "Bob 的课"

    # Bob deleting "his" course leaves Alice's untouched.
    assert client.delete("/api/workspace/course", params={"id": "programming-linux"}, headers=bob).status_code == 204
    assert client.get("/api/workspace", headers=bob).json() == {"courses": []}
    assert len(client.get("/api/workspace", headers=alice).json()["courses"]) == 1


def test_course_put_orders_and_prunes_sections(client):
    headers = auth_header(register(client, "alice").json()["token"])
    client.put("/api/workspace/course", json=demo_course(sectionIds=["a", "b"]), headers=headers)
    for position, section_id in enumerate(["a", "b"]):
        payload = demo_section(id=section_id, title=section_id)
        payload["position"] = position
        client.put("/api/workspace/section", json=payload, headers=headers)

    client.put("/api/workspace/course", json=demo_course(sectionIds=["b", "a"]), headers=headers)
    sections = client.get("/api/workspace", headers=headers).json()["courses"][0]["sections"]
    assert [s["id"] for s in sections] == ["b", "a"]

    client.put("/api/workspace/course", json=demo_course(sectionIds=["a"]), headers=headers)
    sections = client.get("/api/workspace", headers=headers).json()["courses"][0]["sections"]
    assert [s["id"] for s in sections] == ["a"]


def test_course_order_and_section_for_unknown_course(client):
    headers = auth_header(register(client, "alice").json()["token"])
    client.put("/api/workspace/course", json=demo_course(id="second", position=1, sectionIds=[]), headers=headers)
    client.put("/api/workspace/course", json=demo_course(id="first", position=0, sectionIds=[]), headers=headers)
    ids = [c["id"] for c in client.get("/api/workspace", headers=headers).json()["courses"]]
    assert ids == ["first", "second"]

    missing = demo_section()
    missing["courseId"] = "nope"
    assert client.put("/api/workspace/section", json=missing, headers=headers).status_code == 404


def test_added_columns_are_created_on_old_databases(tmp_path):
    from sqlalchemy import create_engine, inspect, text

    from app.database import ensure_added_columns

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE study_sections (id VARCHAR(36) PRIMARY KEY, title TEXT)"))
        connection.execute(text("CREATE TABLE study_materials (id INTEGER PRIMARY KEY, name TEXT)"))
    ensure_added_columns(engine)
    ensure_added_columns(engine)  # idempotent
    inspector = inspect(engine)
    assert {"auto_title", "study"} <= {c["name"] for c in inspector.get_columns("study_sections")}
    assert "upload_id" in {c["name"] for c in inspector.get_columns("study_materials")}
