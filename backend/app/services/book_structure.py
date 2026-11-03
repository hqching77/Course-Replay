"""Find the chapters of course material without AI.

One textbook PDF, tried in order:
  1. the PDF's bookmarks (LaTeX + hyperref embeds the whole table of contents);
  2. the printed contents pages ("4.2 Eigenvalues ........ 213"), mapped to PDF pages;
  3. large headings ("Chapter 4", "第4章", "4 Title" in a much bigger font than the body).
Many files (1.1, 1.2 … 4.2): the numbers in the file names, else the first heading on page 1.

Everything here only reads PDFs (PyMuPDF), so a 600-page book takes seconds.
"""

from __future__ import annotations

import re
import statistics
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import fitz

_CN = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
NUM = r"[0-9]{1,3}|[零〇一二两三四五六七八九十百]{1,4}"


def to_number(text: str) -> int | None:
    """'12' → 12, '十二' → 12, '二十三' → 23."""
    text = text.strip()
    if text.isdigit():
        return int(text)
    total = current = 0
    for char in text:
        if char in _CN:
            current = _CN[char]
        elif char == "十":
            total += (current or 1) * 10
            current = 0
        elif char == "百":
            total += (current or 1) * 100
            current = 0
        else:
            return None
    return (total + current) or None


# Headings that open a chapter: "Chapter 4 …", "Lecture 4", "第4章 …", "第四讲 …", "4 Title" (not "4.2").
_CHAPTER_RE = re.compile(
    rf"^\s*(?:(?P<en>chapter|chap\.?|lecture|lec\.?)\s*(?P<en_n>{NUM})\b|第\s*(?P<cn_n>{NUM})\s*(?P<cn>[章讲])|(?P<bare_n>\d{{1,2}})(?![.\d]))"
    r"[\s.:：\-–—·]*(?P<rest>.*?)\s*$",
    re.I,
)
_PART_RE = re.compile(r"^\s*(part\s+[ivxlc0-9]+\b|第\s*[0-9一二三四五六七八九十]+\s*(部分|篇|编))", re.I)
_EXCLUDE = [
    ("preface", re.compile(r"^\s*(preface|foreword|introduction to the .*edition|前\s*言|序\s*言?|序$|写在前面)", re.I)),
    ("contents", re.compile(r"^\s*(contents|table of contents|list of (figures|tables|symbols)|目\s*录)", re.I)),
    ("index", re.compile(r"^\s*(index|subject index|索\s*引)", re.I)),
    ("references", re.compile(r"^\s*(bibliography|references|further reading|参考文献|参考书目)", re.I)),
    ("notation", re.compile(r"^\s*(notation|symbols|符号(表|说明)?)", re.I)),
    ("other", re.compile(r"^\s*(acknowledg|about the author|致\s*谢|后\s*记|版权)", re.I)),
]


def parse_chapter_title(title: str, allow_bare: bool = True) -> tuple[int | None, str, str]:
    """('Chapter 3: Determinants') → (3, 'Determinants', 'chapter'); 'lecture' for 讲/Lecture."""
    match = _CHAPTER_RE.match(title.replace(" ", " "))
    if not match:
        return None, title.strip(), "chapter"
    if match.group("bare_n") and not allow_bare:
        return None, title.strip(), "chapter"
    if match.group("bare_n") and not match.group("rest"):
        return None, title.strip(), "chapter"  # a lone page number, not a heading
    raw = match.group("en_n") or match.group("cn_n") or match.group("bare_n")
    word = (match.group("en") or match.group("cn") or "").lower()
    label = "lecture" if word.startswith("lec") or word == "讲" else "chapter"
    return to_number(raw), match.group("rest").strip(), label


def exclusion(title: str) -> str | None:
    for reason, pattern in _EXCLUDE:
        if pattern.match(title):
            return reason
    return None


@dataclass
class Part:
    file_index: int
    start: int  # 1-based, inclusive
    end: int

    @property
    def pages(self) -> int:
        return self.end - self.start + 1


@dataclass
class Chapter:
    number: int | None
    title: str
    parts: list[Part]
    label: str = "chapter"  # or "lecture"
    excluded: str | None = None  # why it is unticked by default
    files: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# One textbook PDF
# ---------------------------------------------------------------------------

