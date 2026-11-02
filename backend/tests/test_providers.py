import time

import pytest

from app.config import get_settings
from app.providers import clean_transcript
from app.schemas import CourseMaterialAnalysis
from app.services.ai_provider import AIProvider
from tests.test_auth import auth_header, register


@pytest.fixture
def chat_calls(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", "server-key")
    monkeypatch.setattr(settings, "openai_chat_model", "server-model")
    calls = []

    async def fake_chat(self, messages, **kwargs):
        calls.append({"base_url": self.settings.openai_base_url, "key": self.settings.openai_api_key,
                      "model": self.settings.openai_chat_model, "messages": messages})
        return "OK"

    monkeypatch.setattr(AIProvider, "chat", fake_chat)
    return calls


@pytest.fixture
def headers(client):
    return auth_header(register(client, "alice").json()["token"])


def test_ai_check_uses_server_provider(client, chat_calls, headers):
    body = client.post("/api/ai/check", headers=headers).json()
    assert body["ok"] is True and body["source"] == "server" and body["reply"] == "OK"
    assert body["model"] == "server-model" and isinstance(body["latency_ms"], int)
    assert chat_calls[0]["key"] == "server-key"


def test_ai_check_reports_upstream_failure(client, chat_calls, headers, monkeypatch):
    async def broken(self, messages, **kwargs):
        raise RuntimeError("AI 服务返回 HTTP 401：invalid key")

    monkeypatch.setattr(AIProvider, "chat", broken)
    body = client.post("/api/ai/check", headers=headers).json()
    assert body["ok"] is False and "401" in body["error"]


def test_custom_provider_headers_override_server(client, chat_calls, headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "allow_private_provider_urls", True)
    custom = {**headers, "X-AI-Key": "user-key", "X-AI-Base-URL": "http://127.0.0.1:9/v1", "X-AI-Model": "my-model"}
    body = client.post("/api/ai/check", headers=custom).json()
    assert body["ok"] is True and body["source"] == "custom"
    assert chat_calls[-1] == {**chat_calls[-1], "base_url": "http://127.0.0.1:9/v1", "key": "user-key", "model": "my-model"}


def test_custom_provider_key_alone_keeps_server_url_and_model(client, chat_calls, headers):
    client.post("/api/ai/check", headers={**headers, "X-AI-Key": "user-key"})
    assert chat_calls[-1]["key"] == "user-key"
    assert chat_calls[-1]["base_url"] == get_settings().openai_base_url
    assert chat_calls[-1]["model"] == "server-model"


@pytest.mark.parametrize("url", ["http://127.0.0.1:8001/v1", "https://localhost/v1", "ftp://example.com", "https://10.0.0.5/v1"])
def test_custom_provider_rejects_private_or_bad_urls(client, chat_calls, headers, url):
    response = client.post("/api/ai/check", headers={**headers, "X-AI-Key": "k", "X-AI-Base-URL": url})
    assert response.status_code == 400
    assert chat_calls == []


def test_custom_providers_can_be_disabled(client, chat_calls, headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "allow_custom_providers", False)
    assert client.post("/api/ai/check", headers={**headers, "X-AI-Key": "k"}).status_code == 403


def test_ai_check_requires_login(client, chat_calls):
    assert client.post("/api/ai/check").status_code == 401


def test_english_ui_asks_for_english_answers(client, chat_calls, headers):
    client.post("/api/class/ask", json={"question": "什么是 rwx？", "transcript": "老师：今天讲文件权限"},
                headers={**headers, "X-UI-Language": "en"})
    system = chat_calls[-1]["messages"][0]["content"]
    assert "in English" in system
    assert "老师最近讲的内容" in system and "今天讲文件权限" in system
    client.post("/api/class/ask", json={"question": "什么是 rwx？"}, headers=headers)
    assert "简体中文" in chat_calls[-1]["messages"][0]["content"]


def test_clean_transcript():
    assert clean_transcript("<|zh|><|NEUTRAL|><|Speech|>今天讲傅里叶变换") == "今天讲傅里叶变换"
    assert clean_transcript("谢谢观看。") == ""
    assert clean_transcript(" Thank you. ") == ""
    assert clean_transcript("谢谢观看这个例子的同学") == "谢谢观看这个例子的同学"


# ---------------------------------------------------------------------------
# Speech-to-text
# ---------------------------------------------------------------------------

WAV = b"RIFF" + b"\0" * 64


@pytest.fixture
def stt_calls(monkeypatch):
    calls = []

    async def fake_transcribe(config, audio, filename, content_type, *, language=None, prompt=None):
        calls.append({"config": config, "bytes": len(audio), "filename": filename, "language": language, "prompt": prompt})
        return "今天我们讲傅里叶变换", 42

    monkeypatch.setattr("app.api.analysis.transcribe_audio", fake_transcribe)
    return calls


def test_transcribe_requires_configuration(client, stt_calls, headers):
    response = client.post("/api/transcribe", files={"file": ("a.wav", WAV, "audio/wav")}, headers=headers)
    assert response.status_code == 503
    assert stt_calls == []


def test_transcribe_with_server_default(client, stt_calls, headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "stt_api_key", "sf-key")
    assert client.post("/api/transcribe", files={"file": ("a.wav", WAV, "audio/wav")}).status_code == 401
    response = client.post(
        "/api/transcribe",
        files={"file": ("chunk-3.wav", WAV, "audio/wav")},
        data={"language": "zh", "prompt": "上一段"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == {"text": "今天我们讲傅里叶变换", "model": "FunAudioLLM/SenseVoiceSmall", "source": "server", "latency_ms": 42}
    call = stt_calls[0]
    assert call["config"].base_url == "https://api.siliconflow.cn/v1"
    assert call["filename"] == "chunk-3.wav" and call["bytes"] == len(WAV) and call["prompt"] == "上一段"


def test_transcribe_with_users_own_provider(client, stt_calls, headers, monkeypatch):
    # No DNS in tests: pretend the provider resolves to a public address.
    monkeypatch.setattr("app.providers.socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("104.18.10.20", 443))])
    custom = {**headers, "X-STT-Key": "gsk", "X-STT-Base-URL": "https://api.groq.com/openai/v1", "X-STT-Model": "whisper-large-v3-turbo"}
    response = client.post("/api/transcribe", files={"file": ("a.wav", WAV, "audio/wav")}, headers=custom)
    assert response.status_code == 200 and response.json()["source"] == "custom"
    assert stt_calls[0]["config"].model == "whisper-large-v3-turbo"
    blocked = {**custom, "X-STT-Base-URL": "https://192.168.1.2/v1"}
    assert client.post("/api/transcribe", files={"file": ("a.wav", WAV, "audio/wav")}, headers=blocked).status_code == 400


def test_transcribe_rejects_oversized_audio(client, stt_calls, headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "stt_api_key", "sf-key")
    monkeypatch.setattr(get_settings(), "max_audio_mb", 0)
    response = client.post("/api/transcribe", files={"file": ("a.wav", WAV, "audio/wav")}, headers=headers)
    assert response.status_code == 413


# ---------------------------------------------------------------------------
# Uploads + building notes from files, uploads and the class transcript
# ---------------------------------------------------------------------------


@pytest.fixture
def analyzer_calls(monkeypatch, chat_calls):
    calls = []

    async def fake_analyze(documents, provider, class_questions=None, transcript="", language="zh", **_):
        calls.append({"files": [d.filename for d in documents], "questions": class_questions,
                      "transcript": transcript, "language": language, "model": provider.settings.openai_chat_model})
        return CourseMaterialAnalysis(title="傅里叶变换", summary="课堂笔记"), None

    monkeypatch.setattr("app.api.analysis.analyze_materials", fake_analyze)
    return calls


def wait_for_job(client, job_id, headers):
    for _ in range(100):
        job = client.get(f"/api/process/{job_id}", headers=headers).json()
        if job["status"] in {"completed", "failed"}:
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_build_from_upload_transcript_and_questions(client, analyzer_calls, headers):
    upload = client.post("/api/uploads", files={"file": ("slides.md", b"# Fourier\n", "text/markdown")}, headers=headers)
    assert upload.status_code == 201
    upload_id = upload.json()["id"]
    started = client.post(
        "/api/process/start",
        data={
            "upload_ids": f'["{upload_id}"]',
            "transcript": "老师：傅里叶变换把信号分解成正弦波。",
            "class_questions": '["为什么是正弦波？"]',
        },
        files={"files": ("notes.txt", b"extra", "text/plain")},
        headers={**headers, "X-UI-Language": "en"},
    )
    assert started.status_code == 200, started.text
    job = wait_for_job(client, started.json()["job_id"], headers)
    assert job["status"] == "completed", job
    assert [doc["filename"] for doc in job["result"]["documents"]] == ["slides.md", "notes.txt"]
    call = analyzer_calls[0]
    assert call["files"] == ["slides.md", "notes.txt"]
    assert call["questions"] == ["为什么是正弦波？"]
    assert "正弦波" in call["transcript"] and call["language"] == "en"


def test_build_from_transcript_only(client, analyzer_calls, headers):
    started = client.post("/api/process/start", data={"transcript": "今天讲卷积。"}, headers=headers)
    job = wait_for_job(client, started.json()["job_id"], headers)
    assert job["status"] == "completed" and job["result"]["documents"] == []
    assert analyzer_calls[0]["files"] == []


def test_build_needs_some_input(client, analyzer_calls, headers):
    assert client.post("/api/process/start", data={"transcript": "  "}, headers=headers).status_code == 400


def test_uploads_are_private_to_their_owner(client, analyzer_calls, headers):
    upload_id = client.post("/api/uploads", files={"file": ("a.md", b"x", "text/markdown")}, headers=headers).json()["id"]
    bob = auth_header(register(client, "bob").json()["token"])
    response = client.post("/api/process/start", data={"upload_ids": f'["{upload_id}"]'}, headers=bob)
    assert response.status_code == 404


def test_upload_rejects_unsupported_type_and_anonymous(client, headers):
    assert client.post("/api/uploads", files={"file": ("a.exe", b"x", "application/octet-stream")}, headers=headers).status_code == 415
    assert client.post("/api/uploads", files={"file": ("a.md", b"x", "text/markdown")}).status_code == 401


def test_health_reports_speech_and_database(client):
    body = client.get("/api/health").json()
    assert body["stt_model"] == "FunAudioLLM/SenseVoiceSmall"
    assert body["stt_configured"] is False
    assert body["database"] in {"sqlite", "postgresql"}
