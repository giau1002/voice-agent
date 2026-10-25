"""Audio boundaries and a deterministic playout model; no GPU imports.

This does not implement transport, a browser player, or LiveKit interruption.
It prevents benchmarking model FPS as if it were interactive playout latency.
"""
from dataclasses import dataclass
from math import isfinite


@dataclass(frozen=True)
class AudioChunk:
    epoch: int
    sample_offset: int
    pcm: bytes
    valid_samples: int


class PcmChunker:
    """Accept PCM16 mono, retain partial samples, and pad only at explicit EOF."""

    def __init__(self, samples_per_chunk=15360):
        if samples_per_chunk <= 0:
            raise ValueError('samples_per_chunk must be positive')
        self.samples_per_chunk = samples_per_chunk
        self.epoch = 0
        self._pending = bytearray()
        self._offset = 0
        self._finished = False

    def push(self, data: bytes):
        if self._finished:
            raise ValueError('Call reset before starting the next utterance')
        self._pending.extend(data)
        count = self.samples_per_chunk * 2
        result = []
        while len(self._pending) >= count:
            result.append(AudioChunk(self.epoch, self._offset,
                                     bytes(self._pending[:count]), self.samples_per_chunk))
            del self._pending[:count]
            self._offset += self.samples_per_chunk
        return result

    def finish(self):
        if self._finished:
            return []
        if len(self._pending) % 2:
            raise ValueError('Incomplete PCM16 sample at end of stream')
        self._finished = True
        if not self._pending:
            return []
        valid = len(self._pending) // 2
        pcm = bytes(self._pending).ljust(self.samples_per_chunk * 2, b'\0')
        self._pending.clear()
        return [AudioChunk(self.epoch, self._offset, pcm, valid)]

    def reset(self):
        self.epoch += 1
        self._pending.clear()
        self._offset = 0
        self._finished = False


def playout_estimate(costs, chunk_seconds, input_realtime=True, buffer_seconds=0.12):
    """Simulate a serial generator with PCM delivered at 1x or available upfront.

    costs include feature extraction + rendering + CPU transfer. Encoding/network/
    browser costs are unknown and explicitly excluded. A late chunk shifts BOTH
    audio and video; never recommend playing audio before matching frames exist.
    """
    costs = list(costs)
    if not costs or any(not isfinite(c) or c < 0 for c in costs):
        raise ValueError('Need finite nonnegative chunk times')
    if not isfinite(chunk_seconds) or chunk_seconds <= 0:
        raise ValueError('chunk_seconds must be positive and finite')
    if not isfinite(buffer_seconds) or buffer_seconds < 0:
        raise ValueError('buffer_seconds must be finite and nonnegative')
    ready = []
    previous = 0.0
    for i, cost in enumerate(costs):
        arrival = (i + 1) * chunk_seconds if input_realtime else 0.0
        previous = max(previous, arrival) + cost
        ready.append(previous)
    anchor = ready[0] + buffer_seconds
    total_stall = 0.0
    stalls = []
    for i, available in enumerate(ready):
        deadline = anchor + i * chunk_seconds + total_stall
        stall = max(0.0, available - deadline)
        stalls.append(stall)
        total_stall += stall
    required_buffer = max(0.0, max(t - ready[0] - i * chunk_seconds
                                   for i, t in enumerate(ready)))
    return {
        'scope': 'simulation; excludes encoder, network, WebRTC and browser',
        'input': 'PCM arrives at 1x realtime' if input_realtime else 'all PCM ready at t=0',
        'first_paired_av_ready_s': ready[0],
        'first_paired_playout_s': anchor,
        'buffer_s': buffer_seconds,
        'total_stall_s': total_stall,
        'stall_events': sum(s > 1e-6 for s in stalls),
        'buffer_needed_for_this_sample_s': required_buffer,
    }
