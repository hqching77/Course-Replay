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


def test_self_test_answers_are_graded_without_new_nodes(client, monkeypatch):
    import json

    from app.config import get_settings
    from app.services.ai_provider import AIProvider
    from tests.test_auth import auth_header, register

    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", "k")
    monkeypatch.setattr(settings, "openai_chat_model", "m")
    seen = []

    async def fake_chat(self, messages, **kwargs):
        seen.append(messages)
        return json.dumps({"answer": "部分正确，7/10", "add_node": True, "node_title": "新节点"})

    monkeypatch.setattr(AIProvider, "chat", fake_chat)
    headers = auth_header(register(client, "grader").json()["token"])
    body = {"question": "自测题：什么是虚函数？\n\n我的回答：运行时多态", "current_topic": "虚函数",
            "current_content": "## 虚函数\n\n通过基类指针调用派生类实现。", "mode": "grade"}
    reply = client.post("/api/study/ask", json=body, headers=headers).json()
    assert reply["answer"] == "部分正确，7/10" and reply["add_node"] is False
    system, user = seen[0][0]["content"], json.loads(seen[0][1]["content"])
    assert "批改" in system and user["current_content"].startswith("## 虚函数")

    seen.clear()
    reply = client.post("/api/study/ask", json={**body, "mode": "ask"}, headers=headers).json()
    assert reply["add_node"] is True and "批改" not in seen[0][0]["content"]
