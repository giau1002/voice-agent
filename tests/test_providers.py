from unittest.mock import patch

import pytest
from livekit.agents import AgentSession

from voice_agent.config import Settings
from voice_agent.providers import build_llm, build_stt, build_tts


@pytest.mark.asyncio
async def test_installed_plugin_contracts_and_session_options():
    settings = Settings(_env_file=None, soniox_api_key="test", gemini_api_key="test")
    stt, tts = build_stt(settings), build_tts(settings)
    assert stt.capabilities.streaming
    assert tts.capabilities.streaming
    session = AgentSession(stt=stt, tts=tts, turn_handling={
        "turn_detection": "stt", "interruption": {"enabled": True, "min_duration": .45},
    })
    assert session is not None
    await stt.aclose()
    await tts.aclose()


def test_local_llm_provider_is_explicitly_configurable():
    settings = Settings(_env_file=None, llm_provider="local", llm_base_url="http://127.0.0.1:11434/v1", llm_model="local-model")
    with patch("voice_agent.providers.openai.LLM") as llm:
        build_llm(settings)
    assert llm.call_args.kwargs["base_url"] == settings.llm_base_url
    assert llm.call_args.kwargs["api_key"] == "local-no-key"
