from fastapi import APIRouter

from app.config import get_settings
from app.schemas import HealthResponse
from app.services.visual_processor import office_conversion_available

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        version=settings.app_version,
        ai_configured=settings.ai_configured,
        configured=settings.ai_configured,
        provider="CheapRouter",
        base_url=settings.openai_base_url,
        model=settings.openai_chat_model or None,
        office_conversion=office_conversion_available(),
        processing_mode="whole-page vision; no OCR",
    )
