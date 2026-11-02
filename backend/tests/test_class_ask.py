import pytest

from app.config import get_settings
from app.services.ai_provider import AIProvider
from tests.test_auth import auth_header, register

QUESTION = {
    "question": "为什么 chmod 755 里是 7？",
    "course_title": "计算机程序设计基础",
    "section_title": "Linux 基础",
    "current_topic": "文件权限",
    "recent": [{"question": "rwx 是什么？", "answer": "读、写、执行。"}],
}


@pytest.fixture
def ai_configured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(settings, "openai_chat_model", "test-model")
    calls = []

    async def fake_chat(self, messages, **kwargs):
        calls.append(messages)
        return "**7 = 4 + 2 + 1**，即 rwx 三个权限都有。"

    monkeypatch.setattr(AIProvider, "chat", fake_chat)
    return calls


def test_class_ask_requires_ai_configuration(client):
    response = client.post("/api/class/ask", json=QUESTION)
    assert response.status_code == 503


def test_class_ask_requires_login_when_ai_configured(client, ai_configured):
    assert client.post("/api/class/ask", json=QUESTION).status_code == 401
    assert client.post("/api/study/ask", json={"question": "hi"}).status_code == 401
    assert ai_configured == []


def test_class_ask_answers_directly_with_context(client, ai_configured):
    headers = auth_header(register(client, "alice").json()["token"])
    response = client.post("/api/class/ask", json=QUESTION, headers=headers)
    assert response.status_code == 200
    assert response.json()["answer"].startswith("**7 = 4 + 2 + 1**")

    messages = ai_configured[0]
    assert messages[0]["role"] == "system"
    assert "老师正在讲：文件权限" in messages[0]["content"]
    # Earlier in-class turns are replayed so follow-ups ("为什么？") resolve.
    assert [m["role"] for m in messages[1:]] == ["user", "assistant", "user"]
    assert messages[-1]["content"] == QUESTION["question"]


def test_class_ask_allowed_anonymously_when_login_not_required(client, ai_configured, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_requires_login", False)
    assert client.post("/api/class/ask", json=QUESTION).status_code == 200


def test_parse_class_questions_for_build():
    from app.api.analysis import _parse_class_questions

    assert _parse_class_questions('["  什么是 rwx？ ", "", 3]') == ["什么是 rwx？", "3"]
    assert _parse_class_questions("not json") == []
    assert _parse_class_questions('{"a": 1}') == []
    assert _parse_class_questions(None) == []
