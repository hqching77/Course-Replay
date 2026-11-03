import pytest

from app.api.practice import parse_blocks, parse_grade, parse_quiz
from app.config import get_settings
from app.services.ai_provider import AIProvider
from tests.test_auth import auth_header, register

QUIZ = r"""好的，下面是题目：
@@Q key=s1:k1
设 $A=\begin{pmatrix}1&2\\3&4\end{pmatrix}$，$\det A$ 等于？
@@A $-2$
@@B $2$
@@C $10$
@@D $\frac{1}{2}$
@@ANSWER A
@@WHY $1\cdot4-2\cdot3=-2$
@@Q key=s1:k2
缺选项的题
@@A only one
@@ANSWER A
@@Q key=other
不在列表里的 key
@@A a
@@B b
@@C c
@@D d
@@ANSWER B
@@END"""


def test_quiz_parser_keeps_latex_and_drops_broken_questions():
    questions = parse_quiz(QUIZ, {"s1:k1", "s1:k2"})
    assert len(questions) == 1
    question = questions[0]
    assert r"\begin{pmatrix}" in question.question and question.options[3] == r"$\frac{1}{2}$"
    assert question.answer == 0 and r"\cdot" in question.explanation


def test_grade_parser():
    raw = "@@VERDICT partial\n@@KIND calc\n@@FEEDBACK\n第二步把 $\\beta$ 算错了\n@@ANSWER\n$x=3$\n@@SOLUTION\n步骤…\n@@END"
    graded = parse_grade(raw)
    assert graded.verdict == "partial" and graded.kind == "calc" and "\\beta" in graded.feedback and graded.answer == "$x=3$"
    assert parse_grade("@@VERDICT correct\n@@KIND none\n@@FEEDBACK\n对\n@@END").kind is None
    assert parse_blocks("@@QUESTION topic=k1\nline\n@@END") == [("QUESTION", {"topic": "k1"}, "line")]


@pytest.fixture
def ai(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", "k")
    monkeypatch.setattr(settings, "openai_chat_model", "m")
    replies: list[str] = []
    seen: list[list[dict]] = []

    async def fake_chat(self, messages, **kwargs):
        seen.append(messages)
        return replies.pop(0)

    monkeypatch.setattr(AIProvider, "chat", fake_chat)
    return replies, seen


def test_practice_endpoints(client, ai):
    replies, seen = ai
    headers = auth_header(register(client, "hq").json()["token"])
    topics = [{"key": "s1:k1", "title": "行列式", "content": "## 行列式\n$\\det A = ad-bc$"}, {"key": "s1:k2", "title": "逆矩阵", "content": "..."}]

    replies.append(QUIZ)
    quiz = client.post("/api/practice/quiz", json={"course_title": "线性代数", "topics": topics}, headers=headers).json()
    assert [q["key"] for q in quiz["questions"]] == ["s1:k1"] and "出题·诊断" in seen[-1][0]["content"]

    replies.append("@@VERDICT wrong\n@@KIND concept\n@@FEEDBACK\n把行列式当成了迹\n@@ANSWER\n$-2$\n@@SOLUTION\n$1\\cdot4-2\\cdot3$\n@@END")
    graded = client.post("/api/practice/grade", json={"question": "det A?", "answer": "5", "topic": "行列式", "reference": "ad-bc"}, headers=headers).json()
    assert graded == {"verdict": "wrong", "kind": "concept", "feedback": "把行列式当成了迹", "answer": "$-2$", "solution": "$1\\cdot4-2\\cdot3$"}

    replies.append("@@PROBLEM\n算 $\\det$\n@@ANSWER\n1\n@@HINT\n对角线\n@@PROBLEM\n第二题\n@@ANSWER\n2\n@@END")
    problems = client.post("/api/practice/problems", json={"topic": "行列式", "content": "...", "count": 2, "past_questions": ["2025 期中第 3 题"], "mistakes": ["把行列式当成了迹"]}, headers=headers).json()
    assert [p["answer"] for p in problems["problems"]] == ["1", "2"]
    assert "往年考题" in seen[-1][1]["content"] and "把行列式当成了迹" in seen[-1][1]["content"]

    replies.append("随便说说，没有格式")
    assert client.post("/api/practice/grade", json={"question": "q", "answer": "a"}, headers=headers).status_code == 502


def test_practice_needs_ai_and_login(client, monkeypatch):
    body = {"question": "q", "answer": "a"}
    assert client.post("/api/practice/grade", json=body).status_code == 503  # no AI configured
    monkeypatch.setattr(get_settings(), "openai_api_key", "k")
    monkeypatch.setattr(get_settings(), "openai_chat_model", "m")
    assert client.post("/api/practice/grade", json=body).status_code == 401


def test_past_paper_maps_questions_to_topics(client, ai, monkeypatch):
    import fitz

    headers = auth_header(register(client, "hq").json()["token"])
    doc = fitz.open()
    doc.new_page().insert_text((72, 90), "1. Compute det A", fontsize=12)
    upload = client.post("/api/uploads", files={"file": ("2025期中.pdf", doc.tobytes(), "application/pdf")}, headers=headers).json()

    async def fake_visual(self, content, *, system_prompt, max_tokens=8000):
        assert "【试卷】" in system_prompt and any(part.get("type") == "image_url" for part in content)
        return "@@QUESTION topic=s1:k1\n1. 计算 $\\det A$\n@@QUESTION topic=nope\n2. 别的题\n@@END", None

    monkeypatch.setattr(AIProvider, "analyze_visual_materials", fake_visual)
    topics = [{"key": "s1:k1", "title": "行列式"}]
    result = client.post("/api/practice/past-paper", json={"upload_ids": [upload["id"]], "topics": topics}, headers=headers).json()
    assert result["questions"] == [{"text": "1. 计算 $\\det A$", "topic_key": "s1:k1"}, {"text": "2. 别的题", "topic_key": None}]
    other = auth_header(register(client, "bob").json()["token"])
    assert client.post("/api/practice/past-paper", json={"upload_ids": [upload["id"]], "topics": topics}, headers=other).status_code == 404
