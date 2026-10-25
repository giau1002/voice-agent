"""Cache only the configured public greeting, never user speech or replies."""
import hashlib
import json
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

import aiohttp
from livekit import rtc

from .config import ROOT, Settings
from .providers import build_tts

RATE = 24000
CACHE_DIR = ROOT / '.cache/greetings'
MAX_SAMPLES = RATE * 30


@dataclass(frozen=True)
class GreetingAudio:
    pcm: bytes

    async def frames(self):
        # New frames for each session; the immutable PCM is safe to reuse.
        step = RATE // 50 * 2
        for offset in range(0, len(self.pcm), step):
            data = self.pcm[offset:offset+step]
            yield rtc.AudioFrame(data, RATE, 1, len(data)//2)


def cache_path(settings: Settings, directory: Path | None = None) -> Path:
    identity = {
        'version': 1, 'provider': 'soniox', 'sample_rate': RATE,
        'text': settings.agent_greeting, 'model': settings.soniox_tts_model,
        'voice': settings.soniox_tts_voice, 'language': settings.soniox_tts_language,
        'speed': settings.soniox_tts_speed,
    }
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    return (directory if directory is not None else CACHE_DIR) / f'{digest}.wav'


def load_greeting(settings: Settings, directory: Path | None = None) -> GreetingAudio | None:
    if not settings.agent_greeting.strip():
        return None
    try:
        with wave.open(str(cache_path(settings, directory)), 'rb') as audio:
            samples = audio.getnframes()
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, RATE, 'NONE'):
                return None
            if not 0 < samples <= MAX_SAMPLES:
                return None
            pcm = audio.readframes(samples)
            if len(pcm) != samples*2:
                return None
            return GreetingAudio(pcm)
    except (OSError, EOFError, wave.Error):
        return None  # Missing/bad cache falls back to ordinary live TTS.


async def prepare_greeting(settings: Settings, directory: Path | None = None) -> GreetingAudio | None:
    cached = load_greeting(settings, directory)
    if cached or not settings.agent_greeting.strip():
        return cached
    async with aiohttp.ClientSession() as http:
        provider = build_tts(settings, http_session=http)
        try:
            async with provider.synthesize(settings.agent_greeting) as stream:
                frame = await stream.collect()
        finally:
            await provider.aclose()
    if (frame.sample_rate, frame.num_channels) != (RATE, 1) or not 0 < frame.samples_per_channel <= MAX_SAMPLES:
        raise ValueError('Unexpected greeting audio format or duration')
    pcm = bytes(frame.data)
    if len(pcm) != frame.samples_per_channel*2:
        raise ValueError('Invalid greeting PCM')
    path = cache_path(settings, directory)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix='.wav', delete=False) as output:
            temporary = Path(output.name)
            with wave.open(output, 'wb') as audio:
                audio.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
                audio.writeframes(pcm)
        temporary.replace(path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return GreetingAudio(pcm)
