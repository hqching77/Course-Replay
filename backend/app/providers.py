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
    "no quotes, no explanations, no timestamps. If nobody is speaking, output nothing. "
    "If no audio reached you with this message, output exactly NO_AUDIO_RECEIVED."
)

NO_AUDIO = "模型没有收到录音：这个接口不会把音频转给模型。请换成 Gemini 官方地址（或它的反代地址），或换一家支持音频输入的服务商"

_NO_AUDIO_SAID = re.compile(
    r"\b(no|not|n't|without|missing)\b[^.!?\n]{0,60}\baudio\b|\baudio\b[^.!?\n]{0,40}\b(missing|not (been )?(attached|provided|included|received))"
    r"|(没有|未|沒有|沒|并未|並未)(收到|附|附上|附带|提供|上传|包含|看到|检测到|听到)[^。！？\n]{0,12}(音频|音訊|录音|錄音|语音|語音)",
    re.I,
)
_ASKS_FOR_AUDIO = re.compile(
    r"\b(provide|attach|upload|share|send|include)\b[^.!?\n]{0,40}\baudio\b|请(提供|上传|发送|附上|重新上传)[^。！？\n]{0,12}(音频|录音|语音)|請(提供|上傳|發送)[^。！？\n]{0,12}(音訊|錄音|語音)",
    re.I,
)


def says_no_audio(text: str) -> bool:
    """The model answered "you didn't attach any audio" instead of a transcript (the gateway dropped the audio)."""
    value = text.strip()
    if value.upper().startswith("NO_AUDIO"):
        return True
    return len(value) < 600 and bool(_NO_AUDIO_SAID.search(value)) and bool(_ASKS_FOR_AUDIO.search(value))


def gemini_native_url(base_url: str, model: str) -> str:
    """Gemini's own generateContent endpoint for this base URL (Google's address, or a reverse proxy of it)."""
    root = re.sub(r"(/v1beta|/v1)?(/openai)?/?$", "", base_url.rstrip("/"))
    name = re.sub(r"^models/", "", model.strip())
    return f"{root}/v1beta/models/{name}:generateContent"


def prefers_gemini_native(base_url: str) -> bool:
    """Google's own address without /openai, or any address ending in /v1beta: that's the native format."""
    parsed = urlparse(base_url)
    path = parsed.path.rstrip("/")
    if path.endswith("/openai"):
        return False
    return parsed.hostname == "generativelanguage.googleapis.com" or path.endswith("/v1beta")


# Base URL + model pairs where the OpenAI-style request lost the audio but Gemini's own format worked.
_NATIVE_AUDIO: set[tuple[str, str]] = set()


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
    if chat_audio_model(config.model):
        text = await _transcribe_audio_model(client, config, audio, filename, content_type, prompt)
        return clean_transcript(text), round((time.perf_counter() - started) * 1000)
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
        hint = stt_error_hint(exc.status_code, config.base_url)
        raise RuntimeError(f"语音识别接口返回 HTTP {exc.status_code}：{api_error_detail(exc)}" + (f"。{hint}" if hint else "")) from exc
    latency = round((time.perf_counter() - started) * 1000)
    text = getattr(result, "text", None) if not isinstance(result, str) else result
    if looks_like_webpage(str(text or "")):
        raise RuntimeError(NOT_AN_API)
    return clean_transcript(str(text or "")), latency


def _instruction(prompt: str | None) -> str:
    return CHAT_TRANSCRIBE_PROMPT + (f" Context (what was said just before): {prompt[-200:]}" if prompt else "")


