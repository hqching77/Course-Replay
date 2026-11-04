"""Gateways that answer a wrong path with their website (HTTP 200 HTML), and chat models that take audio."""

import asyncio
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.config import get_settings
from app.providers import NOT_AN_API, SttConfig, chat_audio_model, looks_like_webpage, transcribe_audio
from app.services.ai_provider import AIProvider

PAGE = b'<!doctype html> <html lang="zh-CN"> <head> <title>Some AI Gateway</title></head><body><div id="app"></div></body></html>'


@pytest.fixture
def gateway():
    """A fake gateway: /v1/chat/completions is a real API; anything else gets the website."""
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            seen.append((self.path, body))
            if self.path == "/v1/chat/completions":
                payload = json.dumps({"id": "x", "object": "chat.completion", "created": 0, "model": "m",
                                      "choices": [{"index": 0, "message": {"role": "assistant", "content": "  今天讲矩阵乘法。  "}, "finish_reason": "stop"}]}).encode()
                content_type = "application/json"
            else:
                payload, content_type = PAGE, "text/html; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", seen
    server.shutdown()


def test_detects_webpages():
    assert looks_like_webpage(PAGE.decode()) and looks_like_webpage("  <html><head></head></html>")
    assert not looks_like_webpage("今天讲矩阵乘法") and not looks_like_webpage("")
    assert chat_audio_model("gemini-4-argon") and chat_audio_model("qwen-omni-turbo") and not chat_audio_model("FunAudioLLM/SenseVoiceSmall")


def test_transcription_endpoint_answered_by_a_website_is_an_error(gateway):
    base, _ = gateway
    with pytest.raises(RuntimeError) as error:
        asyncio.run(transcribe_audio(SttConfig(f"{base}/v1", "k", "whisper-1", "custom"), b"RIFF....WAVE", "a.wav", "audio/wav"))
    assert str(error.value) == NOT_AN_API


def test_chat_endpoint_answered_by_a_website_is_an_error(gateway, monkeypatch):
    base, _ = gateway
    settings = get_settings().model_copy(update={"openai_base_url": base, "openai_api_key": "k", "openai_chat_model": "m"})  # no /v1: wrong path
    with pytest.raises(RuntimeError) as error:
        asyncio.run(AIProvider(settings).chat([{"role": "user", "content": "hi"}]))
    assert str(error.value) == NOT_AN_API


def test_audio_capable_chat_models_transcribe_through_chat(gateway):
    base, seen = gateway
    audio = b"RIFF\x24\x00\x00\x00WAVEfmt fake"
    text, _ = asyncio.run(transcribe_audio(SttConfig(f"{base}/v1", "k", "gemini-4-argon", "custom"), audio, "chunk.wav", "audio/wav", prompt="上一段"))
    assert text == "今天讲矩阵乘法。"
    path, body = seen[-1]
    sent = json.loads(body)
    parts = sent["messages"][0]["content"]
    assert path == "/v1/chat/completions" and sent["model"] == "gemini-4-argon"
    assert parts[1] == {"type": "input_audio", "input_audio": {"data": base64.b64encode(audio).decode(), "format": "wav"}}
    assert "verbatim" in parts[0]["text"] and "上一段" in parts[0]["text"]


# ---------------------------------------------------------------------------
# Gateways that drop the audio of an OpenAI-style request; Gemini's own format
# ---------------------------------------------------------------------------

DROPPED = ("Hold pause. I see you provided the instructions for transcribing audio, however, no audio file or audio content "
           "was attached to your request. Please provide the audio you would like transcribed!")


@pytest.fixture
def audio_gateway():
    """chat: 'drops' (answers without the audio), 'forbidden' (403, like a proxy that only allows generateContent);
    native: 'ok', 'missing' (404) or 'thinking' (a thought part before the text)."""
    state = {"chat": "drops", "native": "ok", "seen": []}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            state["seen"].append((self.path, dict(self.headers), body))
            if self.path.endswith("/chat/completions"):
                if state["chat"] == "forbidden":
                    return self.reply(403, {"error": {"message": "Only gemini-4-argon:generateContent is allowed"}})
                return self.reply(200, {"id": "x", "object": "chat.completion", "created": 0, "model": "m",
                                        "choices": [{"index": 0, "message": {"role": "assistant", "content": DROPPED}, "finish_reason": "stop"}]})
            if ":generateContent" in self.path and state["native"] != "missing":
                parts = [{"text": "先想一想", "thought": True}] if state["native"] == "thinking" else []
                return self.reply(200, {"candidates": [{"content": {"role": "model", "parts": [*parts, {"text": "今天讲傅里叶变换。"}]}}]})
            return self.reply(404, {"error": {"code": 404, "message": "Not found", "status": "NOT_FOUND"}})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", state
    server.shutdown()


