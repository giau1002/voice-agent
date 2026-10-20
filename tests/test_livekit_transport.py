"""Opt-in smoke test against a real self-hosted LiveKit server.

Run with VOICE_TEST_LIVEKIT_URL=ws://127.0.0.1:17880.
This verifies transport, not paid Soniox/Gemini services or browser playback.
"""
import asyncio
import math
import os
from array import array
from datetime import timedelta

import pytest
from livekit import api, rtc

from voice_agent.api import make_token
from voice_agent.config import Settings

URL = os.getenv("VOICE_TEST_LIVEKIT_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="Set VOICE_TEST_LIVEKIT_URL for real WebRTC test")


@pytest.mark.asyncio
async def test_real_room_text_audio_and_cleanup():
    settings = Settings(_env_file=None, app_env="test", livekit_url=URL,
                        livekit_api_key=os.getenv("VOICE_TEST_LIVEKIT_KEY", "devkey"),
                        livekit_api_secret=os.getenv("VOICE_TEST_LIVEKIT_SECRET", "devsecret"))
    room_name = "smoke-" + os.urandom(6).hex()
    user, peer = rtc.Room(), rtc.Room()
    received_text = asyncio.Future()
    received_audio = asyncio.Future()
    tasks: list[asyncio.Task] = []

    def read_text(reader, identity):
        async def consume():
            text = await reader.read_all()
            if not received_text.done():
                received_text.set_result(text)
        tasks.append(asyncio.create_task(consume()))

    user.register_text_stream_handler("lk.transcription", read_text)

    @user.on("track_subscribed")
    def subscribed(track, publication, participant):
        async def read_audio():
            stream = rtc.AudioStream(track, sample_rate=24000, num_channels=1)
            try:
                async for event in stream:
                    values = array("h", event.frame.data.tobytes())
                    if values and max(abs(value) for value in values) > 500:
                        if not received_audio.done():
                            received_audio.set_result(len(values))
                        break
            finally:
                await stream.aclose()
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            tasks.append(asyncio.create_task(read_audio()))

    async with api.LiveKitAPI(url=URL, api_key=settings.livekit_api_key,
                              api_secret=settings.livekit_api_secret.get_secret_value()) as service:
        try:
            await service.room.create_room(api.CreateRoomRequest(name=room_name))
            # No named worker is required for this isolated transport check.
            participant_token = make_token(settings, room_name, "smoke-user", "Smoke user")
            peer_token = (
                api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret.get_secret_value())
                .with_identity("smoke-peer").with_ttl(timedelta(minutes=2))
                .with_grants(api.VideoGrants(room_join=True, room=room_name)).to_jwt()
            )
            await user.connect(URL, participant_token)
            await peer.connect(URL, peer_token)
            await peer.local_participant.send_text("Xin chào từ LiveKit", topic="lk.transcription")
            assert await asyncio.wait_for(received_text, 10) == "Xin chào từ LiveKit"

            source = rtc.AudioSource(24000, 1)
            track = rtc.LocalAudioTrack.create_audio_track("synthetic-test-audio", source)
            await peer.local_participant.publish_track(track)
            await asyncio.sleep(.5)
            for frame_index in range(60):
                pcm = array("h", [int(6000 * math.sin(2 * math.pi * 440 * (frame_index * 480 + i) / 24000)) for i in range(480)])
                await source.capture_frame(rtc.AudioFrame(
                    data=pcm.tobytes(), sample_rate=24000, num_channels=1, samples_per_channel=480,
                ))
            assert await asyncio.wait_for(received_audio, 10) > 0
            await source.aclose()
        finally:
            await user.disconnect()
            await peer.disconnect()
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await service.room.delete_room(api.DeleteRoomRequest(room=room_name))
