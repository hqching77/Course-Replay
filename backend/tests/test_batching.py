import asyncio

import fitz

from app.config import get_settings
from app.services.material_analyzer import DIGEST_PROMPT, SYSTEM_PROMPT, analyze_materials
from app.services.visual_processor import prepare_visual_document

ANALYSIS = """@@META
{"title":"C++ 多态","summary":"讲稿","learning_path":["接口"],"key_concepts":["虚函数"],"review_questions":["什么是多态？"]}
@@NODE
tier: core
title: 虚函数
summary: 动态绑定
@@BODY
## 虚函数

正文
@@END"""


class FakeProvider:
    def __init__(self):
        self.calls = []

    async def analyze_visual_materials(self, content, *, system_prompt, max_tokens=8000):
        images = sum(1 for part in content if part.get("type") == "image_url")
        self.calls.append({"prompt": system_prompt, "images": images, "content": content})
        if system_prompt == DIGEST_PROMPT:
            return f"### 笔记（{images} 页）", {"prompt_tokens": 10 * images, "completion_tokens": 5}
        return ANALYSIS, {"prompt_tokens": 7, "completion_tokens": 3}


def make_pdf(path, pages):
    document = fitz.open()
    for number in range(1, pages + 1):
        page = document.new_page()
        page.insert_text((72, 72), f"Page {number}")
    document.save(path)
    document.close()


def test_long_pdf_has_no_page_limit_and_is_read_in_batches(tmp_path):
    source = tmp_path / "lecture.pdf"
    make_pdf(source, 44)
    document = prepare_visual_document(source, "第5讲.pdf", tmp_path, get_settings())
    assert document.pages == 44

    provider = FakeProvider()
    progress = []
    analysis, usage = asyncio.run(analyze_materials(
        [document], provider, transcript="老师讲了虚函数",
        max_pages_per_request=40, pages_per_batch=20, on_progress=lambda done, total: progress.append((done, total)),
    ))

    digests = [call for call in provider.calls if call["prompt"] == DIGEST_PROMPT]
    final = [call for call in provider.calls if call["prompt"] == SYSTEM_PROMPT]
    assert sorted(call["images"] for call in digests) == [4, 20, 20]
    assert len(final) == 1 and final[0]["images"] == 0
    final_text = "\n".join(part["text"] for part in final[0]["content"])
    assert "老师讲了虚函数" in final_text and final_text.count("### 笔记") == 3
    assert "《第5讲.pdf》第 44 / 44 页" in "\n".join(
        part.get("text", "") for call in digests for part in call["content"]
    )
    assert progress[0] == (0, 3) and progress[-1] == (3, 3)
    assert usage == {"prompt_tokens": 447, "completion_tokens": 18}
    assert analysis.title == "C++ 多态"


def test_short_material_is_still_one_request(tmp_path):
    source = tmp_path / "short.pdf"
    make_pdf(source, 12)
    document = prepare_visual_document(source, "short.pdf", tmp_path, get_settings())
    provider = FakeProvider()
    asyncio.run(analyze_materials([document], provider))
    assert [(call["prompt"] == SYSTEM_PROMPT, call["images"]) for call in provider.calls] == [(True, 12)]
