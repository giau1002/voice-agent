from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_env: Literal["development", "production", "test"] = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8790
    app_access_token: SecretStr = SecretStr("")
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    livekit_url: str = "ws://127.0.0.1:7880"
    livekit_server_url: str = ""
    livekit_api_key: str = "devkey"
    livekit_api_secret: SecretStr = SecretStr("devsecret")
    livekit_agent_name: str = "portrait-voice"
    session_max_seconds: int = Field(1800, ge=60, le=7200)
    soniox_api_key: SecretStr = SecretStr("")
    soniox_stt_model: str = "stt-rt-v5"
    soniox_language_hints: str = "vi,en"
    soniox_max_endpoint_delay_ms: int = Field(700, ge=500, le=3000)
    soniox_tts_model: str = "tts-rt-v1-preview"
    soniox_tts_voice: str = "Nina"
    soniox_tts_language: str = "vi"
    soniox_tts_speed: float = Field(0.95, ge=0.7, le=1.3)
    llm_provider: Literal["gemini", "openai", "local"] = "gemini"
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = "gemini-2.5-flash"
    gemini_fast_responses: bool = True
    openai_api_key: SecretStr = SecretStr("")
    llm_model: str = "gpt-4o-mini"
    llm_base_url: str = ""
    llm_allow_no_key: bool = False
    llm_temperature: float = Field(0.4, ge=0, le=2)
    agent_prompt_file: str = "prompts/system.md"
    agent_greeting: str = "Dạ, em chào anh/chị. Anh/chị cần được hướng dẫn thủ tục nào ạ?"
    agent_timezone: str = "Asia/Ho_Chi_Minh"
    web_search_enabled: bool = True
    web_search_model: str = "gemini-3.1-flash-lite"
    web_search_timeout_seconds: float = Field(8, ge=2, le=30)
    ocr_model: str = "gemini-2.5-flash"
    avatar_mode: Literal["photo", "flashhead"] = "photo"
    avatar_renderer_url: str = ""
    avatar_renderer_token: SecretStr = SecretStr("")

    @model_validator(mode="after")
    def validate_runtime(self):
        try:
            ZoneInfo(self.agent_timezone)
        except ZoneInfoNotFoundError as error:
            raise ValueError("AGENT_TIMEZONE must be a valid IANA time zone") from error
        if not self.livekit_url.startswith(("ws://", "wss://")):
            raise ValueError("LIVEKIT_URL must use ws:// or wss://")
        if self.avatar_renderer_url:
            parsed = urlsplit(self.avatar_renderer_url)
            if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                    or parsed.username or parsed.password or parsed.query or parsed.fragment):
                raise ValueError("AVATAR_RENDERER_URL must be an HTTP(S) address without credentials")
        if self.llm_provider == "local" and not self.llm_base_url:
            raise ValueError("LLM_BASE_URL is required for the local LLM provider")
        if self.app_env == "production":
            if len(self.app_access_token.get_secret_value()) < 32:
                raise ValueError("APP_ACCESS_TOKEN must have at least 32 characters in production")
            if self.livekit_api_key == "devkey" or len(self.livekit_api_secret.get_secret_value()) < 32:
                raise ValueError("Production requires non-development LiveKit credentials")
            if not self.livekit_url.startswith("wss://"):
                raise ValueError("Production requires a wss:// LIVEKIT_URL")
            if "*" in self.origins:
                raise ValueError("Production requires explicit ALLOWED_ORIGINS")
        return self

    @property
    def origins(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]

    @property
    def internal_livekit_url(self) -> str:
        return self.livekit_server_url or self.livekit_url

    @property
    def missing_configuration(self) -> list[str]:
        missing = []
        if self.avatar_mode == "flashhead":
            if not self.avatar_renderer_url:
                missing.append("AVATAR_RENDERER_URL")
            if len(self.avatar_renderer_token.get_secret_value()) < 32:
                missing.append("AVATAR_RENDERER_TOKEN (32+ characters)")
        if not self.soniox_api_key.get_secret_value():
            missing.append("SONIOX_API_KEY")
        if self.llm_provider == "gemini" and not self.gemini_api_key.get_secret_value():
            missing.append("GEMINI_API_KEY")
        if self.llm_provider == "openai" and not self.openai_api_key.get_secret_value():
            if not (self.llm_base_url and self.llm_allow_no_key):
                missing.append("OPENAI_API_KEY")
        return missing

    def prompt(self) -> str:
        return (ROOT / self.agent_prompt_file).read_text(encoding="utf-8")

    @property
    def can_search_web(self) -> bool:
        return self.web_search_enabled and bool(self.gemini_api_key.get_secret_value())


@lru_cache
def get_settings() -> Settings:
    return Settings()
