"""题目答疑: homework problems — check my answer, or guide me from the start, then a conclusion.

Storage: one row per problem (`homework_items`), so the question can be added on a PC and the
answer from a phone without the two devices overwriting each other.

AI: question / answer photos are first copied into text (LaTeX) once, so every later turn is text
only. Marking never shows the full solution unless asked; guiding never gives the answer away.
All output uses the "@@TAG" text format (LaTeX-safe), like practice.py.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import fitz
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.practice import _ask, _ensure_ai, parse_blocks
from app.config import get_settings
from app.database import get_db
from app.models import HomeworkItem, UploadedFile, User
from app.providers import language_rule, reply_language
from app.security import get_current_user, get_optional_user, require_ai_access
from app.services.ai_provider import AIProvider
from app.services.learner import learner_note
from app.services.visual_processor import VisualProcessingError, prepare_visual_document

router = APIRouter(tags=["homework"])

MAX_ITEM_BYTES = 300_000
PREVIEW_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
KINDS = {"concept", "start", "calc", "careless"}


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

class HomeworkPut(BaseModel):
    course_id: str = Field(min_length=1, max_length=200)
    data: dict[str, Any]
    # The version this edit started from (0 for a new problem). A mismatch means another device saved first.
    version: int = Field(ge=0)


class HomeworkOut(BaseModel):
    id: str
    course_id: str
    data: dict[str, Any]
    version: int
    updated_at: datetime


def _out(item: HomeworkItem) -> HomeworkOut:
    return HomeworkOut(id=item.id, course_id=item.course_id, data=item.data or {}, version=item.version, updated_at=item.updated_at)


@router.get("/homework", response_model=list[HomeworkOut])
def list_homework(course_id: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[HomeworkOut]:
    query = select(HomeworkItem).where(HomeworkItem.user_id == user.id)
    if course_id:
        query = query.where(HomeworkItem.course_id == course_id)
    rows = db.scalars(query.order_by(HomeworkItem.created_at.desc()).limit(500)).all()
    return [_out(row) for row in rows]


@router.put("/homework/{item_id}", response_model=HomeworkOut)
def save_homework(item_id: str, payload: HomeworkPut, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> HomeworkOut:
    if not re.fullmatch(r"[\w-]{4,80}", item_id):
        raise HTTPException(status_code=400, detail="题目编号无效")
    if len(json.dumps(payload.data, ensure_ascii=False)) > MAX_ITEM_BYTES:
        raise HTTPException(status_code=413, detail="这道题的内容太多了")
    item = db.get(HomeworkItem, item_id)
    if item is not None and item.user_id != user.id:
        raise HTTPException(status_code=404, detail="题目不存在")
    if item is None:
        if payload.version != 0:
            raise HTTPException(status_code=409, detail="这道题已经被删除了")
        item = HomeworkItem(id=item_id, user_id=user.id, course_id=payload.course_id, data=payload.data, version=1)
        db.add(item)
    else:
        if payload.version != item.version:
            raise HTTPException(status_code=409, detail="这道题刚在另一台设备上更新过，已载入最新内容")
        item.data = payload.data
        item.course_id = payload.course_id
        item.version += 1
    db.commit()
    db.refresh(item)
    return _out(item)


@router.delete("/homework/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_homework(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    item = db.get(HomeworkItem, item_id)
    if item is not None and item.user_id == user.id:
        db.delete(item)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _owned_upload(db: Session, upload_id: str, user: User | None) -> UploadedFile:
    row = db.get(UploadedFile, upload_id)
    if row is None or row.user_id != (user.id if user else None):
        raise HTTPException(status_code=404, detail="找不到之前上传的文件，请重新上传")
    return row


@router.get("/uploads/{upload_id}/page")
def upload_page(
    upload_id: str,
    page: int = 1,
    width: int = Query(default=900, ge=80, le=1600),
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
) -> Response:
    """One page of an uploaded photo / PDF as an image (the question or answer someone uploaded)."""
    path = Path(_owned_upload(db, upload_id, user).stored_path)
    if path.suffix.lower() not in PREVIEW_SUFFIXES:
        raise HTTPException(status_code=404, detail="这种文件没有页面预览")
    with fitz.open(path) as doc:
        if not 1 <= page <= len(doc):
            raise HTTPException(status_code=404, detail="页码超出范围")
        target = doc[page - 1]
        zoom = width / max(target.rect.width, 1)
        image = target.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False).tobytes("png")
    return Response(content=image, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


# ---------------------------------------------------------------------------
# Copy the question / the student's working from photos or PDFs into text
# ---------------------------------------------------------------------------

READ_QUESTION_PROMPT = """【抄题】把图片 / 文档里的题目一字不差地抄成 Markdown：
- 公式用 LaTeX（行内 $...$，独立公式 $$...$$），矩阵用 \\begin{pmatrix}...\\end{pmatrix}；
- 保留题号、小题 (a)(b)…、已知条件；图只用一句话描述，写成「［图：…］」；
- 只抄题目，不要解题，不要加评论；看不清的地方写「［看不清］」。
直接输出抄好的内容，不要其它话。"""

READ_ANSWER_PROMPT = """【抄答案】下面是学生自己写的解答（常常是手写拍照）。把它逐行抄成 Markdown：
- 保持学生原来的步骤和顺序，一步一行；公式用 LaTeX；
- 原样保留学生的错误，不要改正、不要补步骤、不要评价；
- 划掉的内容不要抄；看不清的地方写「［看不清］」。
直接输出抄好的内容，不要其它话。"""


class ReadRequest(BaseModel):
    upload_ids: list[str] = Field(min_length=1, max_length=8)
    part: Literal["question", "answer"] = "question"


class ReadResponse(BaseModel):
    text: str
    pages: dict[str, int]


@router.post("/homework/read", response_model=ReadResponse)
async def read_homework(payload: ReadRequest, request: Request, user: User | None = Depends(require_ai_access), db: Session = Depends(get_db)) -> ReadResponse:
    settings = _ensure_ai(request)
    rows = [_owned_upload(db, upload_id, user) for upload_id in payload.upload_ids]
    prompt = (READ_QUESTION_PROMPT if payload.part == "question" else READ_ANSWER_PROMPT) + language_rule(reply_language(request))
    texts: list[str] = []
    pages: dict[str, int] = {}
    for row in rows:
        source = Path(row.stored_path)
        try:
            document = await asyncio.to_thread(prepare_visual_document, source, row.filename, source.parent, get_settings())
        except VisualProcessingError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        pages[row.id] = document.pages
        parts = list(document.content_parts)
        for start in range(0, max(len(parts), 1), 40):
            try:
                raw, _ = await AIProvider(settings).analyze_visual_materials(parts[start:start + 40], system_prompt=prompt, max_tokens=4000)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"AI 读图失败：{exc}") from exc
            texts.append(raw.strip())
    text = "\n\n".join(item for item in texts if item)
    if not text:
        raise HTTPException(status_code=502, detail="没有从图片里读到内容，请换一张更清楚的照片")
    return ReadResponse(text=text[:12000], pages=pages)


# ---------------------------------------------------------------------------
# Shared context for marking, guiding, solving and concluding
# ---------------------------------------------------------------------------

class TopicRef(BaseModel):
    key: str = Field(min_length=1, max_length=200)
    title: str = Field(max_length=300)


class HomeworkContext(BaseModel):
    course_title: str = Field(default="", max_length=300)
    question: str = Field(min_length=1, max_length=12000)
    reference: str = Field(default="", max_length=8000)  # the matching notes from the course
    topics: list[TopicRef] = Field(default_factory=list, max_length=150)
    learner_memory: str = Field(default="", max_length=4000)


class Turn(BaseModel):
    role: Literal["answer", "check", "hint", "attempt", "feedback", "solution"]
    text: str = Field(max_length=8000)


ROLE_LABEL = {"answer": "学生的解答", "check": "批改结果", "hint": "提示", "attempt": "学生的尝试", "feedback": "对尝试的反馈", "solution": "完整解答"}


def _context(payload: HomeworkContext, history: list[Turn] | None = None) -> str:
    parts = [f"课程：{payload.course_title or '（未填写）'}"]
    if payload.topics:
        parts.append("知识点列表（判断考点时从这里选 key）：\n" + "\n".join(f"- key={topic.key}｜{topic.title}" for topic in payload.topics))
    if payload.reference.strip():
        parts.append(f"相关讲稿（课程笔记）：\n{payload.reference.strip()[:8000]}")
    parts.append(f"题目：\n{payload.question.strip()}")
    if history:
        hint_number = 0
        lines = []
        for turn in history[-30:]:
            label = ROLE_LABEL[turn.role]
            if turn.role == "hint":
                hint_number += 1
                label = f"提示 {hint_number}"
            lines.append(f"【{label}】\n{turn.text.strip()}")
        parts.append("到目前为止：\n" + "\n\n".join(lines))
    return "\n\n".join(parts)


def _system(prompt: str, payload: HomeworkContext) -> str:
    return prompt + learner_note(payload.learner_memory, "tutor")


def _fields(raw: str) -> dict[str, tuple[dict[str, str], str]]:
    fields: dict[str, tuple[dict[str, str], str]] = {}
    for tag, attrs, text in parse_blocks(raw):
        fields.setdefault(tag, (attrs, text))
    return fields


def _word(fields: dict[str, tuple[dict[str, str], str]], tag: str) -> str:
    return (fields.get(tag, ({}, ""))[1].split() or [""])[0].strip().lower()


def _text(fields: dict[str, tuple[dict[str, str], str]], tag: str) -> str:
    text = fields.get(tag, ({}, ""))[1].strip()
    return "" if text in {"无", "none", "None", "-"} else text


def _topic(fields: dict[str, tuple[dict[str, str], str]], payload: HomeworkContext) -> str | None:
    key = fields.get("TOPIC", ({}, ""))[1].strip().split()
    value = key[0] if key else ""
    return value if value in {topic.key for topic in payload.topics} else None


# ---------------------------------------------------------------------------
# Mode A: check my answer
# ---------------------------------------------------------------------------

CHECK_PROMPT = """【作业批改】你在批改学生的作业。先自己完整、仔细地解出这道题，再逐步对照学生的解答。
- 判定：correct（思路和结果都对）、partial（方向对，但有错或没做完）、wrong（方法或结果错）；
- 只指出**第一处**出错的步骤（引用学生写的式子或原话），说明为什么错；后面的错误先不提；
- 给出正确的最终答案（只要结果，不要过程）；
- 完整解题步骤写在 SOLUTION 里，只有学生要求时才会显示；
- HINT 写一句提示，帮他自己改正那一步，不要直接写出改正后的结果；
- 从知识点列表里选这道题主要考的 key，都不合适写 none；
- 公式用 LaTeX（行内 $...$）。
严格按下面格式输出：
@@VERDICT <correct/partial/wrong>
@@KIND <concept/start/calc/careless/none>
@@WHERE
第一处出错的步骤（全对写“无”）
@@WHY
为什么错（全对时一句话说他做对的关键）
@@ANSWER
正确的最终答案
@@SOLUTION
完整解题步骤
@@HINT
一句改正提示（全对留空）
@@TOPIC <key 或 none>
@@END"""


class CheckRequest(HomeworkContext):
    answer: str = Field(min_length=1, max_length=12000)
    history: list[Turn] = Field(default_factory=list, max_length=40)


class CheckResponse(BaseModel):
    verdict: Literal["correct", "partial", "wrong"]
    kind: Literal["concept", "start", "calc", "careless"] | None
    where: str
    why: str
    answer: str
    solution: str
    hint: str
    topic_key: str | None


@router.post("/homework/check", response_model=CheckResponse)
async def check_answer(payload: CheckRequest, request: Request, _user: User | None = Depends(require_ai_access)) -> CheckResponse:
    user = _context(payload, payload.history) + f"\n\n【学生这次交的解答】\n{payload.answer.strip()}"
    fields = _fields(await _ask(request, _system(CHECK_PROMPT, payload), user, max_tokens=3500))
    verdict = _word(fields, "VERDICT")
    if verdict not in {"correct", "partial", "wrong"}:
        raise HTTPException(status_code=502, detail="AI 没有按格式批改，请重试")
    kind = _word(fields, "KIND")
    return CheckResponse(
        verdict=verdict,  # type: ignore[arg-type]
        kind=(kind if kind in KINDS else "concept") if verdict != "correct" else None,  # type: ignore[arg-type]
        where=_text(fields, "WHERE") if verdict != "correct" else "",
        why=_text(fields, "WHY"),
        answer=_text(fields, "ANSWER"),
        solution=_text(fields, "SOLUTION"),
        hint=_text(fields, "HINT") if verdict != "correct" else "",
        topic_key=_topic(fields, payload),
    )


# ---------------------------------------------------------------------------
# Mode B: guide me (one hint at a time, never the answer)
# ---------------------------------------------------------------------------

GUIDE_PROMPT = """【引导】学生不会做这道题。像好老师一样一步一步引导他自己做出来——绝对不要给出完整解答，也不要说出最终答案。
提示循序渐进（看对话里已经给过几条提示）：
- 第 1 条：点出要用哪个概念 / 定理 / 公式，以及从题目的哪里看出来；
- 第 2 条：告诉他第一步怎么列式或怎么设（不替他算出来）；
- 之后：根据他最新的尝试，只说下一步该做什么。
如果学生交了新的尝试：先判断这一步对不对（ONTRACK yes/no），在 FEEDBACK 里简短说明；错了就指出错在哪、为什么。
如果他的尝试已经得到正确的最终答案：DONE 写 yes，FEEDBACK 里确认他做对了，HINT 留空。
每次只给一条提示，2-4 句话；公式用 LaTeX。从知识点列表里选这道题主要考的 key，或 none。
严格按格式输出：
@@FEEDBACK
对最新尝试的反馈（没有新尝试就留空）
@@ONTRACK <yes/no/none>
@@HINT
下一条提示
@@DONE <yes/no>
@@TOPIC <key 或 none>
@@END"""


class GuideRequest(HomeworkContext):
    history: list[Turn] = Field(default_factory=list, max_length=40)
    attempt: str = Field(default="", max_length=12000)  # the newest try; empty = just the next hint


class GuideResponse(BaseModel):
    feedback: str
    on_track: bool | None
    hint: str
    done: bool
    topic_key: str | None


@router.post("/homework/guide", response_model=GuideResponse)
async def guide(payload: GuideRequest, request: Request, _user: User | None = Depends(require_ai_access)) -> GuideResponse:
    user = _context(payload, payload.history)
    user += f"\n\n【学生最新的尝试】\n{payload.attempt.strip()}" if payload.attempt.strip() else "\n\n（学生没有新的尝试，请给下一条提示）"
    fields = _fields(await _ask(request, _system(GUIDE_PROMPT, payload), user, max_tokens=1500))
    hint, feedback = _text(fields, "HINT"), _text(fields, "FEEDBACK")
    done = _word(fields, "DONE") == "yes"
    if not hint and not feedback:
        raise HTTPException(status_code=502, detail="AI 没有按格式回答，请重试")
    track = _word(fields, "ONTRACK")
    return GuideResponse(
        feedback=feedback if payload.attempt.strip() else "",
        on_track=True if track == "yes" else False if track == "no" else None,
        hint="" if done else hint,
        done=done,
        topic_key=_topic(fields, payload),
    )


# ---------------------------------------------------------------------------
# Full solution (only when asked) and the conclusion card
# ---------------------------------------------------------------------------

SOLVE_PROMPT = """【完整解答】学生要看这道题的完整解答。先一句话说思路，再分步骤写，每步说明依据；最后单独写出最终答案。公式用 LaTeX。
严格按格式输出：
@@SOLUTION
完整解答
@@ANSWER
最终答案
@@END"""


class SolveResponse(BaseModel):
    solution: str
    answer: str


@router.post("/homework/solve", response_model=SolveResponse)
async def solve(payload: HomeworkContext, request: Request, _user: User | None = Depends(require_ai_access)) -> SolveResponse:
    fields = _fields(await _ask(request, _system(SOLVE_PROMPT, payload), _context(payload), max_tokens=3500))
    solution = _text(fields, "SOLUTION")
    if not solution:
        raise HTTPException(status_code=502, detail="AI 没有按格式回答，请重试")
    return SolveResponse(solution=solution, answer=_text(fields, "ANSWER"))


CONCLUDE_PROMPT = """【总结】这道题做完了。根据整个过程写一张简短的总结卡，让学生下次遇到同类题自己会做：
- IDEA：这道题的关键在哪（1-2 句）；
- METHOD：下次可以照着用的方法 / 步骤（2-4 条，Markdown 列表）；
- STUCK：他这次卡在哪里或错在哪里，具体到哪一步、什么原因；一路都对就写“无”；
- KIND：这次主要的问题 concept（概念不清）/ start（不会起步）/ calc（计算错误）/ careless（粗心）/ none；
- SOLVED：他是否靠自己得到了正确答案（看了完整解答才做对的不算）yes/no；
- TOPIC：主要考的知识点 key，或 none。
公式用 LaTeX。严格按格式输出：
@@IDEA
...
@@METHOD
...
@@STUCK
...
@@KIND <concept/start/calc/careless/none>
@@SOLVED <yes/no>
@@TOPIC <key 或 none>
@@END"""


class ConcludeRequest(HomeworkContext):
    history: list[Turn] = Field(default_factory=list, max_length=40)
    saw_solution: bool = False


class ConcludeResponse(BaseModel):
    idea: str
    method: str
    stuck: str
    kind: Literal["concept", "start", "calc", "careless"] | None
    solved: bool
    topic_key: str | None


@router.post("/homework/conclude", response_model=ConcludeResponse)
async def conclude(payload: ConcludeRequest, request: Request, _user: User | None = Depends(require_ai_access)) -> ConcludeResponse:
    user = _context(payload, payload.history) + ("\n\n（学生看过完整解答）" if payload.saw_solution else "")
    fields = _fields(await _ask(request, _system(CONCLUDE_PROMPT, payload), user, max_tokens=1500))
    idea = _text(fields, "IDEA")
    if not idea:
        raise HTTPException(status_code=502, detail="AI 没有按格式总结，请重试")
    kind = _word(fields, "KIND")
    solved = _word(fields, "SOLVED") == "yes" and not payload.saw_solution
    return ConcludeResponse(
        idea=idea,
        method=_text(fields, "METHOD"),
        stuck=_text(fields, "STUCK"),
        kind=kind if kind in KINDS else None,  # type: ignore[arg-type]
        solved=solved,
        topic_key=_topic(fields, payload),
    )
