from __future__ import annotations

import json
import re
from typing import Any

from app.schemas import AnalysisKnowledgeNode, CourseMaterialAnalysis
from app.services.ai_provider import AIProvider
from app.services.visual_processor import PreparedVisualDocument


# The knowledge-map body is LaTeX-heavy, and escaping backslashes inside JSON is
# error-prone (\frac, \times, \begin break json.loads). So the model returns a
# delimited plain-text format where each node's Markdown body is raw — no
# escaping needed — and only the lightweight fields are JSON.
SYSTEM_PROMPT = """你是 Course Replay 的课程讲师与材料分析器。你会看到用户上传的课堂材料原文或逐页图片。
直接阅读视觉内容，不要声称使用 OCR。只根据提供的材料讲授，材料没覆盖的不要编造。

核心任务：把材料拆成一张**分层知识图**，并以**讲师视角**把每个知识点讲透——不是罗列概念，而是像上课一样有条理、循序渐进地讲解，并配例子。

严格按下面的纯文本格式输出（不要加 Markdown 代码块、不要有多余说明）：

@@META
{"title":"4-20字标题","summary":"80-180字课程概览","learning_path":["4-8个步骤,每项8-24字"],"key_concepts":["5-10个概念名"],"review_questions":["3-5个问题,每题≤60字"]}
@@NODE
tier: prereq
title: 纯文本节点标题（不含公式或反引号）
summary: 一句话副标题（纯文本，≤24字）
@@BODY
## 纯文本节点标题

<这里是该知识点完整的 Markdown 讲解正文，可多段多行>
@@NODE
tier: core
title: ...
summary: ...
@@BODY
## ...

...
@@END

格式说明：
- @@META 后紧跟一行**合法 JSON**，只含轻量字段；JSON 里不要放公式或反斜杠。
- 每个知识点一个 @@NODE 块：先 tier/title/summary 三行头，再单独一行 @@BODY，然后是正文。
- 全部节点后以单独一行 @@END 结束。

knowledge_map（@@NODE 列表）要求（最重要）：
- 分三层并保持讲课顺序：tier 取 prereq（前置/引理/基础）、core（核心，按讲授逻辑排序）、advanced（进阶/应用/推广）。通常 6-10 个节点。
- 每个节点正文必须**充实完整**（约 250-500 字），包含：
  1) 概念讲解：是什么、为什么、直觉，循序渐进；
  2) **至少一个具体例子**，带推导或计算步骤；
  3) 如适用，给出解这一类题的**方法模板/思路**（举一反三）；
  4) 一道**配套练习题**（可附简要提示）。
- 用 ### 小标题分段，善用列表、表格、必要时代码块。
- 正文以 "## <节点标题>" 开头。
- 所有数学公式用 LaTeX：行内 $...$，独立公式 $$...$$，**正文里直接写反斜杠**（如 \\frac、\\sum、\\begin{cases}），无需转义。
- 源码文件名/命令/标识符用反引号 `code`。
- title 与 summary 必须是纯文本，公式只放正文。

默认使用简体中文。"""

VALID_TIERS = {"prereq", "core", "advanced"}


def _compact_label(value: str, limit: int) -> str:
    clean = re.sub(r"\s+", " ", value).strip()
    clean = re.sub(r"^(?:第?\d+[.、)）:]|[-*•])\s*", "", clean)
    head = re.split(r"[：:。；;]", clean, maxsplit=1)[0].strip()
    candidate = head if len(head) >= 2 else clean
    return candidate if len(candidate) <= limit else f"{candidate[:limit].rstrip()}…"


def _plain(value: str, limit: int) -> str:
    clean = re.sub(r"\s+", " ", str(value or "")).strip()
    return clean if len(clean) <= limit else f"{clean[:limit].rstrip()}…"


def _normalize_nodes(nodes: list[AnalysisKnowledgeNode]) -> list[AnalysisKnowledgeNode]:
    normalized: list[AnalysisKnowledgeNode] = []
    for index, node in enumerate(nodes):
        content = (node.content or "").strip()
        if not content:
            continue
        tier = node.tier if node.tier in VALID_TIERS else "core"
        title = _plain(node.title, 40) or f"知识点 {index + 1}"
        normalized.append(AnalysisKnowledgeNode(
            id=node.id or f"kn-{index + 1}",
            title=title,
            tier=tier,
            summary=_plain(node.summary, 40),
            content=content,
        ))
    return normalized


