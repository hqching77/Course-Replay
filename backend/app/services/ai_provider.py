from typing import Any, NoReturn

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI

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
                timeout=300.0,
                max_retries=2,
            )
        return self._client, self.settings.openai_chat_model

    @staticmethod
    def _raise_friendly_error(exc: Exception) -> NoReturn:
        if isinstance(exc, APITimeoutError):
            raise RuntimeError("中转站响应超时，已自动重试 2 次；请稍后重新上传。") from exc
        if isinstance(exc, APIConnectionError):
            cause = str(exc.__cause__ or "连接在响应完成前被关闭")
            raise RuntimeError(f"无法稳定连接 CheapRouter，已自动重试 2 次：{cause}") from exc
        if isinstance(exc, APIStatusError):
            raise RuntimeError(f"CheapRouter 返回 HTTP {exc.status_code}：{exc.message}") from exc
        raise exc

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> str:
        client, model = self._require_chat_config()
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except (APIConnectionError, APITimeoutError, APIStatusError) as exc:
            self._raise_friendly_error(exc)
        return response.choices[0].message.content or ""

    async def analyze_visual_materials(
        self,
        content: list[dict[str, Any]],
        *,
        system_prompt: str,
        max_tokens: int = 8000,
    ) -> tuple[str, dict[str, Any] | None]:
        client, model = self._require_chat_config()
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": content},
                ],  # type: ignore[arg-type]
                temperature=0.3,
                max_tokens=max_tokens,
            )
        except (APIConnectionError, APITimeoutError, APIStatusError) as exc:
            self._raise_friendly_error(exc)
        usage = response.usage.model_dump() if response.usage else None
        return response.choices[0].message.content or "", usage
