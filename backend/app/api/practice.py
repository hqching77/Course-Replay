"""AI for weak points and 考前冲刺: quick diagnosis questions, marking answers, targeted practice,
and reading past exam papers.

The model answers in a delimited text format ("@@TAG" lines) instead of JSON, so LaTeX such as
\\frac or \\beta in questions and answers can't break parsing (JSON would read \\f and \\b as escapes).
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import UploadedFile, User
from app.providers import effective_settings, language_rule, reply_language
from app.security import require_ai_access
from app.services.ai_provider import AIProvider
from app.services.learner import learner_note
from app.services.visual_processor import VisualProcessingError, prepare_visual_document

router = APIRouter(tags=["practice"])

_TAG = re.compile(r"^@@([A-Z]+)\b(.*)$")


def parse_blocks(raw: str) -> list[tuple[str, dict[str, str], str]]:
    """'@@Q key=k1\\ntext' → [('Q', {'key': 'k1'}, 'text'), …]. Text keeps LaTeX untouched."""
    blocks: list[tuple[str, dict[str, str], list[str]]] = []
    for line in raw.replace("\r\n", "\n").split("\n"):
        match = _TAG.match(line.strip())
        if match:
            attrs = dict(re.findall(r"(\w+)=(\S+)", match.group(2)))
            rest = re.sub(r"\w+=\S+", "", match.group(2)).strip()
            blocks.append((match.group(1), attrs, [rest] if rest else []))
        elif blocks:
            blocks[-1][2].append(line)
    return [(tag, attrs, "\n".join(lines).strip()) for tag, attrs, lines in blocks if tag != "END"]


def _ensure_ai(request: Request):
    settings = effective_settings(request)
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="AI 服务尚未配置")
    return settings


async def _ask(request: Request, system: str, user: str, max_tokens: int) -> str:
    settings = _ensure_ai(request)
    try:
        return await AIProvider(settings).chat(
            [{"role": "system", "content": system + language_rule(reply_language(request))}, {"role": "user", "content": user}],
            temperature=0.3,
            max_tokens=max_tokens,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 回答失败：{exc}") from exc


# ---------------------------------------------------------------------------
# Quick diagnosis: multiple-choice questions per knowledge point
# ---------------------------------------------------------------------------

class TopicInput(BaseModel):
    key: str = Field(min_length=1, max_length=200)
    title: str = Field(max_length=300)
    content: str = Field(default="", max_length=6000)


class QuizRequest(BaseModel):
    course_title: str = Field(default="", max_length=300)
    topics: list[TopicInput] = Field(min_length=1, max_length=20)
    per_topic: int = Field(default=2, ge=1, le=3)


class QuizQuestion(BaseModel):
    key: str
    question: str
    options: list[str]
    answer: int  # index into options
    explanation: str = ""


class QuizResponse(BaseModel):
    questions: list[QuizQuestion]


QUIZ_PROMPT = """【出题·诊断】你在帮学生做考前诊断：判断每个知识点是已经掌握、不太稳还是不会。
为每个知识点出 {n} 道单选题（4 个选项，只有一个正确），只根据给出的讲稿内容出题：
- 考理解和应用，不考死记硬背的字句；难度适中，答对说明真的会；
- 干扰项要像常见错误，不要一眼就能排除；
- 公式用 LaTeX（行内 $...$），直接写反斜杠。
严格按下面格式输出，每题一个块，不要其它内容：
@@Q key=<知识点的 key>
题干
@@A 选项 A
@@B 选项 B
@@C 选项 C
@@D 选项 D
@@ANSWER <A/B/C/D>
@@WHY 一句话解释为什么
@@END"""


def parse_quiz(raw: str, keys: set[str]) -> list[QuizQuestion]:
    questions: list[QuizQuestion] = []
    current: dict | None = None
    for tag, attrs, text in parse_blocks(raw):
        if tag == "Q":
            current = {"key": attrs.get("key", ""), "question": text, "options": {}, "answer": "", "why": ""}
            questions.append(current)  # type: ignore[arg-type]
        elif current is not None and tag in {"A", "B", "C", "D"}:
            current["options"][tag] = text
        elif current is not None and tag == "ANSWER":
            current["answer"] = text.strip()[:1].upper()
        elif current is not None and tag == "WHY":
            current["why"] = text
    valid: list[QuizQuestion] = []
    for item in questions:  # type: ignore[assignment]
        options = [item["options"].get(letter, "") for letter in "ABCD"]
        if item["key"] in keys and item["question"] and all(options) and item["answer"] in "ABCD" and item["answer"]:
            valid.append(QuizQuestion(key=item["key"], question=item["question"], options=options, answer="ABCD".index(item["answer"]), explanation=item["why"]))
    return valid


@router.post("/practice/quiz", response_model=QuizResponse)
async def diagnosis_quiz(payload: QuizRequest, request: Request, _user: User | None = Depends(require_ai_access)) -> QuizResponse:
    topics = "\n\n".join(f"### key={topic.key}｜{topic.title}\n{topic.content[:2500]}" for topic in payload.topics)
    raw = await _ask(request, QUIZ_PROMPT.format(n=payload.per_topic), f"课程：{payload.course_title}\n\n{topics}", max_tokens=4000)
    questions = parse_quiz(raw, {topic.key for topic in payload.topics})
    if not questions:
        raise HTTPException(status_code=502, detail="AI 没有按格式出题，请重试")
    return QuizResponse(questions=questions)


# ---------------------------------------------------------------------------
# Marking an answer: verdict, what's wrong, the answer; full steps only if asked
# ---------------------------------------------------------------------------

class GradeRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    answer: str = Field(min_length=1, max_length=4000)
    topic: str = Field(default="", max_length=300)
    reference: str = Field(default="", max_length=8000)  # the knowledge point's notes / the expected answer


class GradeResponse(BaseModel):
    verdict: Literal["correct", "partial", "wrong"]
    kind: Literal["concept", "start", "calc", "careless"] | None = None
    feedback: str
    answer: str = ""
    solution: str = ""


GRADE_PROMPT = """【批改】你在批改学生的答案。先自己算出正确答案，再对照学生的回答：
- verdict：correct（完全正确）/ partial（思路对但不完整或有小错）/ wrong（错误）；
- kind（不是 correct 时必填）：concept（概念没懂）/ start（不知道怎么开始、方法没选对）/ calc（方法对、计算错）/ careless（粗心、抄错）；
- FEEDBACK：答对就简短肯定要点；答错就指出**第一处出错的地方**和原因，不要写完整解题步骤；
- ANSWER：正确的最终答案（简短）；
- SOLUTION：完整解题步骤（学生要求时才会显示）。
公式用 LaTeX（行内 $...$），直接写反斜杠。严格按格式输出：
@@VERDICT <correct/partial/wrong>
@@KIND <concept/start/calc/careless/none>
@@FEEDBACK
...
@@ANSWER
...
@@SOLUTION
...
@@END"""


def parse_grade(raw: str) -> GradeResponse:
    fields = {tag: text for tag, _, text in parse_blocks(raw)}
    verdict = (fields.get("VERDICT") or "").strip().lower()
    if verdict not in {"correct", "partial", "wrong"}:
        raise HTTPException(status_code=502, detail="AI 没有按格式批改，请重试")
    kind = (fields.get("KIND") or "").strip().lower()
    return GradeResponse(
        verdict=verdict,  # type: ignore[arg-type]
        kind=kind if kind in {"concept", "start", "calc", "careless"} and verdict != "correct" else ("concept" if verdict != "correct" else None),  # type: ignore[arg-type]
        feedback=fields.get("FEEDBACK", "").strip(),
        answer=fields.get("ANSWER", "").strip(),
        solution=fields.get("SOLUTION", "").strip(),
    )


@router.post("/practice/grade", response_model=GradeResponse)
async def grade_answer(payload: GradeRequest, request: Request, _user: User | None = Depends(require_ai_access)) -> GradeResponse:
    user = f"知识点：{payload.topic}\n\n参考讲稿：\n{payload.reference[:6000]}\n\n题目：\n{payload.question}\n\n学生的回答：\n{payload.answer}"
    return parse_grade(await _ask(request, GRADE_PROMPT, user, max_tokens=1800))


# ---------------------------------------------------------------------------
# Targeted practice for one weak topic
# ---------------------------------------------------------------------------

class ProblemsRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=300)
    content: str = Field(default="", max_length=8000)
    count: int = Field(default=3, ge=1, le=5)
    past_questions: list[str] = Field(default_factory=list, max_length=5)
    mistakes: list[str] = Field(default_factory=list, max_length=5)
    learner_memory: str = Field(default="", max_length=4000)


class Problem(BaseModel):
    question: str
    answer: str = ""
    hint: str = ""


class ProblemsResponse(BaseModel):
    problems: list[Problem]


PROBLEMS_PROMPT = """【练习题】学生在这个知识点上薄弱，给他出 {n} 道针对性的练习题（计算或简答，不要选择题），由浅入深：
- 只用给出的讲稿内容范围；如果给了往年考题，题型和难度向它们靠拢；如果给了学生以前错在哪里，专门针对那些错误出题；
- 每题附简短的参考答案和一句提示（提示只点方向，不给步骤）。
公式用 LaTeX（行内 $...$），直接写反斜杠。严格按格式输出：
@@PROBLEM
题目
@@ANSWER
参考答案
@@HINT
提示
@@END"""


@router.post("/practice/problems", response_model=ProblemsResponse)
async def practice_problems(payload: ProblemsRequest, request: Request, _user: User | None = Depends(require_ai_access)) -> ProblemsResponse:
    extra = ""
    if payload.past_questions:
        extra += "\n\n往年考题（参考题型）：\n" + "\n".join(f"- {item[:600]}" for item in payload.past_questions)
    if payload.mistakes:
        extra += "\n\n学生以前错在：\n" + "\n".join(f"- {item[:300]}" for item in payload.mistakes)
    raw = await _ask(request, PROBLEMS_PROMPT.format(n=payload.count) + learner_note(payload.learner_memory, "practice"), f"知识点：{payload.topic}\n\n讲稿：\n{payload.content[:6000]}{extra}", max_tokens=3000)
    problems: list[Problem] = []
    for tag, _, text in parse_blocks(raw):
        if tag == "PROBLEM" and text:
            problems.append(Problem(question=text))
        elif problems and tag == "ANSWER":
            problems[-1].answer = text
        elif problems and tag == "HINT":
            problems[-1].hint = text
    if not problems:
        raise HTTPException(status_code=502, detail="AI 没有按格式出题，请重试")
    return ProblemsResponse(problems=problems[: payload.count])


# ---------------------------------------------------------------------------
# Past exam papers: which topics come up
# ---------------------------------------------------------------------------

class PastPaperRequest(BaseModel):
    upload_ids: list[str] = Field(min_length=1, max_length=5)
    topics: list[TopicInput] = Field(min_length=1, max_length=200)


class PastQuestion(BaseModel):
    text: str
    topic_key: str | None = None


class PastPaperResponse(BaseModel):
    questions: list[PastQuestion]


PAPER_PROMPT = """【试卷】下面是一份往年考试试卷的页面。把每一道题（含小题）抄成文字，并判断它主要考哪个知识点：
- topic 写知识点列表里最匹配的 key；都不匹配就写 none；
- 题目文字保留公式（LaTeX，行内 $...$，直接写反斜杠），不要解答。
严格按格式输出：
@@QUESTION topic=<key 或 none>
题目文字
@@END"""


@router.post("/practice/past-paper", response_model=PastPaperResponse)
async def read_past_paper(
    payload: PastPaperRequest,
    request: Request,
    user: User | None = Depends(require_ai_access),
    db: Session = Depends(get_db),
) -> PastPaperResponse:
    settings = _ensure_ai(request)
    rows = db.scalars(select(UploadedFile).where(UploadedFile.id.in_(payload.upload_ids))).all()
    owned = [row for row in rows if row.user_id == (user.id if user else None)]
    if len(owned) != len(set(payload.upload_ids)):
        raise HTTPException(status_code=404, detail="找不到之前上传的文件，请重新上传")
    topic_list = "\n".join(f"- key={topic.key}｜{topic.title}" for topic in payload.topics)
    keys = {topic.key for topic in payload.topics}
    questions: list[PastQuestion] = []
    for row in owned:
        source = Path(row.stored_path)
        work_dir = source.parent
        try:
            document = await asyncio.to_thread(prepare_visual_document, source, row.filename, work_dir, get_settings())
        except VisualProcessingError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        images = [part for part in document.content_parts]
        for start in range(0, max(len(images), 1), 40):  # up to 40 content parts per request
            content = [{"type": "text", "text": f"知识点列表：\n{topic_list}"}, *images[start:start + 40]]
            try:
                raw, _ = await AIProvider(settings).analyze_visual_materials(
                    content, system_prompt=PAPER_PROMPT + language_rule(reply_language(request)), max_tokens=6000
                )
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"AI 读试卷失败：{exc}") from exc
            for tag, attrs, text in parse_blocks(raw):
                if tag == "QUESTION" and text:
                    key = attrs.get("topic")
                    questions.append(PastQuestion(text=text[:2000], topic_key=key if key in keys else None))
    return PastPaperResponse(questions=questions)
