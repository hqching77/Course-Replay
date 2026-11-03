"""知识档案: what the student already knows or finds hard, across all their courses.

The browser builds it from the student's own records and sends it with AI requests; it is
only used inside the prompt and never stored here.
"""

from __future__ import annotations

MAX_MEMORY_CHARS = 4000

_USE = {
    "tutor": (
        "讲解时把新内容和他已经掌握的知识联系起来（例如“这和你在《线性代数》里学过的矩阵乘法是同一回事”），"
        "他已经掌握的基础一句带过、不要从头讲；碰到他的薄弱点就多解释一步、换个角度讲。"
    ),
    "notes": (
        "写讲稿时：如果材料用到他在其他课程已经掌握的知识，简短回顾并点明联系（例如“这里的二维数组就是你在《线性代数》学过的矩阵”），"
        "不要当成全新内容从零讲；涉及他的薄弱点时讲得更细。讲稿仍然要完整覆盖材料。"
    ),
    "practice": (
        "出题时针对他的薄弱点和错因；可以把他在其他课程已经掌握的知识当作已知条件，不要出他早已掌握的基础题。"
    ),
}


def learner_note(memory: str | None, purpose: str = "tutor") -> str:
    """Prompt text for the student's knowledge record, or '' when there is none."""
    # Form fields arrive with CRLF line breaks (browsers normalise them); prompts use \n.
    text = (memory or "").replace("\r\n", "\n").strip()[:MAX_MEMORY_CHARS]
    if not text:
        return ""
    return (
        "\n\n【学生的知识档案】来自他在本应用所有课程里的答题、诊断和阅读记录（可能不完整，只作参考）：\n"
        f"{text}\n"
        f"使用方式：{_USE.get(purpose, _USE['tutor'])}"
        "不要逐条复述这份档案，也不要声称知道档案以外的事；档案和他眼前的问题无关时就忽略它。"
    )