def test_no_audio_replies_are_recognised():
    from app.providers import says_no_audio

    assert says_no_audio(DROPPED) and says_no_audio("NO_AUDIO_RECEIVED")
    assert says_no_audio("我没有收到音频文件，请上传音频后再试。")
    assert not says_no_audio("今天讲音频信号的采样，没有抗混叠滤波器会怎样？")
    assert not says_no_audio("Without audio feedback the loop is unstable, so we add a microphone.")
    assert not says_no_audio("")


def test_gemini_audio_falls_back_to_its_own_format_when_the_gateway_drops_it(audio_gateway):
    from app.providers import _NATIVE_AUDIO

    base, state = audio_gateway
    config = SttConfig(f"{base}/v1", "secret-key", "gemini-4-argon", "custom")
    audio = b"RIFF\x24\x00\x00\x00WAVEfmt fake"
    text, _ = asyncio.run(transcribe_audio(config, audio, "chunk.wav", "audio/wav", prompt="上一段"))
    assert text == "今天讲傅里叶变换。"
    (chat_path, _, chat_body), (native_path, headers, body) = state["seen"]
    assert chat_path == "/v1/chat/completions" and "temperature" not in chat_body
    assert native_path == "/v1beta/models/gemini-4-argon:generateContent"
    assert headers.get("x-goog-api-key") == "secret-key" and "Authorization" not in headers
    parts = body["contents"][0]["parts"]
    assert parts[1] == {"inline_data": {"mime_type": "audio/wav", "data": base64.b64encode(audio).decode()}}
    assert "verbatim" in parts[0]["text"] and "上一段" in parts[0]["text"]
    # Next chunk goes straight to the format that worked.
    asyncio.run(transcribe_audio(config, audio, "chunk.wav", "audio/wav"))
    assert [path for path, _, _ in state["seen"]][2:] == ["/v1beta/models/gemini-4-argon:generateContent"]
    _NATIVE_AUDIO.clear()


def test_audio_lost_everywhere_is_an_error_not_a_transcript(audio_gateway):
    from app.providers import NO_AUDIO

    base, state = audio_gateway
    state["native"] = "missing"
    for model in ("gemini-4-argon", "qwen-omni-turbo"):
        with pytest.raises(RuntimeError) as error:
            asyncio.run(transcribe_audio(SttConfig(f"{base}/v1", "k", model, "custom"), b"RIFF....WAVE", "a.wav", "audio/wav"))
        assert str(error.value) == NO_AUDIO


def test_gemini_native_address_and_proxies(audio_gateway):
    from app.providers import _NATIVE_AUDIO, gemini_native_url, prefers_gemini_native

    assert gemini_native_url("https://generativelanguage.googleapis.com/v1beta/openai/", "models/gemini-4-argon") == "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent"
    assert gemini_native_url("https://proxy.example.workers.dev", "gemini-4-argon") == "https://proxy.example.workers.dev/v1beta/models/gemini-4-argon:generateContent"
    assert prefers_gemini_native("https://generativelanguage.googleapis.com") and prefers_gemini_native("https://proxy.example.workers.dev/v1beta")
    assert not prefers_gemini_native("https://generativelanguage.googleapis.com/v1beta/openai") and not prefers_gemini_native("https://gateway.example.com/v1")

    base, state = audio_gateway
    state["native"] = "thinking"
    # An address ending in /v1beta: Gemini's own format straight away; thought parts are skipped.
    text, _ = asyncio.run(transcribe_audio(SttConfig(f"{base}/v1beta", "k", "gemini-4-argon", "custom"), b"RIFF....WAVE", "a.wav", "audio/wav"))
    assert text == "今天讲傅里叶变换。" and [path for path, _, _ in state["seen"]] == ["/v1beta/models/gemini-4-argon:generateContent"]
    # A proxy that only allows generateContent (403 on the OpenAI-style path).
    state["chat"], state["seen"] = "forbidden", []
    text, _ = asyncio.run(transcribe_audio(SttConfig(base, "k", "gemini-4-argon", "custom"), b"RIFF....WAVE", "a.wav", "audio/wav"))
    assert text == "今天讲傅里叶变换。" and [path for path, _, _ in state["seen"]] == ["/chat/completions", "/v1beta/models/gemini-4-argon:generateContent"]
    _NATIVE_AUDIO.clear()
