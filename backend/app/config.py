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
    document_render_dpi: int = 144
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    openai_api_key: str = ""
    openai_base_url: str = "https://cdn.cheaprouter.cc/v1"
    openai_chat_model: str = ""
    openai_embedding_model: str = ""
    openai_vision_model: str = ""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key and self.openai_chat_model)

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
