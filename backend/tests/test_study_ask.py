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


def test_study_ask_sends_the_note_on_screen(client, monkeypatch):
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
        return json.dumps({"answer": "虚函数通过虚表实现", "add_node": True, "node_title": "虚函数表"})

    monkeypatch.setattr(AIProvider, "chat", fake_chat)
    headers = auth_header(register(client, "reader").json()["token"])
    body = {"question": "虚函数怎么实现的？", "current_topic": "虚函数", "current_content": "## 虚函数\n\n通过基类指针调用派生类实现。"}
    reply = client.post("/api/study/ask", json=body, headers=headers).json()
    assert reply["answer"] == "虚函数通过虚表实现" and reply["add_node"] is True and reply["node_title"] == "虚函数表"
    user = json.loads(seen[0][1]["content"])
    assert user["current_content"].startswith("## 虚函数")
