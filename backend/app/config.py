from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Course Replay API"
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

    # Users may pick their own AI / speech provider in 设置 (key kept in their browser).
    allow_custom_providers: bool = True
    # Custom provider URLs must resolve to public addresses unless this is on (e.g. a local model in dev).
    allow_private_provider_urls: bool = False

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key and self.openai_chat_model)

    @property
    def stt_configured(self) -> bool:
        return bool(self.stt_api_key and self.stt_model and self.stt_base_url)

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
