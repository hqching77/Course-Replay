from __future__ import annotations

import json
import re
from typing import Any

from app.schemas import CourseMaterialAnalysis
from app.services.ai_provider import AIProvider
from app.services.visual_processor import PreparedVisualDocument


SYSTEM_PROMPT = """你是 Course Replay 的课程材料分析器。你会看到用户上传的课堂材料原文或逐页图片。
直接阅读视觉内容，不要声称使用 OCR。只根据提供的材料生成结果，不足之处明确说明。
这是学习产品的界面数据，不是论文。必须简洁、易扫读，禁止把长段落塞进数组项。
只返回 JSON，不要使用 Markdown 代码块：
{
  "title": "4-20字的课程或章节标题",
  "summary": "80-180字的一段课程概览，只写学习者最需要知道的内容",
  "learning_path": ["4-6个步骤；每项8-24字；只写动作和主题，不编号、不加解释段落"],
  "key_concepts": ["5-8个概念；每项2-14字；只写概念名称，不附定义"],
  "review_questions": ["3-5个用于检验理解的问题；每题不超过60字"]
}
默认使用简体中文。"""


def _compact_label(value: str, limit: int) -> str:
    clean = re.sub(r"\s+", " ", value).strip()
    clean = re.sub(r"^(?:第?\d+[.、)）:]|[-*•])\s*", "", clean)
    head = re.split(r"[：:。；;]", clean, maxsplit=1)[0].strip()
    candidate = head if len(head) >= 2 else clean
    return candidate if len(candidate) <= limit else f"{candidate[:limit].rstrip()}…"


def _normalize_analysis(analysis: CourseMaterialAnalysis) -> CourseMaterialAnalysis:
    summary = re.sub(r"\s+", " ", analysis.summary).strip()
    return analysis.model_copy(update={
        "title": _compact_label(analysis.title, 24),
        "summary": summary if len(summary) <= 600 else f"{summary[:600].rstrip()}…",
        "learning_path": [_compact_label(item, 36) for item in analysis.learning_path[:8]],
        "key_concepts": [_compact_label(item, 18) for item in analysis.key_concepts[:10]],
        "review_questions": [re.sub(r"\s+", " ", item).strip()[:100] for item in analysis.review_questions[:6]],
    })


def _parse_analysis(content: str) -> CourseMaterialAnalysis:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return _normalize_analysis(CourseMaterialAnalysis.model_validate(json.loads(cleaned)))
    except (json.JSONDecodeError, ValueError):
        return CourseMaterialAnalysis(summary=content, raw=content)


async def analyze_materials(
    documents: list[PreparedVisualDocument],
    provider: AIProvider,
) -> tuple[CourseMaterialAnalysis, dict[str, Any] | None]:
    content: list[dict[str, Any]] = [{
        "type": "text",
        "text": "请完整分析下面所有课堂材料，并组合成一条连贯的课程学习路径。",
    }]
    for document in documents:
        content.extend(document.content_parts)
    raw, usage = await provider.analyze_visual_materials(content, system_prompt=SYSTEM_PROMPT)
    return _parse_analysis(raw), usage
