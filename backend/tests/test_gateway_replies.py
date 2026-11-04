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
