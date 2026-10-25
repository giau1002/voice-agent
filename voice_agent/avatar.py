"""FlashHead HTTP renderer + paced LiveKit A/V output, one GPU lease per room."""
import asyncio
import io
import logging
import statistics
import time
from collections import deque
from dataclasses import dataclass, field

import aiohttp
from livekit import rtc
from livekit.agents.voice import io as agent_io
from PIL import Image

from .avatar_wire import FPS, HEIGHT, MAX_PACKET, RATE, SAMPLES, WIDTH, unpack

logger = logging.getLogger(__name__)


class AvatarError(RuntimeError):
    pass


class RendererClient:
    def __init__(self, url, token):
        self.url = url.rstrip('/')
        self.token = token
        self.http = None
        self.lease = None
        self.order = asyncio.Lock()
        self.timings = deque(maxlen=60)

    async def start(self):
        self.http = aiohttp.ClientSession(
            headers={'Authorization': f'Bearer {self.token}'},
            timeout=aiohttp.ClientTimeout(total=15, connect=5),
        )
        try:
            async with self.http.post(self.url+'/sessions', allow_redirects=False) as response:
                if response.status != 200:
                    raise AvatarError(f'Avatar unavailable ({response.status})')
                result = await response.json()
                self.lease = result['lease']
                if not isinstance(self.lease, str) or not self.lease.replace('-', '').replace('_', '').isalnum():
                    raise AvatarError('Invalid avatar lease')
        except BaseException:
            await self.http.close()
            raise

    async def render(self, epoch, offset, pcm, valid):
        started = time.perf_counter()
        # The server advances its motion state before sending response headers.
        # Submit the next chunk after those headers, while this JPEG body is still
        # downloading. Keep GPU requests ordered without serializing the download.
        async with self.order:
            submitted = time.perf_counter()
            response = await self.http.post(
                f'{self.url}/sessions/{self.lease}/render', data=pcm,
                params={'epoch': str(epoch), 'offset': str(offset), 'valid': str(valid)},
                allow_redirects=False,
            )
        headers_received = time.perf_counter()
        async with response:
            if response.status != 200:
                raise AvatarError(f'Avatar render unavailable ({response.status})')
            data = bytearray()
            async for block in response.content.iter_chunked(65536):
                data.extend(block)
                if len(data) > MAX_PACKET:
                    raise AvatarError('Oversized avatar response')
        downloaded = time.perf_counter()
        pictures = unpack(bytes(data))
        if (pictures.epoch, pictures.offset, pictures.valid) != (epoch, offset, valid):
            raise AvatarError('Avatar timing mismatch')
        frames = await asyncio.to_thread(self.decode, pictures.frames)
        self.timings.append({
            'offset': offset, 'bytes': len(data),
            'order_wait_ms': round((submitted-started)*1000),
            'headers_ms': round((headers_received-submitted)*1000),
            'download_ms': round((downloaded-headers_received)*1000),
            'decode_ms': round((time.perf_counter()-downloaded)*1000),
        })
        return frames

    @staticmethod
    def decode(frames):
        decoded = []
        for frame in frames:
            with Image.open(io.BytesIO(frame)) as image:
                if image.size != (WIDTH, HEIGHT):
                    raise AvatarError('Unexpected avatar dimensions')
                decoded.append(image.convert('RGB').tobytes())
        return decoded

    async def aclose(self):
        if self.http:
            try:
                if self.lease:
                    async with self.http.delete(
                        f'{self.url}/sessions/{self.lease}', allow_redirects=False,
                        timeout=aiohttp.ClientTimeout(total=3),
                    ):
                        pass
            except (aiohttp.ClientError, TimeoutError):
                pass  # lease automatically expires on the GPU after 90s
            finally:
                await self.http.close()


@dataclass(eq=False)
class Segment:
    data: bytearray = field(default_factory=bytearray)
    closed: bool = False
    started: bool = False
    played: int = 0
    submitted: int = 0
    source_start: int | None = None
    finished: bool = False


@dataclass
class Batch:
    epoch: int
    frames: list[bytes]
    pcm: bytes
    valid: int
    segment: Segment | None
    last: bool


@dataclass
class Pending:
    batch: Batch
    task: asyncio.Task | None


