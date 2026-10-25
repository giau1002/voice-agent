"""Single-session resident GPU renderer. Only the voice worker calls this API."""
import argparse
import asyncio
import hmac
import io
import json
import logging
import secrets
import time
from pathlib import Path

from aiohttp import web

try:  # the packaging script copies the canonical protocol into the standalone kit
    from avatar_wire import FRAMES, HEIGHT, SAMPLES, WIDTH, Pictures, pack
except ModuleNotFoundError:
    from voice_agent.avatar_wire import FRAMES, HEIGHT, SAMPLES, WIDTH, Pictures, pack

ROOT = Path(__file__).resolve().parent
log = logging.getLogger('avatar-renderer')


class Renderer:
    def __init__(self, engine):
        self.engine = engine
        self.lock = asyncio.Lock()
        self.lease = None
        self.touched = 0.0

    async def run(self, function, *args):
        # Cancelling an HTTP request must NOT release the GPU lock while its
        # native CUDA work continues in the executor thread.
        task = asyncio.create_task(asyncio.to_thread(function, *args))
        cancelled = None
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError as error:
                # Shutdown or a second cancellation must not cancel the task
                # wrapper either: Python cannot stop the native executor thread.
                cancelled = error
        if cancelled is not None:
            if not task.cancelled():
                task.exception()  # consume an exception from the discarded work
            raise cancelled
        return task.result()

    async def acquire(self):
        async with self.lock:
            if self.lease and time.monotonic() - self.touched < 90:
                raise web.HTTPConflict(text='Avatar is serving another session')
            await self.run(self.engine.reset, 0)
            self.lease = secrets.token_urlsafe(24)
            self.touched = time.monotonic()
            return self.lease

    def authorize_lease(self, lease):
        if not self.lease or not hmac.compare_digest(lease, self.lease):
            raise web.HTTPGone(text='Avatar session expired')
        self.touched = time.monotonic()

    async def release(self, lease):
        async with self.lock:
            self.authorize_lease(lease)
            self.lease = None

    def render_packet(self, epoch, offset, valid, pcm):
        from PIL import Image
        from streaming import AudioChunk

        if epoch < self.engine.epoch:
            raise ValueError('Old epoch')
        if epoch > self.engine.epoch:
            if offset != 0:
                raise ValueError('New epoch must begin at zero')
            # Keep the generated pose when a turn is interrupted. New leases
            # reset the full state so no movement/audio cache crosses users.
            self.engine.reset(epoch, preserve_motion=True)
        result = self.engine.render(AudioChunk(epoch, offset, pcm, valid))
        frames = []
        for frame in result.frames:
            encoded = io.BytesIO()
            Image.fromarray(frame).save(encoded, 'JPEG', quality=94, subsampling=0)
            frames.append(encoded.getvalue())
        return pack(Pictures(epoch, offset, valid, frames))

    async def render(self, lease, epoch, offset, valid, pcm):
        async with self.lock:
            self.authorize_lease(lease)
            return await self.run(self.render_packet, epoch, offset, valid, pcm)


def load_engine():
    from assets import prepare_source, verify, verify_models
    from engine import FlashHeadEngine
    from PIL import Image
    from streaming import AudioChunk

    manifest = json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
    inputs = json.loads((ROOT/'inputs/manifest.json').read_text(encoding='utf-8'))
    prepare_source(ROOT, manifest)
    verify_models(ROOT, manifest)
    verify(ROOT/'inputs/portrait.png', inputs['portrait'])
    portrait = ROOT/'.runtime/live-portrait.png'
    with Image.open(ROOT/'inputs/portrait.png') as image:
        image.convert('RGB').crop(tuple(inputs['portrait_crop'])).resize(
            (WIDTH, HEIGHT), Image.Resampling.LANCZOS).save(portrait)
    engine = FlashHeadEngine(ROOT, portrait)
    engine.render(AudioChunk(0, 0, bytes(SAMPLES*2), SAMPLES))
    engine.reset(0)
    return engine


def create_app(token, renderer=None):
    if len(token) < 32:
        raise ValueError('Renderer token must contain at least 32 characters')

    @web.middleware
    async def auth(request, handler):
        supplied = request.headers.get('Authorization', '').removeprefix('Bearer ')
        if not hmac.compare_digest(supplied, token):
            raise web.HTTPUnauthorized()
        try:
            return await handler(request)
        except (ValueError, KeyError):
            raise web.HTTPBadRequest(text='Invalid avatar request') from None
        except web.HTTPException:
            raise
        except Exception:
            log.exception('Avatar render failed')
            raise web.HTTPServiceUnavailable(text='Avatar render failed') from None

    app = web.Application(middlewares=[auth], client_max_size=SAMPLES*2+1024)
    key = web.AppKey('renderer', Renderer)

    async def startup(_app):
        app[key] = renderer or Renderer(await asyncio.to_thread(load_engine))
        log.info('FlashHead ready: one session, 512x512, 25 FPS')

    app.on_startup.append(startup)

    async def health(request):
        return web.json_response({'ready': True, 'protocol': 'FHA1', 'fps': 25,
                                  'sample_rate': 16000, 'frames': FRAMES})

    async def acquire(request):
        return web.json_response({'lease': await app[key].acquire()})

    async def release(request):
        await app[key].release(request.match_info['lease'])
        return web.Response(status=204)

    async def render(request):
        pcm = await request.read()
        epoch, offset, valid = (int(request.query[name]) for name in ('epoch', 'offset', 'valid'))
        if (len(pcm) != SAMPLES*2 or not 0 <= epoch < 2**32
                or not 0 <= offset < 2**63 or not 0 < valid <= SAMPLES):
            raise ValueError('Invalid PCM/timing')
        packet = await app[key].render(request.match_info['lease'], epoch, offset, valid, pcm)
        return web.Response(body=packet, content_type='application/octet-stream')

    app.router.add_get('/health', health)
    app.router.add_post('/sessions', acquire)
    app.router.add_delete('/sessions/{lease}', release)
    app.router.add_post('/sessions/{lease}/render', render)
    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8890)
    args = parser.parse_args()
    token_path = ROOT/'.runtime/renderer-token.txt'
    token_path.parent.mkdir(parents=True, exist_ok=True)
    if not token_path.exists():
        token_path.write_text(secrets.token_urlsafe(32), encoding='ascii')
    token = token_path.read_text(encoding='ascii').strip()
    logging.basicConfig(level=logging.INFO)
    print(f'Renderer token file: {token_path} (keep private)', flush=True)
    web.run_app(create_app(token), host=args.host, port=args.port, access_log=None)


if __name__ == '__main__':
    main()
