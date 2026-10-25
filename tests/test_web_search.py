import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.genai import types

from voice_agent.config import Settings
from voice_agent.web_search import SearchResult, grounded_result, make_search_tool, search_web


def provider_response(with_sources=True):
    return types.GenerateContentResponse.model_validate({"candidates": [{
        "content": {"role": "model", "parts": [{"text": "Kết quả đã được tra cứu."}]},
        "grounding_metadata": {
            "grounding_chunks": [
                {"web": {"uri": "https://example.gov.vn/topic", "title": "Nguồn chính thức"}},
                {"web": {"uri": "https://example.gov.vn/topic", "title": "Duplicate"}},
                {"web": {"uri": "javascript:alert(1)", "title": "Unsafe"}},
            ] if with_sources else [],
            "search_entry_point": {"rendered_content": '<div><a href="https://google.com/search?q=test">Google</a></div>'},
        },
    }]})


def test_grounding_requires_evidence_and_keeps_display_markup_out_of_model():
    result = grounded_result(provider_response(), "câu hỏi", "2026-10-20T19:00:00+07:00")
    assert result.status == "ok"
    assert result.sources == [{"title": "Nguồn chính thức", "url": "https://example.gov.vn/topic"}]
    assert "Google" in result.suggestions_html
    assert "suggestions_html" not in result.for_model()
    assert grounded_result(provider_response(False), "câu hỏi", "now").status == "unverified"
    assert grounded_result(types.GenerateContentResponse(), "câu hỏi", "now").status == "unverified"


@pytest.mark.asyncio
@pytest.mark.parametrize("fast_search", [False, True])
async def test_search_uses_builtin_google_search_and_does_not_return_or_log_key(caplog, fast_search):
    settings = Settings(_env_file=None, web_search_enabled=True, gemini_api_key="private-test-key",
                        web_search_fast_responses=fast_search)
    api = MagicMock()
    api.models.generate_content = AsyncMock(return_value=provider_response())
    client = MagicMock()
    client.aio.__aenter__.return_value = api
    with patch("voice_agent.web_search.genai.Client", return_value=client):
        result = await search_web(settings, "thông tin mới tại Việt Nam")
    assert result.status == "ok"
    kwargs = api.models.generate_content.call_args.kwargs
    assert kwargs["config"].tools[0].google_search is not None
    if fast_search:
        assert kwargs["config"].thinking_config.thinking_level == "MINIMAL"
    else:
        assert kwargs["config"].thinking_config is None
    assert "Múi giờ: Asia/Ho_Chi_Minh" in kwargs["config"].system_instruction
    assert result.checked_at.endswith("+07:00")
    assert "private-test-key" not in str(result.for_model()) + caplog.text


@pytest.mark.asyncio
async def test_search_failure_is_explicit_and_does_not_leak_provider_exception(caplog):
    settings = Settings(_env_file=None, web_search_enabled=True, gemini_api_key="private-test-key")
    with patch("voice_agent.web_search.genai.Client", side_effect=RuntimeError("secret-url?key=private-test-key")):
        result = await search_web(settings, "thời tiết tại Hà Nội")
    assert result.status == "error"
    assert "private-test-key" not in str(result.for_model()) + caplog.text
    assert "secret-url" not in str(result.for_model()) + caplog.text


@pytest.mark.asyncio
async def test_disabled_or_invalid_search_never_calls_provider():
    with patch("voice_agent.web_search.genai.Client") as provider:
        assert (await search_web(Settings(_env_file=None), "câu hỏi")).status == "unavailable"
        assert (await search_web(Settings(_env_file=None), " ")).status == "invalid_query"
    provider.assert_not_called()


@pytest.mark.asyncio
async def test_tool_publishes_verified_sources_without_failing_if_room_is_closed():
    result = SearchResult("ok", "câu hỏi", "Trả lời", [{"title": "Nguồn", "url": "https://example.vn"}], "<div>Google</div>")
    publish = AsyncMock(side_effect=RuntimeError("room closed"))
    tool = make_search_tool(Settings(_env_file=None), publish)
    with patch("voice_agent.web_search.search_web", return_value=result):
        output = await tool(query="câu hỏi")
    publish.assert_awaited_once_with(result)
    assert output["answer"] == "Trả lời"
    assert "suggestions_html" not in output


@pytest.mark.asyncio
async def test_lookup_deadline_cancels_provider_without_leaking_or_retrying():
    cancelled = asyncio.Event()

    async def stalled(**kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    api = MagicMock()
    api.models.generate_content = AsyncMock(side_effect=stalled)
    client = MagicMock()
    client.aio.__aenter__.return_value = api
    settings = Settings(_env_file=None, web_search_enabled=True, gemini_api_key="test")
    # Production validation keeps this >=2s; shorten the test's clock only.
    settings.web_search_timeout_seconds = 0.01
    with patch("voice_agent.web_search.genai.Client", return_value=client) as factory:
        result = await search_web(settings, "thời tiết tại Hà Nội")
    assert result.status == "error"
    assert not result.sources
    assert cancelled.is_set()
    api.models.generate_content.assert_awaited_once()
    assert factory.call_args.kwargs["http_options"].retry_options.attempts == 1
    assert factory.call_args.kwargs["http_options"].timeout >= 10000
    client.aio.__aexit__.assert_awaited_once()


@pytest.mark.asyncio
async def test_tool_reuses_only_recent_verified_results_in_its_own_room():
    settings = Settings(_env_file=None, web_search_enabled=True, gemini_api_key="test")
    publish = AsyncMock()
    room_a = make_search_tool(settings, publish)
    room_b = make_search_tool(settings)
    verified = SearchResult("ok", "query", "answer", [{"url": "https://example.gov.vn"}])
    now = 100
    with patch("voice_agent.web_search.search_web", AsyncMock(return_value=verified)) as lookup, \
            patch("voice_agent.web_search.time.monotonic", side_effect=lambda: now):
        await room_a(query="  THỜI TIẾT  HÀ NỘI ")
        await room_a(query="thời tiết hà nội")
        assert lookup.await_count == 1
        assert publish.await_count == 2
        await room_b(query="thời tiết hà nội")
        assert lookup.await_count == 2
        now += 91
        await room_a(query="thời tiết hà nội")
        assert lookup.await_count == 3


@pytest.mark.asyncio
async def test_failed_and_cancelled_lookups_are_not_cached():
    tool = make_search_tool(Settings(_env_file=None, web_search_enabled=True, gemini_api_key="test"))
    failed = SearchResult("error", "query")
    with patch("voice_agent.web_search.search_web", AsyncMock(side_effect=[
        failed, asyncio.CancelledError(), failed,
    ])) as lookup:
        await tool(query="thời tiết hà nội")
        with pytest.raises(asyncio.CancelledError):
            await tool(query="thời tiết hà nội")
        await tool(query="thời tiết hà nội")
    assert lookup.await_count == 3
