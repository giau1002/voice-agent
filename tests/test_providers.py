from unittest.mock import patch

import pytest
from livekit.agents import AgentSession

from voice_agent.config import Settings
from voice_agent.gemini import fast_thinking_config
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


@pytest.mark.parametrize(("model", "expected"), [
    ("gemini-2.5-flash", {"thinking_budget": 0}),
    ("gemini-2.5-pro", {"thinking_budget": 128}),
    ("gemini-3.1-flash-lite", {"thinking_level": "MINIMAL"}),
    ("gemini-3-pro-preview", {"thinking_level": "LOW"}),
    ("gemini-3.8-flash", {"thinking_level": "LOW"}),
])
def test_fast_thinking_uses_controls_supported_by_model_family(model, expected):
    assert fast_thinking_config(model).model_dump(exclude_none=True, mode="json") == expected


def test_unknown_models_and_opt_out_keep_provider_thinking_defaults():
    assert fast_thinking_config("custom-model") is None
    settings = Settings(_env_file=None, gemini_api_key="test", gemini_fast_responses=False)
    with patch("voice_agent.providers.google.LLM") as model:
        build_llm(settings)
    assert "thinking_config" not in model.call_args.kwargs
