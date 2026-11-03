"""知识档案: the record from all courses reaches every AI prompt that teaches or sets problems."""

import asyncio
import json

import pytest

from app.config import get_settings
from app.services.ai_provider import AIProvider
from app.services.learner import MAX_MEMORY_CHARS, learner_note
from app.services.material_analyzer import SYSTEM_PROMPT, analyze_materials
from app.services.visual_processor import prepare_visual_document
from tests.test_auth import auth_header, register
from tests.test_batching import FakeProvider, make_pdf

MEMORY = "和眼前内容可能相关、在其他课程学过的：\n- 矩阵乘法（《线性代数》· 已掌握）"


@pytest.fixture
def ai(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", "k")
    monkeypatch.setattr(settings, "openai_chat_model", "m")
    calls = []

    async def fake_chat(self, messages, **kwargs):
        calls.append(messages)
        system = messages[0]["content"]
        if "【练习题】" in system:
            return "@@PROBLEM\n求 $AB$\n@@ANSWER\n$C$\n@@END"
        if "课程导师" in system:
            return json.dumps({"answer": "就是矩阵乘法", "add_node": False})
        return "就是矩阵乘法"

    monkeypatch.setattr(AIProvider, "chat", fake_chat)
    return calls


def test_note_is_empty_without_a_record():
    assert learner_note("") == "" and learner_note("   ") == "" and learner_note(None) == ""
    note = learner_note("x" * (MAX_MEMORY_CHARS + 500), "notes")
    assert "【学生的知识档案】" in note and "x" * (MAX_MEMORY_CHARS + 1) not in note
    assert "\r" not in learner_note("第一行\r\n第二行")


def test_tutor_and_class_assistant_get_the_record(client, ai):
    headers = auth_header(register(client, "memory-user").json()["token"])
    client.post("/api/study/ask", json={"question": "二维数组怎么相乘？", "current_topic": "二维数组"}, headers=headers)
    client.post("/api/study/ask", json={"question": "二维数组怎么相乘？", "learner_memory": MEMORY}, headers=headers)
    client.post("/api/class/ask", json={"question": "这是什么？", "learner_memory": MEMORY}, headers=headers)
    without, tutor, live = (call[0]["content"] for call in ai)
    assert "知识档案" not in without
    assert "矩阵乘法（《线性代数》· 已掌握）" in tutor and "联系起来" in tutor
    assert "矩阵乘法（《线性代数》· 已掌握）" in live


def test_practice_problems_get_the_record(client, ai):
    headers = auth_header(register(client, "memory-practice").json()["token"])
    response = client.post("/api/practice/problems", json={"topic": "矩阵", "content": "", "count": 1, "learner_memory": MEMORY}, headers=headers)
    assert response.status_code == 200
    assert "矩阵乘法（《线性代数》· 已掌握）" in ai[-1][0]["content"] and "薄弱点" in ai[-1][0]["content"]


def test_record_is_capped(client, ai):
    headers = auth_header(register(client, "memory-cap").json()["token"])
    response = client.post("/api/study/ask", json={"question": "q", "learner_memory": "x" * (MAX_MEMORY_CHARS + 1)}, headers=headers)
    assert response.status_code == 422


def test_notes_are_written_with_the_record(tmp_path):
    source = tmp_path / "lecture.pdf"
    make_pdf(source, 3)
    document = prepare_visual_document(source, "第6讲 二维数组.pdf", tmp_path, get_settings())
    provider = FakeProvider()
    asyncio.run(analyze_materials([document], provider, learner_memory=MEMORY))
    final = next(call for call in provider.calls if call["prompt"] == SYSTEM_PROMPT)
    intro = final["content"][0]["text"]
    assert "矩阵乘法（《线性代数》· 已掌握）" in intro and "点明联系" in intro
