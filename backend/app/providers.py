"""Which AI / speech-to-text provider a request should use, and in which language to reply.

By default everything uses the server's .env configuration. A user can pick
their own OpenAI-compatible provider in 设置; the browser then sends it with
each AI request in headers (the key stays in that browser, never in our DB):

    X-AI-Base-URL / X-AI-Model / X-AI-Key      chat + material analysis
    X-STT-Base-URL / X-STT-Model / X-STT-Key   speech-to-text
    X-UI-Language: zh | en                      language for AI output
"""

from __future__ import annotations

import ipaddress
import re
import socket
import time
from dataclasses import dataclass
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI

from app.config import Settings, get_settings


def _header(request: Request, name: str, limit: int = 300) -> str:
    return (request.headers.get(name) or "").strip()[:limit]


def validate_provider_url(url: str, settings: Settings) -> str:
    """Reject custom base URLs that would make the server call itself or its private network."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="自定义接口地址必须以 http:// 或 https:// 开头")
    if settings.allow_private_provider_urls:
        return url.rstrip("/")
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="自定义接口地址必须使用 https://")
    try:
        addresses = [ipaddress.ip_address(parsed.hostname)]
    except ValueError:
        try:
            infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise HTTPException(status_code=400, detail=f"无法解析接口地址：{parsed.hostname}") from exc
        addresses = [ipaddress.ip_address(info[4][0]) for info in infos]
    if any(not address.is_global for address in addresses):
        raise HTTPException(status_code=400, detail="自定义接口地址不能指向内网或本机")
    return url.rstrip("/")


def effective_settings(request: Request) -> Settings:
    """Server settings, with the chat provider swapped for the user's own if they sent one."""
    settings = get_settings()
    key = _header(request, "X-AI-Key", 500)
    if not key:
        return settings
    if not settings.allow_custom_providers:
        raise HTTPException(status_code=403, detail="服务器未开放自定义 AI 接口")
    base_url = _header(request, "X-AI-Base-URL") or settings.openai_base_url
    if base_url.rstrip("/") != settings.openai_base_url.rstrip("/"):
        base_url = validate_provider_url(base_url, settings)
    model = _header(request, "X-AI-Model", 200) or settings.openai_chat_model
    return settings.model_copy(update={"openai_api_key": key, "openai_base_url": base_url, "openai_chat_model": model})


@dataclass
class SttConfig:
    base_url: str
    api_key: str
    model: str
    source: str  # "server" | "custom"

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


def stt_config(request: Request) -> SttConfig:
    settings = get_settings()
    key = _header(request, "X-STT-Key", 500)
    if not key:
        return SttConfig(settings.stt_base_url.rstrip("/"), settings.stt_api_key, settings.stt_model, "server")
    if not settings.allow_custom_providers:
        raise HTTPException(status_code=403, detail="服务器未开放自定义语音识别接口")
    base_url = _header(request, "X-STT-Base-URL") or settings.stt_base_url
    if base_url.rstrip("/") != settings.stt_base_url.rstrip("/"):
        base_url = validate_provider_url(base_url, settings)
    model = _header(request, "X-STT-Model", 200) or settings.stt_model
    return SttConfig(base_url.rstrip("/"), key, model, "custom")


def reply_language(request: Request) -> str:
    return "en" if _header(request, "X-UI-Language", 10).lower().startswith("en") else "zh"


def language_rule(language: str) -> str:
    """Appended to prompts so AI output follows the UI language."""
    if language == "en":
        return "\n\nIMPORTANT: Write every part of your reply in English, even if the course material is in Chinese."
    return "\n\n默认使用简体中文。"


# ---------------------------------------------------------------------------
# Speech-to-text
# ---------------------------------------------------------------------------

_SENSEVOICE_TAG = re.compile(r"<\|[^|>]*\|>")
# Whisper-family models hallucinate these on silence or noise.
_HALLUCINATIONS = {
    "谢谢观看", "谢谢大家", "谢谢收看", "字幕由amara.org社区提供", "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
    "thank you.", "thanks for watching!", "thank you for watching.", "you",
}


def clean_transcript(text: str) -> str:
    text = _SENSEVOICE_TAG.sub("", text or "").strip()
    if text.lower().strip(" 。.!！") in {item.strip(" 。.!！") for item in _HALLUCINATIONS}:
        return ""
    return text


def _supports_whisper_params(model: str) -> bool:
    lowered = model.lower()
    return "whisper" in lowered or "transcribe" in lowered


async def transcribe_audio(
    config: SttConfig,
    audio: bytes,
    filename: str,
    content_type: str,
    *,
    language: str | None = None,
    prompt: str | None = None,
) -> tuple[str, int]:
    """Return (text, latency_ms). Raises RuntimeError with a readable message on failure."""
    client = AsyncOpenAI(api_key=config.api_key, base_url=config.base_url, timeout=60.0, max_retries=1)
    extra: dict[str, str] = {}
    # Only Whisper-style models document language/prompt; others (e.g. SenseVoice) auto-detect.
    if _supports_whisper_params(config.model):
        if language in {"zh", "en"}:
            extra["language"] = language
        if prompt:
            extra["prompt"] = prompt[-200:]
    started = time.perf_counter()
    try:
        result = await client.audio.transcriptions.create(
            model=config.model,
            file=(filename, audio, content_type),
            **extra,  # type: ignore[arg-type]
        )
    except APITimeoutError as exc:
        raise RuntimeError("语音识别接口超时") from exc
    except APIConnectionError as exc:
        raise RuntimeError(f"无法连接语音识别接口：{exc.__cause__ or exc}") from exc
    except APIStatusError as exc:
        raise RuntimeError(f"语音识别接口返回 HTTP {exc.status_code}：{exc.message}") from exc
    latency = round((time.perf_counter() - started) * 1000)
    text = getattr(result, "text", None) if not isinstance(result, str) else result
    return clean_transcript(str(text or "")), latency
