def test_study_ask_requires_ai_configuration(client):
    response = client.post(
        "/api/study/ask",
        json={
            "question": "这个概念需要哪些前置知识？",
            "course_title": "测试课程",
            "current_topic": "当前节点",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "AI 服务尚未配置"
