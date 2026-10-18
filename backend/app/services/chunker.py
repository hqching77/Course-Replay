import hashlib
from dataclasses import dataclass


@dataclass(slots=True)
class ExtractedSection:
    text: str
    page: int | None = None
    slide: int | None = None
    section: str | None = None


@dataclass(slots=True)
class ChunkData:
    text: str
    page: int | None
    slide: int | None
    section: str | None
    source_location: str
    text_hash: str


def chunk_sections(
    sections: list[ExtractedSection],
    *,
    target_chars: int = 2000,
    overlap_chars: int = 200,
) -> list[ChunkData]:
    chunks: list[ChunkData] = []
    for section in sections:
        clean_text = "\n".join(line.strip() for line in section.text.splitlines() if line.strip())
        if not clean_text:
            continue

        start = 0
        while start < len(clean_text):
            end = min(start + target_chars, len(clean_text))
            text = clean_text[start:end].strip()
            if text:
                if section.page is not None:
                    location = f"Page {section.page}"
                elif section.slide is not None:
                    location = f"Slide {section.slide}"
                elif section.section:
                    location = section.section
                else:
                    location = "Document"
                chunks.append(
                    ChunkData(
                        text=text,
                        page=section.page,
                        slide=section.slide,
                        section=section.section,
                        source_location=location,
                        text_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                    )
                )
            if end == len(clean_text):
                break
            start = max(end - overlap_chars, start + 1)
    return chunks