@dataclass
class VideoItem:
    epoch: int
    pixels: bytes
    segment: Segment | None


class FlashHeadOutput(agent_io.AudioOutput):
    """Own both media sources so original TTS never plays ahead of its pictures.

    Two future chunks are allowed; no unbounded RGB/TTS queues. The renderer retains
    motion through silence and normal turns. clear_buffer invalidates in-flight
    requests, stops audio immediately and releases SDK playback waiters.
    """
    def __init__(self, renderer, audio_source, video_source, on_failure, *, wait_for_speech=False):
        super().__init__(label='FlashHead', sample_rate=RATE,
                         capabilities=agent_io.AudioOutputCapabilities(pause=False))
        self.renderer = renderer
        self.audio = audio_source
        self.video = video_source
        self.on_failure = on_failure
        self.epoch = 0
        self.offset = 0
        self.segments = deque()
        self.generating = deque()
        self.current = None
        self.changed = asyncio.Event()
        self.space = asyncio.Event()
        self.space.set()
        self.ready = asyncio.Queue(maxsize=2)
        self.rendering = asyncio.Queue(maxsize=2)
        self.video_frames = asyncio.Queue(maxsize=5)
        self.slot = asyncio.Semaphore(2)
        self.requests = set()
        self.tasks = []
        self.closed = False
        self.failed = False
        self.playing = None
        self.source_submitted = 0
        self.publications = []
        self.video_underruns = 0
        self.max_video_gap_ms = 0
        # Do not render/prefetch seconds of silence in front of the greeting.
        # The source portrait remains visible until the first speech pictures.
        self.wait_for_speech = wait_for_speech
        self.connected_at = time.perf_counter()
        self.first_pcm_at = None
        self.first_speech_logged = False

    @classmethod
    async def connect(cls, room, url, token, on_failure, *, wait_for_speech=False):
        renderer = RendererClient(url, token)
        await renderer.start()
        audio = rtc.AudioSource(RATE, 1, queue_size_ms=240)
        video = rtc.VideoSource(WIDTH, HEIGHT)
        output = cls(renderer, audio, video, on_failure, wait_for_speech=wait_for_speech)
        try:
            for track, source in [
                (rtc.LocalAudioTrack.create_audio_track('avatar-audio', audio),
                 rtc.TrackSource.SOURCE_MICROPHONE),
                (rtc.LocalVideoTrack.create_video_track('avatar-video', video),
                 rtc.TrackSource.SOURCE_CAMERA),
            ]:
                options = rtc.TrackPublishOptions(source=source, stream='avatar')
                if track.kind == rtc.TrackKind.KIND_VIDEO:
                    options.video_encoding.max_framerate = FPS
                    options.video_encoding.max_bitrate = 2_500_000
                    options.simulcast = False
                publication = await room.local_participant.publish_track(track, options)
                output.publications.append(publication)
            await asyncio.wait_for(asyncio.gather(
                *(publication.wait_for_subscription() for publication in output.publications)), 10)
            output.tasks = [asyncio.create_task(output._guard(output._produce)),
                            asyncio.create_task(output._guard(output._collect)),
                            asyncio.create_task(output._guard(output._video_loop)),
                            asyncio.create_task(output._guard(output._play))]
            return output
        except BaseException:
            await output.aclose()
            for publication in output.publications:
                await room.local_participant.unpublish_track(publication.sid)
            raise

    async def capture_frame(self, frame):
        if self.closed or self.failed:
            raise AvatarError('Avatar output closed')
        if frame.sample_rate != RATE or frame.num_channels != 1:
            raise AvatarError('Expected 16kHz mono from AgentSession resampler')
        if not frame.samples_per_channel:
            return
        if self.first_pcm_at is None:
            self.first_pcm_at = time.perf_counter()
        epoch = self.epoch
        while self.current is None and len(self.segments) >= 4:
            self.space.clear()
            await self.space.wait()
            if epoch != self.epoch or self.closed or self.failed:
                return
        await super().capture_frame(frame)
        if self.current is None:
            self.current = Segment()
            self.segments.append(self.current)
            self.generating.append(self.current)
        segment = self.current
        data = bytes(frame.data)
        for start in range(0, len(data), SAMPLES*2):
            block = data[start:start+SAMPLES*2]
            while sum(len(item.data) for item in self.segments) + len(block) > SAMPLES*2*3:
                self.space.clear()
                if epoch != self.epoch or self.closed or self.failed:
                    return
                await self.space.wait()
            if epoch != self.epoch or self.closed or self.failed:
                return
            segment.data.extend(block)
            self.changed.set()

    def flush(self):
        super().flush()
        if self.current:
            self.current.closed = True
            self.current = None
            self.changed.set()

    def clear_buffer(self):
        super().flush()  # reset SDK capturing flag for the next turn
        self.epoch += 1
        self.offset = 0
        # Audio may be queued ahead of the displayed picture, including speech
        # behind an idle chunk. Count what reached the native playhead, not what
        # has merely been submitted or belongs to the current video segment.
        playhead = max(0, self.source_submitted - round(self.audio.queued_duration*RATE))
        for segment in self.segments:
            segment.played = (min(segment.played, max(0, playhead-segment.source_start))
                              if segment.source_start is not None else 0)
        self.audio.clear_queue()
        self.source_submitted = 0
        for segment in tuple(self.segments):
            self._finish(segment, True)
        self.generating.clear()
        self.current = None
        # Do not cancel native GPU work. Its result is discarded by epoch check.
        while not self.ready.empty():
            self.ready.get_nowait()
            self.slot.release()
        while not self.video_frames.empty():
            self.video_frames.get_nowait()
            self.video_frames.task_done()
        self.space.set()
        self.changed.set()

    def _finish(self, segment, interrupted):
        if segment.finished:
            return
        segment.finished = True
        if segment in self.segments:
            self.segments.remove(segment)
        self.on_playback_finished(playback_position=segment.played/RATE,
                                  interrupted=interrupted)
        self.space.set()

    async def _produce(self):
        while not self.closed:
            await self.slot.acquire()
            epoch = self.epoch
            while self.wait_for_speech and not self.generating:
                self.changed.clear()
                await self.changed.wait()
            segment = self.generating[0] if self.generating else None
            if segment:
                self.wait_for_speech = False
            # Short non-final chunks wait for more TTS instead of inserting
            # synthetic gaps into speech. Existing idle frames may finish meanwhile.
            while segment and len(segment.data) < SAMPLES*2 and not segment.closed:
                self.changed.clear()
                await self.changed.wait()
                if epoch != self.epoch:
                    break
            if epoch != self.epoch:
                self.slot.release()
                continue
            last = False
            if segment:
                pcm = bytes(segment.data[:SAMPLES*2])
                del segment.data[:len(pcm)]
                valid = len(pcm)//2
                last = segment.closed and not segment.data
                if last:
                    self.generating.popleft()
                self.space.set()
                if not valid:
                    # flush may arrive after the last full chunk was rendered;
                    # the marker must remain ordered behind that chunk's playout.
                    await self.rendering.put(Pending(Batch(epoch, [], b'', 0, segment, True), None))
                    continue
                pcm = pcm.ljust(SAMPLES*2, b'\0')
            else:
                pcm, valid = bytes(SAMPLES*2), SAMPLES
            offset = self.offset
            self.offset += SAMPLES
            request = asyncio.create_task(self.renderer.render(epoch, offset, pcm, valid))
            self.requests.add(request)
            request.add_done_callback(self._request_done)
            await self.rendering.put(Pending(Batch(epoch, [], pcm, valid, segment, last), request))

    def _request_done(self, task):
        self.requests.discard(task)
        if not task.cancelled():
            # A later pipelined request may fail while _collect handles an earlier
            # failure. Consume it here as well; awaiting it still raises normally.
            task.exception()

    async def _collect(self):
        while not self.closed:
            pending = await self.rendering.get()
            batch = pending.batch
            if pending.task:
                batch.frames = await pending.task
            if batch.epoch != self.epoch:
                self.slot.release()
                continue
            await self.ready.put(batch)

    async def _play(self):
        first = True
        while not self.closed:
            batch = await self.ready.get()
            self.slot.release()  # permit at most two prefetched/in-flight chunks
            if batch.epoch != self.epoch:
                continue
            if first:
                # Small startup cushion; subsequent audio uses the native source
                # clock instead of repeatedly draining a 40 ms frame to zero.
                first = False
                await asyncio.sleep(0.18)
            if batch.epoch != self.epoch:
                continue
            await asyncio.gather(self._queue_video(batch), self._queue_audio(batch))
            if batch.last and batch.epoch == self.epoch:
                await self.audio.wait_for_playout()
                await self.video_frames.join()
                if batch.epoch == self.epoch:
                    self._finish(batch.segment, False)

    async def _queue_video(self, batch):
        for pixels in batch.frames:
            if batch.epoch != self.epoch or self.closed:
                break
            await self.video_frames.put(VideoItem(batch.epoch, pixels, batch.segment))

    async def _queue_audio(self, batch):
        # The native queue paces audio and keeps up to 240 ms ready to play.
        # Submit the next chunk while the preceding video frames are still queued.
        # Waiting for each displayed picture before sending its audio caused the
        # audio device to run dry after every scheduler/network delay.
        step = RATE//50  # 20 ms; fine-grained cancellation and playback position
        for start in range(0, len(batch.pcm)//2, step):
            if batch.epoch != self.epoch or self.closed:
                break
            samples = min(step, len(batch.pcm)//2-start)
            if batch.segment and batch.segment.source_start is None:
                batch.segment.source_start = self.source_submitted
            await self.audio.capture_frame(rtc.AudioFrame(
                batch.pcm[start*2:(start+samples)*2], RATE, 1, samples))
            if batch.epoch != self.epoch:
                self.audio.clear_queue()
                break
            self.source_submitted += samples
            if batch.segment:
                batch.segment.submitted += samples
                batch.segment.played += max(0, min(samples, batch.valid-start))

    async def _video_loop(self):
        loop = asyncio.get_running_loop()
        deadline = None
        epoch = self.epoch
        while not self.closed:
            item = await self.video_frames.get()
            try:
                if item.epoch != self.epoch:
                    continue
                if epoch != self.epoch:
                    epoch, deadline = self.epoch, None
                now = loop.time()
                if deadline is None:
                    deadline = now
                elif now-deadline > 0.08:
                    gap_ms = round((now-deadline)*1000)
                    self.video_underruns += 1
                    self.max_video_gap_ms = max(self.max_video_gap_ms, gap_ms)
                    logger.warning('Avatar frame input delayed by %d ms', gap_ms)
                    deadline = now
                await asyncio.sleep(max(0, deadline-loop.time()))
                if item.epoch != self.epoch or self.closed:
                    continue
                self.playing = item.segment
                if item.segment and not item.segment.started:
                    item.segment.started = True
                    if not self.first_speech_logged:
                        self.first_speech_logged = True
                        now = time.perf_counter()
                        logger.info('Avatar first speech ready', extra={
                            'avatar_first_pcm_ms': round((self.first_pcm_at-self.connected_at)*1000),
                            'avatar_first_speech_ms': round((now-self.connected_at)*1000),
                        })
                    self.on_playback_started(created_at=time.time())
                self.video.capture_frame(rtc.VideoFrame(
                    WIDTH, HEIGHT, rtc.VideoBufferType.RGB24, item.pixels))
                deadline += 1/FPS
            finally:
                self.video_frames.task_done()

    async def _guard(self, function):
        try:
            await function()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if not self.failed and not self.closed:
                logger.warning('Avatar output stopped (%s)', type(error).__name__)
                self.failed = True
                self.clear_buffer()
                # Fail the session explicitly; never send raw provider URLs/tokens.
                self.on_failure()
            for task in self.tasks:
                if task is not asyncio.current_task():
                    task.cancel()
            for task in self.requests:
                task.cancel()

    async def aclose(self):
        if self.closed:
            return
        self.closed = True
        timings = list(getattr(self.renderer, 'timings', []))
        logger.info('Avatar playout summary', extra={
            'avatar_frame_underruns': self.video_underruns,
            'avatar_max_frame_gap_ms': self.max_video_gap_ms,
            'avatar_render_chunks': len(timings),
            'avatar_download_median_ms': round(statistics.median(
                [t['download_ms'] for t in timings])) if timings else 0,
        })
        self.clear_buffer()
        for task in self.tasks:
            task.cancel()
        requests = tuple(self.requests)
        for task in requests:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await asyncio.gather(*requests, return_exceptions=True)
        await self.renderer.aclose()
        await self.audio.aclose()
        await self.video.aclose()
