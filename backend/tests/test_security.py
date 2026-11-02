import base64
import json
import os
from pathlib import Path

import pytest
from sqlalchemy import text

from app.config import get_settings
from app.crypto import EncryptionKeyError, decrypt_text, encrypt_text, parse_key
from app.database import engine
from app.main import check_settings
from tests.test_auth import auth_header, register
from tests.test_providers import analyzer_calls, chat_calls, wait_for_job  # noqa: F401  (fixtures)
from tests.test_workspace import demo_course, demo_section

KEY = base64.urlsafe_b64encode(os.urandom(32)).decode()


@pytest.fixture
def encrypted(monkeypatch):
    monkeypatch.setattr(get_settings(), "data_encryption_key", KEY)


def raw(sql):
    with engine.connect() as connection:
        return [row[0] for row in connection.execute(text(sql))]


def test_round_trip_and_tamper_detection(encrypted, monkeypatch):
    sealed = encrypt_text("傅里叶变换")
    assert sealed.startswith("enc:v1:") and "傅里叶" not in sealed
    assert encrypt_text("傅里叶变换") != sealed  # random nonce
    assert decrypt_text(sealed) == "傅里叶变换"
    assert decrypt_text("written before encryption") == "written before encryption"
    monkeypatch.setattr(get_settings(), "data_encryption_key", base64.urlsafe_b64encode(os.urandom(32)).decode())
    with pytest.raises(EncryptionKeyError):
        decrypt_text(sealed)


def test_rejects_malformed_keys():
    with pytest.raises(EncryptionKeyError):
        parse_key("short")
    with pytest.raises(EncryptionKeyError):
        parse_key(base64.urlsafe_b64encode(os.urandom(16)).decode())
    assert len(parse_key(KEY)) == 32


def test_study_content_is_ciphertext_in_the_database(client, encrypted):
    headers = auth_header(register(client, "alice").json()["token"])
    client.put("/api/workspace/course", json=demo_course(title="信号与系统"), headers=headers)
    client.put("/api/workspace/section", json=demo_section(), headers=headers)

    # The API returns plain text…
    section = client.get("/api/workspace", headers=headers).json()["courses"][0]["sections"][0]
    assert section["classQuestions"][0]["question"] == "chmod 755 是什么意思？"
    assert section["transcript"][0]["text"] == "今天讲文件权限。"
    assert section["analysis"]["summary"] == "概览"

    # …while the database only holds ciphertext.
    stored = (
        raw("SELECT title FROM study_courses") + raw("SELECT description FROM study_courses")
        + raw("SELECT title FROM study_sections") + raw("SELECT live_topic FROM study_sections")
        + raw("SELECT question FROM class_questions") + raw("SELECT answer FROM class_questions")
        + raw("SELECT text FROM transcript_segments") + raw("SELECT content FROM study_messages")
        + raw("SELECT name FROM study_materials")
    )
    assert stored and all(str(value).startswith("enc:v1:") for value in stored), stored
    for column in ("analysis", "knowledge_map"):
        value = raw(f"SELECT {column} FROM study_sections")[0]
        value = json.loads(value) if isinstance(value, str) and value.startswith('"') else value
        assert str(value).startswith("enc:v1:")
    tags = raw("SELECT tags FROM study_courses")[0]
    assert "Linux" not in str(tags)
    everything = json.dumps(stored, ensure_ascii=False)
    for secret in ("信号与系统", "chmod", "文件权限", "Shell"):
        assert secret not in everything


def test_plaintext_rows_stay_readable_after_turning_encryption_on(client, monkeypatch):
    headers = auth_header(register(client, "alice").json()["token"])
    client.put("/api/workspace/course", json=demo_course(), headers=headers)
    client.put("/api/workspace/section", json=demo_section(), headers=headers)
    assert raw("SELECT text FROM transcript_segments")[0] == "今天讲文件权限。"

    monkeypatch.setattr(get_settings(), "data_encryption_key", KEY)
    section = client.get("/api/workspace", headers=headers).json()["courses"][0]["sections"][0]
    assert section["transcript"][0]["text"] == "今天讲文件权限。"
    client.put("/api/workspace/section", json=demo_section(), headers=headers)
    assert raw("SELECT text FROM transcript_segments")[0].startswith("enc:v1:")


