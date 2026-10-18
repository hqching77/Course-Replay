from typing import Any

from openai import AsyncOpenAI

from app.config import Settings, get_settings


class AIConfigurationError(RuntimeError):
    pass


class AIProvider:
    """OpenAI-compatible boundary used by Course Replay AI services."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._client: AsyncOpenAI | None = None

    def _require_chat_config(self) -> tuple[AsyncOpenAI, str]:
        if not self.settings.openai_api_key or not self.settings.openai_chat_model:
            raise AIConfigurationError(
                "AI is not configured. Set OPENAI_API_KEY and OPENAI_CHAT_MODEL."
            )
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=self.settings.openai_api_key,
                base_url=self.settings.openai_base_url,
                timeout=45.0,
                max_retries=2,
            )
        return self._client, self.settings.openai_chat_model

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> str:
        client, model = self._require_chat_config()
        response = await client.chat.completions.create(
            model=model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""

    async def analyze_visual_materials(
        self,
        content: list[dict[str, Any]],
        *,
        system_prompt: str,
    ) -> tuple[str, dict[str, Any] | None]:
        client, model = self._require_chat_config()
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content},
            ],  # type: ignore[arg-type]
            temperature=0.2,
            max_tokens=2500,
        )
        usage = response.usage.model_dump() if response.usage else None
        return response.choices[0].message.content or "", usage
