from __future__ import annotations

import json
from typing import Any

from app.schemas import CourseMaterialAnalysis
from app.services.ai_provider import AIProvider
from app.services.visual_processor import PreparedVisualDocument


SYSTEM_PROMPT = """你是 Course Replay 的课程材料分析器。你会看到用户上传的课堂材料原文或逐页图片。
直接阅读视觉内容，不要声称使用 OCR。只根据提供的材料生成结果，不足之处明确说明。
只返回 JSON，不要使用 Markdown 代码块：
{
  "title": "课程或章节标题",
  "summary": "一段具体的材料总结",
  "learning_path": ["按依赖顺序排列的学习步骤，共 4-8 项"],
  "key_concepts": ["核心概念及一句解释，共 5-10 项"],
  "review_questions": ["用于检验理解的问题，共 3-6 项"]
}
默认使用简体中文。"""


def _parse_analysis(content: str) -> CourseMaterialAnalysis:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return CourseMaterialAnalysis.model_validate(json.loads(cleaned))
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
