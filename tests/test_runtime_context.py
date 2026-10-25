from datetime import datetime, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from livekit.agents import Agent, ModelSettings, llm
from pydantic import ValidationError

from voice_agent.assistant import PortraitAgent
from voice_agent.config import Settings
from voice_agent.runtime_context import CONTEXT_ID, runtime_context, with_runtime_context


def settings(**kwargs):
    return Settings(_env_file=None, **kwargs)


def test_clock_uses_vietnam_day_even_when_utc_day_is_yesterday():
    text = runtime_context(settings(), datetime(2026, 10, 19, 18, 10, tzinfo=timezone.utc))
    assert "Thứ Ba, ngày 20/10/2026" in text
    assert "2026-10-20T01:10:00+07:00" in text
    assert "Hôm qua: 19/10/2026. Ngày mai: 21/10/2026." in text


def test_clock_handles_year_boundary_and_rejects_naive_injected_dates():
    text = runtime_context(settings(), datetime(2026, 12, 31, 18, tzinfo=timezone.utc))
    assert "Hôm qua: 31/12/2026. Ngày mai: 02/01/2027." in text
    with pytest.raises(ValueError, match="explicit time zone"):
        runtime_context(settings(), datetime(2026, 10, 20))
    with pytest.raises(ValidationError, match="valid IANA"):
        settings(agent_timezone="Not/AZone")


def test_context_replaces_stale_clock_without_mutating_shared_history():
    history = llm.ChatContext()
    history.add_message(role="assistant", content="Hôm nay là 22/05/2024.")
    history.add_message(role="system", content="stale-clock", id=CONTEXT_ID)
    history.add_message(role="user", content="Bạn kiểm tra lại ngày hôm nay nhé.")
    context = with_runtime_context(history, settings(), datetime(2026, 10, 20, 12, tzinfo=timezone.utc))
    assert history.get_by_id(CONTEXT_ID).text_content == "stale-clock"
    assert len([item for item in context.items if item.id == CONTEXT_ID]) == 1
    assert "20/10/2026" in context.get_by_id(CONTEXT_ID).text_content
    assert "Không xác nhận tin mới" in context.get_by_id(CONTEXT_ID).text_content


def test_agent_refreshes_clock_on_every_llm_request_including_midnight():
    agent = PortraitAgent(settings())
    context = llm.ChatContext()
    context.add_message(role="user", content="Hôm nay là ngày nào?")
    dates = [datetime(2026, 10, 20, 16, 59, tzinfo=timezone.utc),
             datetime(2026, 10, 20, 17, 1, tzinfo=timezone.utc)]
    with patch("voice_agent.runtime_context.datetime", wraps=datetime) as clock, \
            patch.object(Agent.default, "llm_node") as default:
        clock.now.side_effect = [date.astimezone(ZoneInfo("Asia/Ho_Chi_Minh")) for date in dates]
        agent.llm_node(context, [], ModelSettings())
        agent.llm_node(context, [], ModelSettings())
    assert "Thứ Ba, ngày 20/10/2026" in default.call_args_list[0].args[1].items[-1].text_content
    assert "Thứ Tư, ngày 21/10/2026" in default.call_args_list[1].args[1].items[-1].text_content
    assert len(context.items) == 1


def test_web_tool_is_only_advertised_when_configured_and_enabled():
    configured = settings(gemini_api_key="test", web_search_enabled=True)
    assert "Có công cụ search_current_information" in runtime_context(configured)
    assert "search_current_information" in [tool.info.name for tool in PortraitAgent(configured).tools]
    disabled = settings(gemini_api_key="test", web_search_enabled=False)
    assert "search_current_information" not in [tool.info.name for tool in PortraitAgent(disabled).tools]
    assert "Hiện không có công cụ tra cứu web" in runtime_context(disabled)
