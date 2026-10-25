import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { VoiceClient } from '../lib/voice-client';
import type { LipSync } from '../lib/lip-sync';
import type { Avatar3D } from '../lib/avatar3d';
import { Portrait2D, type PortraitOptions } from './Portrait2D';
import type { RemoteTrack } from 'livekit-client';
import framing from '../../public/avatar/live-framing.json';
import { waitForPortraitFrame } from '../lib/video-readiness';

export type { PortraitOptions } from './Portrait2D';
type Props = { client: VoiceClient; lips: LipSync; options: PortraitOptions; videoTrack?: RemoteTrack | null };

export function Portrait(props: Props) {
  if (props.videoTrack) return <LivePortrait track={props.videoTrack} />;
  return props.options.mode === '3d' ? <Portrait3D {...props} /> : <Portrait2D {...props} />;
}

function LivePortrait({ track }: { track: RemoteTrack }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [left, top, right, bottom] = framing.crop;
  useLayoutEffect(() => {
    const element = video.current!;
    setReady(false);
    track.attach(element);
    const stopWaiting = waitForPortraitFrame(element, () => setReady(true));
    void element.play().catch(() => { /* Muted playback normally autostarts. */ });
    return () => { stopWaiting(); track.detach(element); element.srcObject = null; };
  }, [track]);
  return <div className="portrait-wrap portrait-live" data-avatar-status={ready ? 'live' : 'loading'}>
    <div className="portrait-live-stage" style={{
      width: `max(100cqw, ${100 * framing.width / framing.height}cqh)`,
      aspectRatio: `${framing.width} / ${framing.height}`,
    }}>
      <img className="portrait-live-photo" src="/avatar/portrait.png" alt="" />
      {/* The GPU sees this entire head-and-shoulders crop. Restore its source
          coordinates rather than stretching that square over the whole person.
          The same cover transform as Portrait2D preserves framing on connection. */}
      <video ref={video} autoPlay playsInline muted
        style={{ left: `${100 * left / framing.width}%`, top: `${100 * top / framing.height}%`,
          width: `${100 * (right-left) / framing.width}%`,
          height: `${100 * (bottom-top) / framing.height}%`, opacity: ready ? 1 : 0,
          transition: ready ? 'opacity .12s' : 'none' }}
        aria-label="Nhân vật đang trò chuyện trực tiếp" />
    </div>
  </div>;
}

function Portrait3D({ client, lips, options }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const config = useRef(options); config.current = options;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usePhoto, setUsePhoto] = useState(false);

  useEffect(() => {
    if (usePhoto) return;
    let active = true, frame = 0, avatar: Avatar3D | null = null;
    let observer: ResizeObserver | null = null;
    const levels: { time: number; level: number }[] = [];
    async function setup() {
      try {
        const { Avatar3D } = await import('../lib/avatar3d');
        if (!active || !canvas.current) return;
        const next = await Avatar3D.create(canvas.current);
        if (!active) { next.dispose(); return; }
        avatar = next;
        observer = new ResizeObserver(() => avatar?.resize());
        observer.observe(canvas.current.parentElement!);
        avatar.resize();
        setLoading(false);
        let last = performance.now();
        function tick(now: number) {
          if (!active || !avatar) return;
          const dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
          const cfg = config.current;
          const level = client.meter.sample();
          levels.push({ time: now, level });
          while (levels[0]?.time < now - 400) levels.shift();
          const shifted = levels.findLast(item => item.time <= now - cfg.delay)?.level ?? 0;
          const sample = lips.sample(now - cfg.delay, shifted, client.speaking);
          avatar.update(now, dt, {
            weights: sample.weights, articulation: sample.articulation, jaw: cfg.jaw,
            speaking: client.speaking, level: shifted,
            motion: cfg.motion, intensity: cfg.intensity, reduced: document.hidden,
          });
          frame = requestAnimationFrame(tick);
        }
        frame = requestAnimationFrame(tick);
      } catch (exception) {
        if (active) {
          setError(exception instanceof Error ? exception.message : 'Không tải được nhân vật 3D.');
          setLoading(false);
        }
      }
    }
    void setup();
    return () => { active = false; cancelAnimationFrame(frame); observer?.disconnect(); avatar?.dispose(); };
  }, [client, lips, usePhoto]);

  if (usePhoto) return <Portrait2D client={client} lips={lips} options={options} />;
  return <div className="portrait-wrap portrait-3d" data-avatar-status={error ? 'error' : loading ? 'loading' : 'ready'}>
    <canvas ref={canvas} aria-label="Nhân vật trợ lý 3D chuyển động theo giọng trả lời" />
    {loading && <div className="portrait-cover"><LoaderCircle className="spin" />Đang chuẩn bị nhân vật 3D</div>}
    {error && <div className="portrait-cover error" role="alert"><span>{error}</span><button type="button" className="save-settings" onClick={() => setUsePhoto(true)}>Dùng nhân vật từ ảnh</button></div>}
  </div>;
}