def _normalize_analysis(analysis: CourseMaterialAnalysis) -> CourseMaterialAnalysis:
    summary = re.sub(r"\s+", " ", analysis.summary).strip()
    return analysis.model_copy(update={
        "title": _compact_label(analysis.title, 24),
        "summary": summary if len(summary) <= 600 else f"{summary[:600].rstrip()}…",
        "learning_path": [_compact_label(item, 36) for item in analysis.learning_path[:8]],
        "key_concepts": [_compact_label(item, 18) for item in analysis.key_concepts[:10]],
        "review_questions": [re.sub(r"\s+", " ", item).strip()[:100] for item in analysis.review_questions[:6]],
        "knowledge_map": _normalize_nodes(analysis.knowledge_map)[:12],
    })


def _parse_node_block(block: str) -> AnalysisKnowledgeNode | None:
    head, sep, body = block.partition("@@BODY")
    if not sep:
        return None
    tier, title, summary = "core", "", ""
    for line in head.strip().splitlines():
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "tier":
            tier = value
        elif key == "title":
            title = value
        elif key == "summary":
            summary = value
    content = body.strip()
    if not content:
        return None
    return AnalysisKnowledgeNode(title=title, tier=tier, summary=summary, content=content)


def _parse_delimited(text: str) -> CourseMaterialAnalysis | None:
    if "@@NODE" not in text and "@@META" not in text:
        return None
    meta: dict[str, Any] = {}
    meta_match = re.search(r"@@META\s*\n(.*?)(?=\n@@NODE|\n@@END|\Z)", text, re.S)
    if meta_match:
        try:
            meta = json.loads(meta_match.group(1).strip())
        except json.JSONDecodeError:
            meta = {}
    nodes: list[AnalysisKnowledgeNode] = []
    body = re.split(r"\n@@END\b", text, maxsplit=1)[0]
    for raw_block in re.split(r"\n@@NODE\s*\n", body)[1:]:
        node = _parse_node_block(raw_block)
        if node:
            nodes.append(node)
    if not meta and not nodes:
        return None
    return CourseMaterialAnalysis(
        title=str(meta.get("title") or "课堂材料分析"),
        summary=str(meta.get("summary") or (nodes[0].summary if nodes else "")),
        learning_path=[str(item) for item in (meta.get("learning_path") or [])],
        key_concepts=[str(item) for item in (meta.get("key_concepts") or [])],
        review_questions=[str(item) for item in (meta.get("review_questions") or [])],
        knowledge_map=nodes,
    )


def _repair_json(text: str) -> str:
    return re.sub(r'\\(?![\\/"bfnrtu])', r'\\\\', text)


def _parse_json(text: str) -> CourseMaterialAnalysis | None:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        return None
    cleaned = cleaned[start:end + 1]
    for candidate in (cleaned, _repair_json(cleaned)):
        try:
            return CourseMaterialAnalysis.model_validate(json.loads(candidate))
        except (json.JSONDecodeError, ValueError):
            continue
    return None


def _parse_analysis(content: str) -> CourseMaterialAnalysis:
    parsed = _parse_delimited(content) or _parse_json(content)
    if parsed is not None:
        return _normalize_analysis(parsed)
    return CourseMaterialAnalysis(summary=content, raw=content)


async def analyze_materials(
    documents: list[PreparedVisualDocument],
    provider: AIProvider,
) -> tuple[CourseMaterialAnalysis, dict[str, Any] | None]:
    content: list[dict[str, Any]] = [{
        "type": "text",
        "text": "请完整分析下面所有课堂材料，像讲师一样把每个知识点讲透（含例子），并组合成一条连贯的分层学习路径。",
    }]
    for document in documents:
        content.extend(document.content_parts)
    raw, usage = await provider.analyze_visual_materials(content, system_prompt=SYSTEM_PROMPT, max_tokens=8000)
    return _parse_analysis(raw), usage
