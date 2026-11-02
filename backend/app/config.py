from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Course Replay API"
    # "production" turns on the checks in app/main.py (encryption key required, no dev-only options).
    app_env: str = "development"
    # 32 random bytes, base64. Encrypts users' notes, transcripts, questions and titles in the database.
    data_encryption_key: str = ""
    app_version: str = "0.1.0"
    app_debug: bool = False
    api_prefix: str = "/api"
    database_url: str = "sqlite:///./data/course_replay.db"
    artifacts_dir: Path = Path("./data/artifacts")
    max_upload_mb: int = 100
    max_pages_per_file: int = 40
    document_render_dpi: int = 110
    cors_origins: str = "http://localhost:8000,http://127.0.0.1:8000,http://localhost:5173,http://127.0.0.1:5173"

    # Accounts. AI endpoints spend the server's API key, so by default only
    # signed-in users may call them.
    ai_requires_login: bool = True
    auth_session_days: int = 30
    allow_registration: bool = True

    openai_api_key: str = ""
    openai_base_url: str = "https://cdn.cheaprouter.cc/v1"
    openai_chat_model: str = ""
    openai_embedding_model: str = ""
    openai_vision_model: str = ""

    # Speech-to-text for 上课中. Any OpenAI-compatible /audio/transcriptions API.
    # Default: SiliconFlow SenseVoiceSmall (free model, reachable from mainland China).
    stt_api_key: str = ""
    stt_base_url: str = "https://api.siliconflow.cn/v1"
    stt_model: str = "FunAudioLLM/SenseVoiceSmall"
    max_audio_mb: int = 25

    # Header your reverse proxy sets to the visitor's real address, used by the sign-in rate
    # limits (Render: True-Client-IP; the Caddy setup in deploy/: X-Real-IP). Empty = direct.
    client_ip_header: str = ""

    # Users may pick their own AI / speech provider in 设置 (key kept in their browser).
    allow_custom_providers: bool = True
    # Custom provider URLs must resolve to public addresses unless this is on (e.g. a local model in dev).
    allow_private_provider_urls: bool = False

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        # A blank line like `DATABASE_URL=` in an env file means "use the default".
        env_ignore_empty=True,
        extra="ignore",
    )

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        # Hosted Postgres (Neon, Supabase, Render…) hands out postgres:// or postgresql:// URLs;
        # point them at the psycopg 3 driver this app installs.
        value = value.strip()
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value.removeprefix(prefix)
        return value

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key and self.openai_chat_model)

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() in {"production", "prod"}

    @property
    def stt_configured(self) -> bool:
        return bool(self.stt_api_key and self.stt_model and self.stt_base_url)

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