async def _transcribe_audio_model(client: AsyncOpenAI, config: SttConfig, audio: bytes, filename: str, content_type: str, prompt: str | None) -> str:
    """Chat models that hear audio. OpenAI-style chat first; for Gemini, its own format when that's the address,
    or when the OpenAI-style request fails or reaches the model without its audio (some gateways drop it)."""
    native = (config.base_url, config.model)
    gemini = "gemini" in config.model.lower()
    if gemini and (native in _NATIVE_AUDIO or prefers_gemini_native(config.base_url)):
        return await _transcribe_with_gemini(config, audio, filename, content_type, prompt)
    failure: RuntimeError
    try:
        text = await _transcribe_with_chat(client, config.model, audio, filename, prompt)
        if not says_no_audio(text):
            return text
        failure = RuntimeError(NO_AUDIO)
    except APITimeoutError as exc:
        raise RuntimeError("语音识别接口超时") from exc
    except APIConnectionError as exc:
        raise RuntimeError(f"无法连接语音识别接口：{exc.__cause__ or exc}") from exc
    except APIStatusError as exc:
        hint = stt_error_hint(exc.status_code, config.base_url)
        failure = RuntimeError(f"语音识别接口返回 HTTP {exc.status_code}：{api_error_detail(exc)}" + (f"。{hint}" if hint else ""))
        if exc.status_code not in (400, 403, 404, 405):
            raise failure from exc
    except RuntimeError as exc:  # a web page or an unreadable reply
        failure = exc
    if not gemini:
        raise failure
    try:
        text = await _transcribe_with_gemini(config, audio, filename, content_type, prompt)
    except RuntimeError as exc:
        raise failure from exc
    _NATIVE_AUDIO.add(native)
    return text


async def _transcribe_with_chat(client: AsyncOpenAI, model: str, audio: bytes, filename: str, prompt: str | None) -> str:
    import base64

    audio_format = "mp3" if filename.lower().endswith(".mp3") else "wav"
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": _instruction(prompt)},
            {"type": "input_audio", "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": audio_format}},
        ]}],  # type: ignore[list-item]
        # Gemini's reasoning models are meant to run at their default temperature.
        **({} if "gemini" in model.lower() else {"temperature": 0}),  # type: ignore[arg-type]
    )
    if isinstance(response, str):
        raise RuntimeError(NOT_AN_API if looks_like_webpage(response) else "语音识别接口返回的格式不对")
    return (response.choices[0].message.content or "").strip()


async def _transcribe_with_gemini(config: SttConfig, audio: bytes, filename: str, content_type: str, prompt: str | None) -> str:
    """Gemini's own format (generateContent with inline audio), as in Google's audio-understanding docs."""
    import base64

    import httpx

    mime = content_type if content_type.startswith("audio/") else ("audio/mp3" if filename.lower().endswith(".mp3") else "audio/wav")
    body = {"contents": [{"role": "user", "parts": [
        {"text": _instruction(prompt)},
        {"inline_data": {"mime_type": mime, "data": base64.b64encode(audio).decode("ascii")}},
    ]}]}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0), follow_redirects=False) as http:
            response = await http.post(gemini_native_url(config.base_url, config.model), json=body,
                                       headers={"x-goog-api-key": config.api_key, "Content-Type": "application/json"})
    except httpx.TimeoutException as exc:
        raise RuntimeError("语音识别接口超时") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"无法连接语音识别接口：{exc}") from exc
    if looks_like_webpage(response.text):
        raise RuntimeError(NOT_AN_API)
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"语音识别接口返回 HTTP {response.status_code}，内容不是 JSON") from exc
    if response.status_code >= 400 or "error" in data:
        error = data.get("error") if isinstance(data, dict) else None
        message = (error.get("message") if isinstance(error, dict) else None) or str(error or "未知错误")
        hint = stt_error_hint(response.status_code, config.base_url) if response.status_code in (401, 403, 429) or response.status_code >= 500 else ""
        raise RuntimeError(f"语音识别接口返回 HTTP {response.status_code}：{str(message).strip()[:300]}" + (f"。{hint}" if hint else ""))
    candidates = data.get("candidates") or []
    if not candidates:
        blocked = (data.get("promptFeedback") or {}).get("blockReason")
        if blocked:
            raise RuntimeError("模型拒绝处理这段录音")
        return ""
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict) and not part.get("thought")).strip()
    if says_no_audio(text):
        raise RuntimeError(NO_AUDIO)
    return text
