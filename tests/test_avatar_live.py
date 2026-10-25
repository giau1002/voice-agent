import asyncio
import importlib.util
import io
import math
import os
import sys
import threading
import time
from array import array
from datetime import timedelta
from pathlib import Path
from unittest.mock import Mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from livekit import api, rtc
from livekit.agents import Agent, AgentSession, room_io
from PIL import Image

from voice_agent.avatar import FlashHeadOutput, RendererClient
from voice_agent.avatar_wire import FRAMES, SAMPLES, Pictures, pack, unpack

KIT = Path(__file__).resolve().parents[1]/'deploy/avatar-flashhead'


def jpeg():
    buffer = io.BytesIO()
    Image.new('RGB', (512, 512), '#cedeed').save(buffer, 'JPEG')
    return buffer.getvalue()


def test_wire_rejects_corrupt_or_truncated_response():
    packet = pack(Pictures(3, SAMPLES, 42, [jpeg()]*FRAMES))
    result = unpack(packet)
    assert (result.epoch, result.offset, result.valid) == (3, SAMPLES, 42)
    for bad in [packet[:-1], packet+b'extra', b'BAD!'+packet[4:], b'']:
        with pytest.raises(ValueError):
            unpack(bad)


@pytest.fixture
def service(monkeypatch):
    monkeypatch.syspath_prepend(str(KIT))
    spec = importlib.util.spec_from_file_location('flashhead_service_test', KIT/'service.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


async def test_http_auth_single_lease_and_real_client_decode(service):
    class Renderer(service.Renderer):
        def render_packet(self, epoch, offset, valid, pcm):
            return pack(Pictures(epoch, offset, valid, [jpeg()]*FRAMES))
    renderer = Renderer(Mock())
    token = 'test-token-'*4
    server = TestServer(service.create_app(token, renderer))
    async with TestClient(server) as client:
        assert (await client.post('/sessions')).status == 401
        remote = RendererClient(str(server.make_url('')).rstrip('/'), token)
        await remote.start()
        headers = {'Authorization': f'Bearer {token}'}
        assert (await client.post('/sessions', headers=headers)).status == 409
        decoded = await remote.render(0, 0, bytes(SAMPLES*2), SAMPLES)
        assert len(decoded) == FRAMES
        assert len(decoded[0]) == 512*512*3
        assert (await client.post(f'/sessions/{remote.lease}/render', headers=headers,
                                 params={'epoch': 0, 'offset': 0, 'valid': 1},
                                 data=b'bad')).status == 400
        assert (await client.post('/sessions/invalid/render', headers=headers,
                                 params={'epoch': 0, 'offset': 0, 'valid': 1},
                                 data=bytes(SAMPLES*2))).status == 410
        await remote.aclose()
        assert (await client.post('/sessions', headers=headers)).status == 200


async def test_cancelling_request_does_not_release_gpu_lock_early(service):
    entered, release = threading.Event(), threading.Event()
    class Renderer(service.Renderer):
        def render_packet(self, *args):
            entered.set()
            release.wait(5)
            return b'done'
    renderer = Renderer(Mock())
    lease = await renderer.acquire()
    task = asyncio.create_task(renderer.render(lease, 0, 0, 1, bytes(SAMPLES*2)))
    try:
        await asyncio.to_thread(entered.wait, 2)
        task.cancel()
        await asyncio.sleep(0.02)
        assert renderer.lock.locked()
        task.cancel()  # a repeated shutdown signal cannot release native work
        await asyncio.sleep(0.02)
        assert renderer.lock.locked()
    finally:
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert not renderer.lock.locked()


async def test_gpu_request_headers_are_ordered_but_downloads_overlap():
    second_request = asyncio.Event()
    offsets = []
    image = jpeg()
    async def acquire(request):
        return web.json_response({'lease': 'test-lease'})
    async def render(request):
        offset = int(request.query['offset'])
        offsets.append(offset)
        response = web.StreamResponse(headers={'Content-Type': 'application/octet-stream'})
        await response.prepare(request)
        if offset == 0:
            # The next GPU request must reach the server before the previous
            # network body finishes. Serial model+download would deadlock here.
            await asyncio.wait_for(second_request.wait(), 2)
        else:
            second_request.set()
        packet = pack(Pictures(0, offset, SAMPLES, [image]*FRAMES))
        await response.write(packet)
        await response.write_eof()
        return response
    async def release(request):
        return web.Response(status=204)
    app = web.Application()
    app.router.add_post('/sessions', acquire)
    app.router.add_post('/sessions/{lease}/render', render)
    app.router.add_delete('/sessions/{lease}', release)
    async with TestClient(TestServer(app)) as server:
        remote = RendererClient(str(server.make_url('')).rstrip('/'), 'test-key')
        await remote.start()
        try:
            frames = await asyncio.wait_for(asyncio.gather(
                remote.render(0, 0, bytes(SAMPLES*2), SAMPLES),
                remote.render(0, SAMPLES, bytes(SAMPLES*2), SAMPLES)), 4)
            assert offsets == [0, SAMPLES]
            assert all(len(batch) == FRAMES for batch in frames)
        finally:
            await remote.aclose()


class Audio:
    queued_duration = 0
    def __init__(self):
        self.frames = []
        self.cleared = 0
    async def capture_frame(self, frame):
        self.frames.append(bytes(frame.data))
    def clear_queue(self):
        self.cleared += 1
    async def wait_for_playout(self):
        pass
    async def aclose(self):
        pass


class Video:
    def __init__(self):
        self.frames = []
    def capture_frame(self, frame):
        self.frames.append(frame)
    async def aclose(self):
        pass


class Remote:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.requests = []
    async def render(self, epoch, offset, pcm, valid):
        self.requests.append((epoch, offset, pcm, valid))
        self.started.set()
        await self.release.wait()
        return [bytes(512*512*3)]*24
    async def aclose(self):
        pass


def start_output(output):
    output.tasks = [asyncio.create_task(output._guard(output._produce)),
                    asyncio.create_task(output._guard(output._collect)),
                    asyncio.create_task(output._guard(output._video_loop)),
                    asyncio.create_task(output._guard(output._play))]


@pytest.mark.parametrize('interrupt_before_speech', [False, True])
async def test_greeting_does_not_wait_behind_prefetched_idle_chunks(interrupt_before_speech):
    remote, audio, video, failure = Remote(), Audio(), Video(), Mock()
    output = FlashHeadOutput(remote, audio, video, failure, wait_for_speech=True)
    start_output(output)
    try:
        await asyncio.sleep(0.04)
        assert not remote.requests and not audio.frames
        if interrupt_before_speech:
            output.clear_buffer()
        pcm = b'\x11\x00'*800
        await output.capture_frame(rtc.AudioFrame(pcm, 16000, 1, 800))
        output.flush()
        await asyncio.wait_for(remote.started.wait(), 1)
        assert remote.requests[0][0] == (1 if interrupt_before_speech else 0)
        assert remote.requests[0][2].startswith(pcm)  # First GPU work is speech.
        remote.release.set()
        event = await asyncio.wait_for(output.wait_for_playout(), 3)
        assert event.playback_position == pytest.approx(.05)
        assert not event.interrupted
        failure.assert_not_called()
    finally:
        await output.aclose()


async def test_audio_waits_for_video_and_partial_tail_reports_true_duration():
    remote, audio, video, failure = Remote(), Audio(), Video(), Mock()
    output = FlashHeadOutput(remote, audio, video, failure)
    finished, started = [], []
    output.on('playback_finished', finished.append)
    output.on('playback_started', started.append)
    pcm = b'\x11\x00'*800
    await output.capture_frame(rtc.AudioFrame(pcm, 16000, 1, 800))
    output.flush()
    start_output(output)
    try:
        await asyncio.wait_for(remote.started.wait(), 1)
        assert not audio.frames and not started
        remote.release.set()
        event = await asyncio.wait_for(output.wait_for_playout(), 3)
        assert event.playback_position == pytest.approx(0.05)
        assert not event.interrupted
        assert len(finished) == 1 and len(started) == 1
        assert b''.join(audio.frames).startswith(pcm)
        assert len(video.frames) >= 24
        failure.assert_not_called()
    finally:
        await output.aclose()


async def test_interrupt_drops_inflight_old_epoch_and_unblocks_backpressure():
    remote, audio, video = Remote(), Audio(), Video()
    output = FlashHeadOutput(remote, audio, video, Mock())
    # More than the 3-chunk TTS bound must block instead of growing memory.
    captured = asyncio.create_task(output.capture_frame(
        rtc.AudioFrame(b'\x01\x00'*(SAMPLES*5), 16000, 1, SAMPLES*5)))
    await asyncio.sleep(0.01)
    assert not captured.done()
    start_output(output)
    await asyncio.wait_for(remote.started.wait(), 1)
    output.clear_buffer()
    await asyncio.wait_for(captured, 1)
    event = await output.wait_for_playout()
    assert event.interrupted and event.playback_position == 0
    remote.release.set()
    await asyncio.sleep(0.08)
    assert all(not any(frame) for frame in audio.frames)
    assert remote.requests[-1][0] == 1
    await output.aclose()


async def test_renderer_failure_finishes_segment_instead_of_hanging():
    class Failed(Remote):
        async def render(self, *args):
            raise TimeoutError('test')
    failure = Mock()
    output = FlashHeadOutput(Failed(), Audio(), Video(), failure)
    await output.capture_frame(rtc.AudioFrame(bytes(1600), 16000, 1, 800))
    output.flush()
    start_output(output)
    try:
        event = await asyncio.wait_for(output.wait_for_playout(), 1)
        assert event.interrupted
        failure.assert_called_once()
    finally:
        await output.aclose()


async def test_interrupt_during_silence_tail_preserves_spoken_position():
    remote, audio, video = Remote(), Audio(), Video()
    output = FlashHeadOutput(remote, audio, video, Mock())
    await output.capture_frame(rtc.AudioFrame(bytes(1600), 16000, 1, 800))
    output.flush()
    segment = output.segments[0]
    # 120 ms sent, comprising 50 ms of speech and 70 ms of padding. A queued
    # 40 ms silence frame must not truncate the already-spoken words to 10 ms.
    segment.played, segment.submitted = 800, 1920
    segment.source_start = 0
    output.source_submitted = 1920
    output.playing = segment
    audio.queued_duration = 0.04
    output.clear_buffer()
    event = await output.wait_for_playout()
    assert event.playback_position == pytest.approx(0.05)
    assert event.interrupted
    await output.aclose()


async def test_interrupt_does_not_count_speech_still_queued_behind_idle():
    output = FlashHeadOutput(Remote(), Audio(), Video(), Mock())
    await output.capture_frame(rtc.AudioFrame(bytes(3200), 16000, 1, 1600))
    output.flush()
    segment = output.segments[0]
    segment.played, segment.submitted, segment.source_start = 1600, 1600, 10000
    output.source_submitted = 11600
    output.audio.queued_duration = 0.24  # playhead 7760, before the speech begins
    output.clear_buffer()
    event = await output.wait_for_playout()
    assert event.playback_position == 0 and event.interrupted
    await output.aclose()


async def test_native_audio_queue_keeps_headroom_across_video_chunks():
    class BufferedAudio:
        def __init__(self):
            self.source = rtc.AudioSource(16000, 1, queue_size_ms=240)
            self.before = []
        @property
        def queued_duration(self):
            return self.source.queued_duration
        async def capture_frame(self, frame):
            self.before.append(self.queued_duration)
            await self.source.capture_frame(frame)
        def clear_queue(self):
            self.source.clear_queue()
        async def wait_for_playout(self):
            await self.source.wait_for_playout()
        async def aclose(self):
            await self.source.aclose()
    class BusyVideo(Video):
        def capture_frame(self, frame):
            # Ordinary picture work must not make the audio device wait for the
            # next 40 ms picture before receiving more samples.
            time.sleep(0.015)
            super().capture_frame(frame)
    remote, audio, video, failure = Remote(), BufferedAudio(), BusyVideo(), Mock()
    remote.release.set()
    output = FlashHeadOutput(remote, audio, video, failure)
    await output.capture_frame(rtc.AudioFrame(bytes(SAMPLES*2*3), 16000, 1, SAMPLES*3))
    output.flush()
    start_output(output)
    try:
        event = await asyncio.wait_for(output.wait_for_playout(), 6)
        assert event.playback_position == pytest.approx(2.88)
        # 48 × 20 ms audio frames per generated chunk. The first sample of the
        # next chunk must be submitted BEFORE the preceding sound runs out.
        assert audio.before[48] > 0.08
        assert audio.before[96] > 0.08
        failure.assert_not_called()
    finally:
        await output.aclose()


@pytest.mark.skipif(not os.getenv('VOICE_TEST_LIVEKIT_URL'), reason='Opt-in real LiveKit transport')
async def test_real_livekit_publishes_avatar_audio_and_video(service):
    """Real HTTP/JPEG + real WebRTC; deterministic pictures, no CUDA or paid TTS."""
    url = os.environ['VOICE_TEST_LIVEKIT_URL']
    room_name = 'avatar-smoke-'+os.urandom(6).hex()
    user, agent = rtc.Room(), rtc.Room()
    audio_received, video_received = asyncio.Event(), asyncio.Event()
    tasks = []
    failures = Mock()
    output = None
    session = None

    @user.on('track_subscribed')
    def subscribed(track, publication, participant):
        async def consume():
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
                try:
                    async for event in stream:
                        if max(map(abs, event.frame.data), default=0) > 1000:
                            audio_received.set()
                            break
                finally:
                    await stream.aclose()
            else:
                stream = rtc.VideoStream(track)
                try:
                    async for event in stream:
                        if event.frame.width == 512 and event.frame.height == 512:
                            video_received.set()
                            break
                finally:
                    await stream.aclose()
        tasks.append(asyncio.create_task(consume()))

    def token(identity, kind):
        return (api.AccessToken('devkey', 'devsecret').with_identity(identity)
                .with_kind(kind).with_ttl(timedelta(minutes=2))
                .with_grants(api.VideoGrants(room_join=True, room=room_name)).to_jwt())

    class Renderer(service.Renderer):
        def render_packet(self, epoch, offset, valid, pcm):
            return pack(Pictures(epoch, offset, valid, [jpeg()]*FRAMES))

    renderer_token = 'local-transport-test-'*3
    renderer_server = TestServer(service.create_app(renderer_token, Renderer(Mock())))
    async with TestClient(renderer_server):
        try:
            await user.connect(url, token('viewer', 'standard'))
            await agent.connect(url, token('avatar-agent', 'agent'))
            output = await FlashHeadOutput.connect(
                agent, str(renderer_server.make_url('')).rstrip('/'), renderer_token, failures)
            session = AgentSession(use_tts_aligned_transcript=False)
            session.output.audio = output
            await session.start(agent=Agent(instructions='Transport test only'), room=agent,
                                room_options=room_io.RoomOptions(
                                    participant_identity='viewer', audio_input=False,
                                    audio_output=False, video_input=False,
                                    text_output=room_io.TextOutputOptions(sync_transcription=True)))

            async def synthesized_audio():
                # Real AgentSession must resample 24 kHz TTS to the 16 kHz sink.
                for start in range(0, 23040, 480):
                    pcm = array('h', [int(6000*math.sin(2*math.pi*440*i/24000))
                                      for i in range(start, start+480)])
                    yield rtc.AudioFrame(pcm.tobytes(), 24000, 1, 480)

            speech = session.say('Đây là kiểm tra đường truyền.', audio=synthesized_audio())
            await asyncio.wait_for(asyncio.gather(audio_received.wait(), video_received.wait()), 15)
            await asyncio.wait_for(speech.wait_for_playout(), 8)
            event = await output.wait_for_playout()
            assert not event.interrupted
            assert event.playback_position == pytest.approx(0.96)
            assert set(p.name for p in output.publications) == {'avatar-audio', 'avatar-video'}
            failures.assert_not_called()
        finally:
            if session:
                await session.aclose()
            if output:
                await output.aclose()
            await user.disconnect()
            await agent.disconnect()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            async with api.LiveKitAPI(url=url, api_key='devkey', api_secret='devsecret') as client:
                await client.room.delete_room(api.DeleteRoomRequest(room=room_name))
