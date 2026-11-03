from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import logging

from app.api import analysis, auth, courses, documents, health, homework, importer, practice, workspace
from app.config import Settings, get_settings
from app.crypto import parse_key
from app.database import create_db_and_tables

settings = get_settings()
logger = logging.getLogger("course_replay")


def check_settings(current: Settings) -> list[str]:
    """Refuse to run a public server with development settings. Returns warnings."""
    if current.data_encryption_key:
        parse_key(current.data_encryption_key)  # fail fast on a malformed key
    if not current.is_production:
        return []
    problems: list[str] = []
    if not current.data_encryption_key:
        problems.append("DATA_ENCRYPTION_KEY is required (users' notes are encrypted with it)")
    if current.allow_private_provider_urls:
        problems.append("ALLOW_PRIVATE_PROVIDER_URLS must be false")
    if problems:
        raise RuntimeError("Refusing to start in production: " + "; ".join(problems))
    warnings = []
    if current.database_url.startswith("sqlite"):
        warnings.append("Using SQLite: make sure the data folder is on a persistent disk and backed up")
    if any("localhost" in origin or "127.0.0.1" in origin for origin in current.cors_origin_list):
        warnings.append("CORS_ORIGINS still allows localhost; set it to your site's address")
    return warnings


@asynccontextmanager
async def lifespan(_: FastAPI):
    for warning in check_settings(settings):
        logger.warning(warning)
    settings.artifacts_dir.mkdir(parents=True, exist_ok=True)
    create_db_and_tables()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
    # The interactive API docs are handy locally; a public server doesn't need them.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix=settings.api_prefix)
app.include_router(courses.router, prefix=settings.api_prefix)
app.include_router(documents.router, prefix=settings.api_prefix)
app.include_router(analysis.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(workspace.router, prefix=settings.api_prefix)
app.include_router(importer.router, prefix=settings.api_prefix)
app.include_router(practice.router, prefix=settings.api_prefix)
app.include_router(homework.router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"message": "Course Replay API"}
