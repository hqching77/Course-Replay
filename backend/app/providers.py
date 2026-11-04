"""Which AI / speech-to-text provider a request should use, and in which language to reply.

By default everything uses the provider configured on the server. A user can pick
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


NOT_AN_API = "这个接口地址返回的是网页，不是 API：请检查接口地址（通常以 /v1 结尾），并确认这家服务提供这项功能"


def looks_like_webpage(text: str) -> bool:
    """Some gateways answer unknown paths with their website (HTTP 200) instead of an error."""
    head = text.lstrip()[:200].lower()
    return head.startswith("<!doctype html") or head.startswith("<html") or "<head>" in head


def chat_audio_model(model: str) -> bool:
    """Chat models that take audio as input (no /audio/transcriptions endpoint): transcribe via chat."""
    lowered = model.lower()
    return any(word in lowered for word in ("gemini", "omni", "audio-preview", "gpt-audio"))


CHAT_TRANSCRIBE_PROMPT = (
    "Transcribe this audio verbatim, in the language that is spoken. Output only the transcript text: "
    "no quotes, no explanations, no timestamps. If nobody is speaking, output nothing."
)


def _supports_whisper_params(model: str) -> bool:
    lowered = model.lower()
    return "whisper" in lowered or "transcribe" in lowered


def api_error_detail(exc: APIStatusError) -> str:
    """The provider's own message ("Invalid token"), without the SDK's "Error code: 401 - {...}" wrapper."""
    body = exc.body
    if isinstance(body, dict):
        inner = body.get("error")
        message = body.get("message") or (inner.get("message") if isinstance(inner, dict) else inner)
        if isinstance(message, str) and message.strip():
            return message.strip()[:300]
    return re.sub(r"^Error code: \d+ - ", "", str(exc.message or "")).strip()[:300] or "未知错误"


def stt_error_hint(status: int, base_url: str) -> str:
    """What usually causes this error, so the user knows what to fix."""
    siliconflow_cn = "siliconflow.cn" in base_url
    if status == 401:
        return ("Key 无效：确认复制完整；如果是在 cloud.siliconflow.com（国际版）注册的 Key，接口地址要用 https://api.siliconflow.com/v1"
                if siliconflow_cn else "Key 无效或已过期，请在服务商后台重新生成")
    if status == 403:
        return "这个账号不能用该模型：去服务商后台确认已完成实名认证、模型已开通"
    if status in (400, 404):
        return "接口地址或模型名不对：硅基流动的模型名是 FunAudioLLM/SenseVoiceSmall，地址以 /v1 结尾"
    if status == 429:
        return "请求太频繁或额度已用完，稍后会自动重试"
    if status >= 500:
        return "服务商暂时故障，稍后会自动重试"
    return ""


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
        if chat_audio_model(config.model):
            text = await _transcribe_with_chat(client, config.model, audio, filename, prompt)
            return clean_transcript(text), round((time.perf_counter() - started) * 1000)
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
        hint = stt_error_hint(exc.status_code, config.base_url)
        raise RuntimeError(f"语音识别接口返回 HTTP {exc.status_code}：{api_error_detail(exc)}" + (f"。{hint}" if hint else "")) from exc
    latency = round((time.perf_counter() - started) * 1000)
    text = getattr(result, "text", None) if not isinstance(result, str) else result
    if looks_like_webpage(str(text or "")):
        raise RuntimeError(NOT_AN_API)
    return clean_transcript(str(text or "")), latency


async def _transcribe_with_chat(client: AsyncOpenAI, model: str, audio: bytes, filename: str, prompt: str | None) -> str:
    import base64

    audio_format = "mp3" if filename.lower().endswith(".mp3") else "wav"
    instruction = CHAT_TRANSCRIBE_PROMPT + (f" Context (what was said just before): {prompt[-200:]}" if prompt else "")
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": instruction},
            {"type": "input_audio", "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": audio_format}},
        ]}],  # type: ignore[list-item]
        temperature=0,
    )
    if isinstance(response, str):
        raise RuntimeError(NOT_AN_API if looks_like_webpage(response) else "语音识别接口返回的格式不对")
    return (response.choices[0].message.content or "").strip()
