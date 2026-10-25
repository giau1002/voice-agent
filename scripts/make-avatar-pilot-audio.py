"""Generate one short Vietnamese QA utterance using the configured Soniox voice."""
import asyncio
import json
import sys
import wave
from pathlib import Path

import aiohttp
from livekit.plugins import soniox

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from voice_agent.config import get_settings  # noqa: E402 - standalone script entry point

TEXT = 'Em chào anh chị. Hôm nay em rất vui được gặp anh chị. Anh chị cứ nói chậm rãi, em đang lắng nghe ạ.'


async def main():
    settings = get_settings()
    dest = ROOT / '.tools/avatar-pilot'
    dest.mkdir(exist_ok=True, parents=True)
    async with aiohttp.ClientSession() as http:
        tts = soniox.TTS(api_key=settings.soniox_api_key.get_secret_value(),
                         model=settings.soniox_tts_model, voice=settings.soniox_tts_voice,
                         language='vi', sample_rate=24000, speed=settings.soniox_tts_speed,
                         http_session=http)
        try:
            with wave.open(str(dest / 'speech-vi.wav'), 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(24000)
                async with tts.synthesize(TEXT) as stream:
                    async for packet in stream:
                        wav.writeframes(bytes(packet.frame.data))
        finally:
            await tts.aclose()
    with wave.open(str(dest / 'speech-vi.wav')) as wav:
        duration = wav.getnframes() / wav.getframerate()
    if not 2 < duration < 25:
        raise RuntimeError(f'Unexpected speech duration: {duration}')
    (dest / 'speech-vi.json').write_text(json.dumps({
        'text': TEXT, 'provider': 'Soniox', 'model': settings.soniox_tts_model,
        'voice': settings.soniox_tts_voice, 'seconds': duration,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Vietnamese QA speech saved: {duration:.2f} seconds')


if __name__ == '__main__':
    asyncio.run(main())
