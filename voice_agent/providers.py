"""Provider wiring adapted from kiosk-voice-agent; plugins register on main thread."""
from livekit.plugins import google, openai, silero, soniox

from .config import Settings
from .gemini import fast_thinking_config


def build_stt(settings: Settings):
    return soniox.STT(
        api_key=settings.soniox_api_key.get_secret_value(),
        params=soniox.STTOptions(
            model=settings.soniox_stt_model,
            language_hints=settings.soniox_language_hints.split(","),
            max_endpoint_delay_ms=settings.soniox_max_endpoint_delay_ms,
        ),
    )


def build_tts(settings: Settings, *, http_session=None):
    return soniox.TTS(
        api_key=settings.soniox_api_key.get_secret_value(),
        model=settings.soniox_tts_model,
        voice=settings.soniox_tts_voice,
        language=settings.soniox_tts_language,
        speed=settings.soniox_tts_speed,
        sample_rate=24000,
        http_session=http_session,
    )


def build_llm(settings: Settings):
    if settings.llm_provider == "gemini":
        thinking = fast_thinking_config(settings.gemini_model) if settings.gemini_fast_responses else None
        return google.LLM(
            api_key=settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_model,
            temperature=settings.llm_temperature,
            **({"thinking_config": thinking} if thinking is not None else {}),
        )
    return openai.LLM(
        api_key=settings.openai_api_key.get_secret_value() or "local-no-key",
        model=settings.llm_model,
        base_url=settings.llm_base_url or None,
        temperature=settings.llm_temperature,
    )


def build_vad():
    return silero.VAD.load()
