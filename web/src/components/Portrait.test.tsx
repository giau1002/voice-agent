import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { RemoteTrack } from 'livekit-client';
import type { VoiceClient } from '../lib/voice-client';
import type { LipSync } from '../lib/lip-sync';
import { Portrait } from './Portrait';

vi.mock('./Portrait2D', () => ({ Portrait2D: () => <div aria-label="Ảnh nhân vật" /> }));

const props = { client: {} as VoiceClient, lips: {} as LipSync,
  options: { mode: 'photo' as const, motion: true, intensity: 1, jaw: 1.5, delay: 60 } };

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

it('attaches muted live video and detaches the old track before returning to the photo', () => {
  const track = { attach: vi.fn(), detach: vi.fn() };
  const next = { attach: vi.fn(), detach: vi.fn() };
  const { rerender, unmount } = render(<Portrait {...props} videoTrack={track as unknown as RemoteTrack} />);
  const video = screen.getByLabelText('Nhân vật đang trò chuyện trực tiếp') as HTMLVideoElement;
  expect(track.attach).toHaveBeenCalledWith(video);
  expect(video.muted).toBe(true); // audio has its own LiveKit track; do not play twice
  expect(video.playsInline).toBe(true);
  expect(screen.queryByLabelText('Ảnh nhân vật')).not.toBeInTheDocument();
  rerender(<Portrait {...props} videoTrack={next as unknown as RemoteTrack} />);
  expect(track.detach).toHaveBeenCalledWith(video);
  expect(next.attach).toHaveBeenCalledWith(video);
  rerender(<Portrait {...props} videoTrack={null} />);
  expect(next.detach).toHaveBeenCalledWith(video);
  expect(screen.getByLabelText('Ảnh nhân vật')).toBeInTheDocument();
  unmount();
});

it('keeps the photo through playing and black frames, then resets on a replacement track', () => {
  let nextFrame: FrameRequestCallback | undefined;
  let now = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { nextFrame = callback; return 1; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { nextFrame = undefined; });
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage, getImageData: () => ({ data: pixels }),
  } as unknown as CanvasRenderingContext2D);
  const track = { attach: vi.fn(), detach: vi.fn() };
  const { rerender, container } = render(<Portrait {...props} videoTrack={track as unknown as RemoteTrack} />);
  const video = container.querySelector('video')!;
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 2 },
    videoWidth: { configurable: true, value: 512 },
    videoHeight: { configurable: true, value: 512 },
  });
  function frame() {
    const callback = nextFrame!;
    nextFrame = undefined;
    act(() => callback(now += 100));
  }
  expect(container.querySelector('.portrait-live-photo')).toBeInTheDocument();
  fireEvent.playing(video);
  expect(video).toHaveStyle({ opacity: '0' });
  frame(); // Fully black decoder startup frame.
  expect(video).toHaveStyle({ opacity: '0' });
  pixels.fill(16); // Limited-range black, also common in WebRTC.
  frame();
  expect(video).toHaveStyle({ opacity: '0' });
  pixels.fill(150);
  frame();
  expect(video).toHaveStyle({ opacity: '1' });
  expect(nextFrame).toBeUndefined(); // No ongoing pixel reads during speech.
  expect(drawImage).toHaveBeenCalledTimes(3);

  const replacement = { attach: vi.fn(), detach: vi.fn() };
  rerender(<Portrait {...props} videoTrack={replacement as unknown as RemoteTrack} />);
  expect(video).toHaveStyle({ opacity: '0', transition: 'none' });
  const staleCallback = nextFrame!;
  rerender(<Portrait {...props} videoTrack={track as unknown as RemoteTrack} />);
  act(() => staleCallback(now += 100));
  expect(video).toHaveStyle({ opacity: '0' });
  frame();
  expect(video).toHaveStyle({ opacity: '1' });
});