def test_build_jobs_and_files_belong_to_their_owner(client, analyzer_calls, encrypted):  # noqa: F811
    alice = auth_header(register(client, "alice").json()["token"])
    bob = auth_header(register(client, "bob").json()["token"])
    upload = client.post("/api/uploads", files={"file": ("我的笔记.md", b"# notes", "text/markdown")}, headers=alice).json()
    stored = Path(raw(f"SELECT stored_path FROM uploaded_files WHERE id = '{upload['id']}'")[0])
    assert stored.name == "original.md" and "我的笔记" not in str(stored)
    assert raw("SELECT filename FROM uploaded_files")[0].startswith("enc:v1:")

    job_id = client.post("/api/process/start", data={"upload_ids": json.dumps([upload["id"]])}, headers=alice).json()["job_id"]
    job = wait_for_job(client, job_id, alice)
    assert job["status"] == "completed"
    assert job["result"]["documents"][0]["filename"] == "我的笔记.md"

    assert client.get(f"/api/process/{job_id}", headers=bob).status_code == 404
    assert client.get(f"/api/process/{job_id}").status_code == 404
    assert client.get(f"/api/process/{job_id}/files/0", headers=bob).status_code == 404
    assert client.delete(f"/api/process/{job_id}", headers=bob).status_code == 404
    assert client.get(f"/api/process/{job_id}/files/0", headers=alice).status_code == 200
    assert [item["job_id"] for item in client.get("/api/process", headers=alice).json()] == [job_id]
    assert client.get("/api/process", headers=bob).json() == []

    result_file = get_settings().artifacts_dir / "visual_jobs" / job_id / "result.json"
    assert result_file.read_text(encoding="utf-8").startswith("enc:v1:")


def test_repeated_wrong_passwords_are_rate_limited(client):
    register(client, "alice", password="secret123")
    for _ in range(8):
        assert client.post("/api/auth/login", json={"username": "alice", "password": "wrong-pass"}).status_code == 401
    blocked = client.post("/api/auth/login", json={"username": "alice", "password": "secret123"})
    assert blocked.status_code == 429


def test_registration_is_rate_limited(client):
    statuses = [register(client, f"user{i}").status_code for i in range(11)]
    assert statuses[:10] == [201] * 10 and statuses[10] == 429


def test_rate_limits_use_the_proxy_client_header(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "client_ip_header", "True-Client-IP")
    for i in range(10):
        assert register(client, f"a{i}", headers={"True-Client-IP": "203.0.113.7"}).status_code == 201
    # Same visitor is blocked even if they forge X-Forwarded-For; another visitor is not.
    assert register(client, "a10", headers={"True-Client-IP": "203.0.113.7", "X-Forwarded-For": "1.2.3.4"}).status_code == 429
    assert register(client, "b0", headers={"True-Client-IP": "198.51.100.9"}).status_code == 201


def test_hosted_postgres_urls_use_psycopg():
    from app.config import Settings

    assert Settings(database_url="postgres://u:p@host/db?sslmode=require").database_url == "postgresql+psycopg://u:p@host/db?sslmode=require"
    assert Settings(database_url="postgresql://u:p@host/db").database_url == "postgresql+psycopg://u:p@host/db"


def test_production_settings_are_checked(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "data_encryption_key", "")
    with pytest.raises(RuntimeError, match="DATA_ENCRYPTION_KEY"):
        check_settings(settings)
    monkeypatch.setattr(settings, "data_encryption_key", KEY)
    monkeypatch.setattr(settings, "allow_private_provider_urls", True)
    with pytest.raises(RuntimeError, match="PRIVATE_PROVIDER"):
        check_settings(settings)
    monkeypatch.setattr(settings, "allow_private_provider_urls", False)
    monkeypatch.setattr(settings, "database_url", "sqlite:///./data/x.db")
    warnings = check_settings(settings)
    assert any("SQLite" in w for w in warnings) and any("CORS" in w for w in warnings)
    monkeypatch.setattr(settings, "data_encryption_key", "not-a-key")
    with pytest.raises(EncryptionKeyError):
        check_settings(settings)