def _from_bookmarks(doc: fitz.Document) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """(chapter entries, extra boundaries). Picks the bookmark level that holds the chapters."""
    toc = [(level, title.strip(), page) for level, title, page in doc.get_toc(simple=True) if page and page > 0]
    if not toc:
        return [], []
    for level in sorted({level for level, _, _ in toc})[:3]:
        entries = [(title, page) for lvl, title, page in toc if lvl == level]
        if len(entries) < 2:
            continue  # e.g. a single root bookmark with the book's title
        if sum(1 for title, _ in entries if _PART_RE.match(title)) * 2 >= len(entries):
            continue  # "Part I / Part II": chapters are one level down
        boundaries = [(title, page) for lvl, title, page in toc if lvl < level]
        return entries, boundaries
    return [], []


_CONTENTS_HEAD = re.compile(r"^\s*(contents|table of contents|目\s*录)\s*$", re.I)
_TOC_LINE = re.compile(r"^(?P<title>.*?\S)[\s.·…_]{2,}(?P<page>[0-9]{1,4}|[ivxlc]{1,6})\s*$", re.I)


def _contents_pages(doc: fitz.Document) -> list[int]:
    for index in range(min(30, len(doc))):
        lines = [line for line in doc[index].get_text("text").splitlines() if line.strip()]
        if any(_CONTENTS_HEAD.match(line) for line in lines[:8]):
            pages = [index]
            for follow in range(index + 1, min(index + 15, len(doc))):
                follow_lines = doc[follow].get_text("text").splitlines()
                if sum(1 for line in follow_lines if re.search(r"\d\s*$", line)) < 5:
                    break
                pages.append(follow)
            return pages
    return []


def _toc_lines(doc: fitz.Document, pages: list[int]) -> list[tuple[str, str]]:
    lines: list[str] = []
    for index in pages:
        lines.extend(line.strip() for line in doc[index].get_text("text").splitlines() if line.strip())
    entries: list[tuple[str, str]] = []
    skip = False
    for position, line in enumerate(lines):
        if skip:
            skip = False
            continue
        match = _TOC_LINE.match(line)
        if not match and position + 1 < len(lines) and re.fullmatch(r"[0-9]{1,4}", lines[position + 1]):
            match = _TOC_LINE.match(f"{line} .. {lines[position + 1]}")  # title and page number on separate lines
            skip = bool(match)
        if match:
            entries.append((match.group("title").strip(" .·…"), match.group("page")))
    return entries


def _page_for_label(doc: fitz.Document, after: int) -> dict[str, int]:
    labels: dict[str, int] = {}
    for index in range(len(doc)):
        label = doc[index].get_label()
        if label and label not in labels and index > after:
            labels[label] = index + 1
    return labels


def _find_title_page(doc: fitz.Document, title: str, start: int) -> int | None:
    needle = re.sub(r"\s+", "", title)[:14].lower()
    if len(needle) < 3:
        return None
    for index in range(start, len(doc)):
        page = doc[index]
        top = page.get_text("text", clip=fitz.Rect(0, 0, page.rect.width, page.rect.height * 0.5))
        if needle in re.sub(r"\s+", "", top).lower():
            return index + 1
    return None


def _from_contents(doc: fitz.Document) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    pages = _contents_pages(doc)
    if not pages:
        return [], []
    raw = _toc_lines(doc, pages)
    chapters = [(title, page) for title, page in raw if parse_chapter_title(title)[0] is not None and page.isdigit()]
    others = [(title, page) for title, page in raw if exclusion(title) and page.isdigit()]
    if len(chapters) < 2:
        return [], []
    labels = _page_for_label(doc, pages[-1])
    if any(label.isdigit() for label in labels):
        resolve = lambda printed: labels.get(printed)  # noqa: E731 - PDF page labels match the printed numbers
    else:
        offsets = Counter()
        for title, printed in chapters[:4]:
            found = _find_title_page(doc, parse_chapter_title(title)[1] or title, pages[-1] + 1)
            if found:
                offsets[found - int(printed)] += 1
        offset = offsets.most_common(1)[0][0] if offsets else 0
        resolve = lambda printed: int(printed) + offset  # noqa: E731
    def located(entries: list[tuple[str, str]]) -> list[tuple[str, int]]:
        result = []
        for title, printed in entries:
            page = resolve(printed)
            if page and 1 <= page <= len(doc):
                result.append((title, page))
        return result
    return located(chapters), located(others)


