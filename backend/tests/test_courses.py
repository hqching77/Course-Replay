def test_course_crud(client):
    created = client.post(
        "/api/courses",
        json={"name": "数字电路", "description": "演示课程", "tags": ["EE"]},
    )
    assert created.status_code == 201
    course = created.json()
    assert course["name"] == "数字电路"
    assert course["document_count"] == 0

    listed = client.get("/api/courses")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    fetched = client.get(f"/api/courses/{course['id']}")
    assert fetched.status_code == 200

    deleted = client.delete(f"/api/courses/{course['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/courses/{course['id']}").status_code == 404
