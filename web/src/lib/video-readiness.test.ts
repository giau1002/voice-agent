import { expect, it, vi } from 'vitest';
import { waitForPortraitFrame } from './video-readiness';

it('waits for a decoded frame, tolerates a stream change, and cancels the native frame callback', () => {
  let frame: VideoFrameRequestCallback = () => {};
  const video = Object.assign(document.createElement('video'), {
    requestVideoFrameCallback: vi.fn((callback: VideoFrameRequestCallback) => { frame = callback; return 7; }),
    cancelVideoFrameCallback: vi.fn(),
  });
  const ready = vi.fn();
  const pixels = new Uint8ClampedArray(16 * 16 * 4).fill(150);
  const drawImage = vi.fn().mockImplementationOnce(() => { throw new DOMException('Stream replaced'); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage, getImageData: () => ({ data: pixels }),
  } as unknown as CanvasRenderingContext2D);
  const stop = waitForPortraitFrame(video, ready);
  const tick = () => frame(0, {} as VideoFrameCallbackMetadata);
  tick(); // No decoded data yet, even though playback may already have started.
  expect(drawImage).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  Object.defineProperties(video, {
    readyState: { value: 2 }, videoWidth: { value: 512 }, videoHeight: { value: 512 },
  });
  tick(); // Transient draw failure must not reveal the video.
  expect(ready).not.toHaveBeenCalled();
  tick();
  expect(ready).toHaveBeenCalledTimes(1);
  tick();
  expect(ready).toHaveBeenCalledTimes(1);
  stop();
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
});

it('ignores a native frame callback that arrives after disconnect', () => {
  let frame: VideoFrameRequestCallback = () => {};
  const video = Object.assign(document.createElement('video'), {
    requestVideoFrameCallback: (_callback: VideoFrameRequestCallback) => { frame = _callback; return 1; },
    cancelVideoFrameCallback: vi.fn(),
  });
  const ready = vi.fn();
  const stop = waitForPortraitFrame(video, ready);
  stop();
  frame(0, {} as VideoFrameCallbackMetadata);
  expect(ready).not.toHaveBeenCalled();
});
