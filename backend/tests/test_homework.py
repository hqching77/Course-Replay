"""题目答疑: per-problem storage across devices, photo pages, and the marking / guiding / conclusion AI."""

import fitz
import pytest

from app.config import get_settings
from app.services.ai_provider import AIProvider
from tests.test_auth import auth_header, register

TOPICS = [{"key": "s1:n1", "title": "第 3 讲 · 矩阵乘法"}, {"key": "s1:n2", "title": "第 3 讲 · 逆矩阵"}]
BASE = {"course_title": "线性代数", "question": "求 $A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$ 的逆矩阵。", "topics": TOPICS, "reference": "## 逆矩阵\n$A^{-1}=\\frac{1}{\\det A}\\operatorname{adj}A$"}


@pytest.fixture
def ai(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", "k")
    monkeypatch.setattr(settings, "openai_chat_model", "m")
    calls = []
    replies = {}

    async def fake_chat(self, messages, **kwargs):
        calls.append(messages)
        system = messages[0]["content"]
        for marker, reply in replies.items():
            if marker in system:
                return reply
        return ""

    async def fake_vision(self, content, *, system_prompt, max_tokens=8000):
        calls.append([{"role": "system", "content": system_prompt}, {"role": "user", "content": content}])
        return ("求 $A$ 的逆矩阵" if "【抄题】" in system_prompt else "$\\det A = 4-6 = -2$\n$A^{-1} = ...$"), None

    monkeypatch.setattr(AIProvider, "chat", fake_chat)
    monkeypatch.setattr(AIProvider, "analyze_visual_materials", fake_vision)
    return calls, replies


def test_problems_are_saved_one_by_one_and_protected_between_devices(client):
    hq = auth_header(register(client, "hw-owner").json()["token"])
    other = auth_header(register(client, "hw-other").json()["token"])
    assert client.get("/api/homework").status_code == 401

    data = {"title": "逆矩阵", "question": {"text": "求逆", "images": []}, "steps": []}
    saved = client.put("/api/homework/hw-1", json={"course_id": "la", "data": data, "version": 0}, headers=hq).json()
    assert saved["version"] == 1 and saved["data"]["title"] == "逆矩阵"

    # The phone adds the answer on top of version 1 …
    with_answer = {**data, "answer": {"text": "det = -2", "images": []}}
    assert client.put("/api/homework/hw-1", json={"course_id": "la", "data": with_answer, "version": 1}, headers=hq).json()["version"] == 2
    # … so the PC, still on version 1, can't silently overwrite it.
    stale = client.put("/api/homework/hw-1", json={"course_id": "la", "data": data, "version": 1}, headers=hq)
    assert stale.status_code == 409
    listed = client.get("/api/homework", params={"course_id": "la"}, headers=hq).json()
    assert [(item["id"], item["version"], item["data"]["answer"]["text"]) for item in listed] == [("hw-1", 2, "det = -2")]
    assert client.get("/api/homework", params={"course_id": "other"}, headers=hq).json() == []

    # Another account sees nothing and can't touch it.
    assert client.get("/api/homework", headers=other).json() == []
    assert client.put("/api/homework/hw-1", json={"course_id": "la", "data": data, "version": 2}, headers=other).status_code == 404
    client.delete("/api/homework/hw-1", headers=other)
    assert len(client.get("/api/homework", headers=hq).json()) == 1

    assert client.put("/api/homework/hw-2", json={"course_id": "la", "data": {"x": "y" * 400_000}, "version": 0}, headers=hq).status_code == 413
    assert client.put("/api/homework/bad id!", json={"course_id": "la", "data": {}, "version": 0}, headers=hq).status_code == 400
    assert client.delete("/api/homework/hw-1", headers=hq).status_code == 204
    assert client.get("/api/homework", headers=hq).json() == []
    assert client.put("/api/homework/hw-1", json={"course_id": "la", "data": data, "version": 2}, headers=hq).status_code == 409


def test_uploaded_photos_can_be_shown_to_their_owner_only(client):
    hq = auth_header(register(client, "hw-photo").json()["token"])
    other = auth_header(register(client, "hw-photo-2").json()["token"])
    doc = fitz.open()
    doc.new_page(width=400, height=300).insert_text((40, 150), "my working", fontsize=20)
    png = doc[0].get_pixmap().tobytes("png")
    upload = client.post("/api/uploads", files={"file": ("IMG_1.png", png, "image/png")}, headers=hq).json()
    page = client.get(f"/api/uploads/{upload['id']}/page", params={"width": 300}, headers=hq)
    assert page.status_code == 200 and page.headers["content-type"] == "image/png" and fitz.Pixmap(page.content).width == 300
    assert client.get(f"/api/uploads/{upload['id']}/page", headers=other).status_code == 404
    assert client.get(f"/api/uploads/{upload['id']}/page", params={"page": 2}, headers=hq).status_code == 404


def test_photos_are_copied_into_text_question_and_answer_separately(client, ai):
    calls, _ = ai
    hq = auth_header(register(client, "hw-read").json()["token"])
    doc = fitz.open()
    doc.new_page().insert_text((72, 90), "question", fontsize=12)
    upload = client.post("/api/uploads", files={"file": ("q.pdf", doc.tobytes(), "application/pdf")}, headers=hq).json()
    question = client.post("/api/homework/read", json={"upload_ids": [upload["id"]], "part": "question"}, headers=hq).json()
    answer = client.post("/api/homework/read", json={"upload_ids": [upload["id"]], "part": "answer"}, headers=hq).json()
    assert question["text"] == "求 $A$ 的逆矩阵" and question["pages"] == {upload["id"]: 1}
    assert answer["text"].startswith("$\\det A")
    assert "【抄题】" in calls[0][0]["content"] and "原样保留学生的错误" in calls[1][0]["content"]
    other = auth_header(register(client, "hw-read-2").json()["token"])
    assert client.post("/api/homework/read", json={"upload_ids": [upload["id"]]}, headers=other).status_code == 404


def test_check_points_at_the_first_mistake_and_keeps_the_solution_back(client, ai):
    calls, replies = ai
    hq = auth_header(register(client, "hw-check").json()["token"])
    replies["【作业批改】"] = (
        "@@VERDICT partial\n@@KIND calc\n@@WHERE\n$\\det A = 4-6 = 2$\n@@WHY\n符号算错了\n@@ANSWER\n"
        "$A^{-1}=\\begin{pmatrix}-2&1\\\\1.5&-0.5\\end{pmatrix}$\n@@SOLUTION\n1. 求行列式\n2. 伴随矩阵\n@@HINT\n再算一次 $4-6$\n@@TOPIC s1:n2\n@@END"
    )
    body = {**BASE, "answer": "$\\det A = 2$", "history": [{"role": "hint", "text": "先求行列式"}], "learner_memory": "- 矩阵乘法（《线性代数》· 已掌握）"}
    result = client.post("/api/homework/check", json=body, headers=hq).json()
    assert result["verdict"] == "partial" and result["kind"] == "calc" and result["topic_key"] == "s1:n2"
    assert result["where"] == "$\\det A = 4-6 = 2$" and "\\frac" not in result["answer"] and result["solution"].startswith("1.")
    system, user = calls[-1][0]["content"], calls[-1][1]["content"]
    assert "只指出**第一处**" in system and "知识档案" in system
    assert "【提示 1】\n先求行列式" in user and "key=s1:n2｜第 3 讲 · 逆矩阵" in user and "## 逆矩阵" in user

    replies["【作业批改】"] = "@@VERDICT correct\n@@KIND calc\n@@WHERE\n无\n@@WHY\n行列式和伴随都对\n@@ANSWER\nx\n@@SOLUTION\ny\n@@HINT\nz\n@@TOPIC made-up\n@@END"
    result = client.post("/api/homework/check", json={**BASE, "answer": "ok"}, headers=hq).json()
    assert result["verdict"] == "correct" and result["kind"] is None and result["where"] == "" and result["hint"] == "" and result["topic_key"] is None

    replies["【作业批改】"] = "looks fine to me"
    assert client.post("/api/homework/check", json={**BASE, "answer": "ok"}, headers=hq).status_code == 502


def test_guide_gives_one_hint_and_never_the_answer(client, ai):
    calls, replies = ai
    hq = auth_header(register(client, "hw-guide").json()["token"])
    replies["【引导】"] = "@@FEEDBACK\n这一步对\n@@ONTRACK yes\n@@HINT\n先想想 $\\det A$ 怎么算\n@@DONE no\n@@TOPIC s1:n2\n@@END"
    first = client.post("/api/homework/guide", json=BASE, headers=hq).json()
    assert first == {"feedback": "", "on_track": True, "hint": "先想想 $\\det A$ 怎么算", "done": False, "topic_key": "s1:n2"}
    assert "绝对不要给出完整解答" in calls[-1][0]["content"] and "学生没有新的尝试" in calls[-1][1]["content"]

    replies["【引导】"] = "@@FEEDBACK\n对了，答案正确\n@@ONTRACK yes\n@@HINT\n不该出现\n@@DONE yes\n@@TOPIC none\n@@END"
    history = [{"role": "hint", "text": "先求行列式"}, {"role": "attempt", "text": "det=-2"}, {"role": "feedback", "text": "对"}]
    done = client.post("/api/homework/guide", json={**BASE, "history": history, "attempt": "A^{-1} = ..."}, headers=hq).json()
    assert done["done"] is True and done["hint"] == "" and done["feedback"].startswith("对了")
    assert "【学生的尝试】\ndet=-2" in calls[-1][1]["content"] and "【学生最新的尝试】" in calls[-1][1]["content"]


def test_solution_on_request_and_conclusion(client, ai):
    _, replies = ai
    hq = auth_header(register(client, "hw-end").json()["token"])
    replies["【完整解答】"] = "@@SOLUTION\n1. $\\det A=-2$\n@@ANSWER\n$A^{-1}=…$\n@@END"
    assert client.post("/api/homework/solve", json=BASE, headers=hq).json()["solution"] == "1. $\\det A=-2$"

    replies["【总结】"] = "@@IDEA\n二阶矩阵求逆：交换主对角、副对角变号、除以行列式\n@@METHOD\n- 先算 det\n- 再写伴随\n@@STUCK\n行列式符号算错\n@@KIND calc\n@@SOLVED yes\n@@TOPIC s1:n2\n@@END"
    history = [{"role": "answer", "text": "det = 2"}, {"role": "check", "text": "部分正确：符号错"}, {"role": "answer", "text": "det=-2 …"}]
    card = client.post("/api/homework/conclude", json={**BASE, "history": history}, headers=hq).json()
    assert card["solved"] is True and card["kind"] == "calc" and card["topic_key"] == "s1:n2" and card["method"].startswith("- 先算")
    peeked = client.post("/api/homework/conclude", json={**BASE, "history": history, "saw_solution": True}, headers=hq).json()
    assert peeked["solved"] is False


def test_student_can_ask_whether_their_idea_is_right(client, ai):
    calls, replies = ai
    hq = auth_header(register(client, "hw-ask").json()["token"])
    replies["【答疑】"] = "@@VERDICT partial\n@@REPLY\n方向对：先求 $\\det A$。但不需要特征值。\n@@TOPIC s1:n2\n@@END"
    history = [{"role": "hint", "text": "先求行列式"}, {"role": "ask", "text": "要用伴随矩阵吗"}, {"role": "reply", "text": "要"}]
    result = client.post("/api/homework/ask", json={**BASE, "history": history, "message": "我打算先求特征值，再求逆，对吗？"}, headers=hq).json()
    assert result == {"verdict": "partial", "reply": "方向对：先求 $\\det A$。但不需要特征值。", "topic_key": "s1:n2"}
    system, user = calls[-1][0]["content"], calls[-1][1]["content"]
    assert "除非他在这条消息里明确要求" in system
    assert "【学生的问题 / 想法】\n要用伴随矩阵吗" in user and "【学生这条消息】\n我打算先求特征值" in user

    replies["【答疑】"] = "@@VERDICT none\n@@REPLY\n伴随矩阵是代数余子式矩阵的转置。\n@@TOPIC none\n@@END"
    result = client.post("/api/homework/ask", json={**BASE, "message": "什么是伴随矩阵？"}, headers=hq).json()
    assert result["verdict"] is None and result["topic_key"] is None
    assert client.post("/api/homework/ask", json={**BASE, "message": ""}, headers=hq).status_code == 422
