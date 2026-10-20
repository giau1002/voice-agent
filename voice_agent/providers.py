"""Provider wiring adapted from kiosk-voice-agent; plugins register on main thread."""
from livekit.plugins import google, openai, silero, soniox

from .config import Settings


def build_stt(settings: Settings):
    return soniox.STT(
        api_key=settings.soniox_api_key.get_secret_value(),
        params=soniox.STTOptions(
            model=settings.soniox_stt_model,
            language_hints=settings.soniox_language_hints.split(","),
            max_endpoint_delay_ms=settings.soniox_max_endpoint_delay_ms,
        ),
    )


def build_tts(settings: Settings):
    return soniox.TTS(
        api_key=settings.soniox_api_key.get_secret_value(),
        model=settings.soniox_tts_model,
        voice=settings.soniox_tts_voice,
        language=settings.soniox_tts_language,
        speed=settings.soniox_tts_speed,
        sample_rate=24000,
    )


def build_llm(settings: Settings):
    if settings.llm_provider == "gemini":
        return google.LLM(
            api_key=settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_model,
            temperature=settings.llm_temperature,
        )
    return openai.LLM(
        api_key=settings.openai_api_key.get_secret_value() or "local-no-key",
        model=settings.llm_model,
        base_url=settings.llm_base_url or None,
        temperature=settings.llm_temperature,
    )


def build_vad():
    return silero.VAD.load()