def _body_size(doc: fitz.Document) -> float:
    sizes: list[float] = []
    step = max(1, len(doc) // 25)
    for index in range(0, len(doc), step):
        for block in doc[index].get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    if span["text"].strip():
                        sizes.extend([round(span["size"], 1)] * min(len(span["text"]), 40))
    return statistics.median(sizes) if sizes else 10.0


def _from_headings(doc: fitz.Document) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    body = _body_size(doc)
    found: list[tuple[str, int]] = []
    others: list[tuple[str, int]] = []
    seen: set[int] = set()
    for index in range(len(doc)):
        page = doc[index]
        top = fitz.Rect(0, 0, page.rect.width, page.rect.height * 0.45)
        big: list[str] = []
        for block in page.get_text("dict", clip=top)["blocks"]:
            for line in block.get("lines", []):
                text = "".join(span["text"] for span in line["spans"]).strip()
                size = max((span["size"] for span in line["spans"] if span["text"].strip()), default=0)
                if text and size >= body * 1.45:
                    big.append(text)
        if not big:
            continue
        number, rest, _ = parse_chapter_title(big[0])
        if number is not None and number not in seen:
            # "Chapter 4" on one line, the title on the next large line.
            title = big[0] if rest else f"{big[0]} {big[1]}" if len(big) > 1 else big[0]
            found.append((title, index + 1))
            seen.add(number)
        elif exclusion(big[0]):
            others.append((big[0], index + 1))
    return found, others


def analyze_book(path: Path) -> tuple[str, list[Chapter], int]:
    """(method, chapters incl. excluded items, page count) for one textbook PDF."""
    with fitz.open(path) as doc:
        total = len(doc)
        method, entries, extra = "manual", [], []
        for name, finder in (("bookmarks", _from_bookmarks), ("contents", _from_contents), ("headings", _from_headings)):
            entries, extra = finder(doc)
            if len(entries) >= 2:
                method = name
                break
        if method == "manual":
            return method, [Chapter(number=None, title=path.stem, parts=[Part(0, 1, total)])], total

    starts = sorted({page for _, page in entries} | {page for _, page in extra})
    def end_of(page: int) -> int:
        later = [start for start in starts if start > page]
        return (later[0] - 1) if later else total

    chapters: list[Chapter] = []
    first = min(page for _, page in entries)
    lead = min([first] + [page for _, page in extra])
    if lead > 1:
        chapters.append(Chapter(number=None, title="", parts=[Part(0, 1, lead - 1)], excluded="front"))
    items = [(title, page, False) for title, page in entries] + [(title, page, True) for title, page in extra if exclusion(title)]
    for title, page, extra_item in sorted(items, key=lambda item: item[1]):
        reason = exclusion(title)
        number, rest, label = parse_chapter_title(title) if not reason else (None, title, "chapter")
        if extra_item and not reason:
            continue
        chapters.append(Chapter(
            number=number, title=rest if number is not None else title, label=label,
            parts=[Part(0, page, max(page, end_of(page)))], excluded=reason,
        ))
    return method, chapters, total


# ---------------------------------------------------------------------------
# Many files: 1.1, 1.2 … 4.2
# ---------------------------------------------------------------------------

_DATE = re.compile(r"(19|20)\d{2}[-_.年]\d{1,2}[-_.月]\d{1,2}日?")
_FILE_PATTERNS = [
    (re.compile(rf"第\s*({NUM})\s*章(?:\s*第?\s*({NUM})\s*节)?"), "chapter"),
    (re.compile(rf"第\s*({NUM})\s*讲()"), "lecture"),
    (re.compile(r"(?<![\d.])(\d{1,2})\s*[._\-]\s*(\d{1,2})(?!\d)"), "chapter"),
    (re.compile(rf"(?:chapter|chap|ch)\s*[_\-\s]?({NUM})()(?!\d)", re.I), "chapter"),
    (re.compile(rf"(?:lecture|lec)\s*[_\-\s]?({NUM})()(?!\d)", re.I), "lecture"),
    (re.compile(r"^(\d{1,2})()(?![\d.])"), "chapter"),
]


def number_from_name(name: str) -> tuple[int | None, int, str]:
    """'LA_4.2.pdf' → (4, 2, 'chapter'); '第5讲_xx.pdf' → (5, 0, 'lecture'); no number → (None, 0, ...)."""
    # Only drop a real extension: for a heading like "1.2 Linear Combinations", Path().stem would give "1".
    stem = _DATE.sub(" ", Path(name).stem if re.search(r"\.[A-Za-z][A-Za-z0-9]{0,4}$", name) else name)
    for pattern, label in _FILE_PATTERNS:
        match = pattern.search(stem)
        if match:
            chapter = to_number(match.group(1))
            section = to_number(match.group(2)) if match.lastindex and match.lastindex >= 2 and match.group(2) else 0
            if chapter is not None:
                return chapter, section or 0, label
    return None, 0, "chapter"


def _first_heading(path: Path) -> str:
    try:
        with fitz.open(path) as doc:
            if not len(doc):
                return ""
            page = doc[0]
            lines = [line.strip() for line in page.get_text("text", clip=fitz.Rect(0, 0, page.rect.width, page.rect.height * 0.35)).splitlines()]
            return next((line for line in lines if line), "")
    except Exception:
        return ""


def first_page_title(path: Path) -> str:
    """What page 1 says it is: the largest text in its top half (to recognise files with meaningless names)."""
    if path.suffix.lower() != ".pdf":
        return ""
    try:
        with fitz.open(path) as doc:
            if not len(doc):
                return ""
            page = doc[0]
            clip = fitz.Rect(0, 0, page.rect.width, page.rect.height * 0.6)
            lines: list[tuple[float, float, str]] = []
            for block in page.get_text("dict", clip=clip).get("blocks", []):
                for line in block.get("lines", []):
                    spans = [span for span in line.get("spans", []) if span.get("text", "").strip()]
                    if not spans:
                        continue
                    text = re.sub(r"\s+", " ", "".join(span["text"] for span in spans)).strip()
                    if len(text) >= 2:
                        lines.append((max(span["size"] for span in spans), line["bbox"][1], text))
            if not lines:
                return ""
            biggest = max(size for size, _, _ in lines)
            # Titles often wrap: join the lines set in the largest size, top to bottom.
            title = " ".join(text for size, _, text in sorted(lines, key=lambda item: item[1]) if size >= biggest - 0.5)
            return title[:120]
    except Exception:
        return ""


def pdf_pages(path: Path) -> int | None:
    if path.suffix.lower() != ".pdf":
        return None
    try:
        with fitz.open(path) as doc:
            return len(doc)
    except Exception:
        return None


def analyze_files(files: list[tuple[str, Path]]) -> list[Chapter]:
    """Group files by chapter number from their names (or the first heading); sorted numerically."""
    keyed: list[tuple[int | None, int, str, int, str]] = []
    for index, (name, path) in enumerate(files):
        chapter, section, label = number_from_name(name)
        if chapter is None and path.suffix.lower() == ".pdf":
            # Meaningless name: use what page 1 says — its title (largest text), then its first line.
            for heading in dict.fromkeys(filter(None, (first_page_title(path), _first_heading(path)))):
                chapter, section, label = number_from_name(heading)
                if chapter is None:
                    chapter, _, label = parse_chapter_title(heading, allow_bare=False)
                if chapter is not None:
                    break
        keyed.append((chapter, section, label, index, name))

    chapters: dict[int, Chapter] = {}
    loose: list[Chapter] = []
    for chapter, section, label, index, name in sorted(keyed, key=lambda item: (item[0] is None, item[0] or 0, item[1], item[4])):
        pages = pdf_pages(files[index][1]) or 0
        part = Part(index, 1, pages)
        if chapter is None:
            loose.append(Chapter(number=None, title=Path(name).stem, parts=[part], files=[name]))
            continue
        group = chapters.setdefault(chapter, Chapter(number=chapter, title="", parts=[], label=label))
        group.parts.append(part)
        group.files.append(name)
    for number, group in chapters.items():
        # A chapter title from the first file's first page, e.g. "Chapter 1 Vectors" / "第一章 向量".
        first_path = files[group.parts[0].file_index][1]
        found, rest, _ = parse_chapter_title(_first_heading(first_path), allow_bare=False) if first_path.suffix.lower() == ".pdf" else (None, "", "")
        if found == number and rest:
            group.title = rest
    return [chapters[number] for number in sorted(chapters)] + loose
