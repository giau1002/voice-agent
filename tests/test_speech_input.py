import logging
from unittest.mock import patch

from livekit import rtc
from livekit.agents import Agent, ModelSettings, stt

from voice_agent.assistant import PortraitAgent
from voice_agent.config import Settings


async def test_microphone_frames_and_final_transcript_pass_without_logging_speech(caplog):
    agent = PortraitAgent(Settings(_env_file=None))
    frames = [rtc.AudioFrame(bytes(640), 16000, 1, 320),
              rtc.AudioFrame(b'\x00\x10' * 320, 16000, 1, 320)]
    captured = []
    text = "Thông tin riêng của người dùng thử"
    final = stt.SpeechEvent(type=stt.SpeechEventType.FINAL_TRANSCRIPT,
                            alternatives=[stt.SpeechData(language="vi", text=text)])

    async def input_audio():
        for frame in frames:
            yield frame

    async def recognize(_agent, audio, _settings):
        async for frame in audio:
            captured.append(frame)
        yield final

    with caplog.at_level(logging.INFO, logger="voice_agent.assistant"), \
            patch.object(Agent.default, "stt_node", recognize):
        events = [event async for event in agent.stt_node(input_audio(), ModelSettings())]
    assert captured == frames
    assert events == [final]
    assert "Microphone signal detected" in caplog.text
    assert "Speech recognition finalized" in caplog.text
    assert text not in caplog.text


async def test_closing_recognition_node_closes_the_underlying_provider():
    agent = PortraitAgent(Settings(_env_file=None))
    closed = False

    async def input_audio():
        if False:
            yield

    async def recognize(_agent, audio, _settings):
        nonlocal closed
        try:
            yield stt.SpeechEvent(type=stt.SpeechEventType.START_OF_SPEECH)
        finally:
            closed = True

    with patch.object(Agent.default, "stt_node", recognize):
        stream = agent.stt_node(input_audio(), ModelSettings())
        await anext(stream)
        await stream.aclose()
    assert closed
