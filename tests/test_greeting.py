from unittest.mock import AsyncMock, Mock, PropertyMock, patch

import pytest
from livekit import rtc
from livekit.agents import Agent

from voice_agent.assistant import PortraitAgent
from voice_agent.config import Settings
from voice_agent.greeting import GreetingAudio, cache_path, load_greeting, prepare_greeting


async def test_greeting_is_synthesized_once_and_cache_tracks_all_voice_settings(tmp_path):
    settings = Settings(_env_file=None, soniox_api_key='private-test-key')
    pcm = b'\x01\x00'*2400
    stream = AsyncMock()
    stream.__aenter__.return_value = stream
    stream.collect.return_value = rtc.AudioFrame(pcm, 24000, 1, 2400)
    provider = Mock(aclose=AsyncMock(), synthesize=Mock(return_value=stream))
    with patch('voice_agent.greeting.build_tts', return_value=provider) as factory:
        assert (await prepare_greeting(settings, tmp_path)).pcm == pcm
        assert (await prepare_greeting(settings, tmp_path)).pcm == pcm
    factory.assert_called_once()
    provider.aclose.assert_awaited_once()
    assert load_greeting(settings, tmp_path).pcm == pcm
    for field, value in {
        'agent_greeting': 'Em xin chào.', 'soniox_tts_voice': 'another-voice',
        'soniox_tts_speed': 1.1, 'soniox_tts_language': 'en', 'soniox_tts_model': 'another-model',
    }.items():
        assert load_greeting(settings.model_copy(update={field: value}), tmp_path) is None
    assert 'private-test-key' not in cache_path(settings, tmp_path).name
    # A damaged cache must fall back to live TTS instead of breaking connection.
    path = cache_path(settings, tmp_path)
    path.write_bytes(path.read_bytes()[:-10])
    assert load_greeting(settings, tmp_path) is None
    path.write_bytes(b'not-a-wave-file')
    assert load_greeting(settings, tmp_path) is None


async def test_greeting_frames_are_reusable_and_keep_exact_pcm():
    audio = GreetingAudio(b'\x21\x00'*1300)
    first = [frame async for frame in audio.frames()]
    second = [frame async for frame in audio.frames()]
    assert b''.join(bytes(frame.data) for frame in first) == audio.pcm
    assert all(frame.sample_rate == 24000 and frame.num_channels == 1 for frame in first)
    assert first[0] is not second[0]


@pytest.mark.parametrize('cached', [False, True])
async def test_agent_says_matching_greeting_with_cached_audio_or_live_tts(cached):
    settings = Settings(_env_file=None)
    audio = GreetingAudio(bytes(960)) if cached else None
    session = Mock()
    with patch.object(Agent, 'session', new_callable=PropertyMock, return_value=session):
        await PortraitAgent(settings, greeting=audio).on_enter()
    session.say.assert_called_once()
    assert session.say.call_args.args == (settings.agent_greeting,)
    assert session.say.call_args.kwargs['allow_interruptions']
    frames = session.say.call_args.kwargs.get('audio')
    if cached:
        assert b''.join([bytes(frame.data) async for frame in frames]) == audio.pcm
    else:
        assert frames is None
