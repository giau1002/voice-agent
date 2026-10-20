import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { VoiceClient } from '../lib/voice-client';
import type { LipSync } from '../lib/lip-sync';
import { JawMotion } from '../lib/jaw-motion';

export interface PortraitOptions { motion: boolean; intensity: number; jaw: number; delay: number }
export function Portrait({ client, lips, options }: {
  client: VoiceClient; lips: LipSync; options: PortraitOptions;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const config = useRef(options); config.current = options;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true, frame = 0, renderer: RigRenderer | null = null;
    const images: HTMLImageElement[] = [];
    async function setup() {
      try {
        const loaded = await Promise.all(['portrait.png', 'colors.webp', 'flows.png', 'mouths.webp', 'character-layer.png'].map(file => new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image(); images.push(image);
          image.onload = () => resolve(image); image.onerror = () => reject(new Error('Không tải được ảnh nhân vật.'));
          image.src = `/avatar/${file}`;
        })));
        if (!alive || !canvas.current) return;
        const [photo, motionAtlas, flowAtlas, mouthAtlas, characterLayer] = loaded;
        const assets = { motionAtlas, flowAtlas, mouthAtlas, characterLayer, transparentBackground: false };
        try { renderer = new window.PortraitRendering.PortraitRenderer(canvas.current, photo, assets); }
        catch {
          const old = canvas.current, next = old.cloneNode(true) as HTMLCanvasElement;
          next.width = 280; next.height = 350;
          old.replaceWith(next); canvas.current = next;
          renderer = new window.PortraitRendering.PortraitRenderer(next, photo, { ...assets, forceSoftware: true });
        }
        setLoading(false);
        const blink = new window.PortraitCore.BlinkController({ min: 2000, max: 3000, duration: 190 });
        const motion = new window.PortraitGentleMotion.GentleMotion();
        const core = window.PortraitCore;
        const jaw = new JawMotion();
        let weights = core.pose('rest'), last = performance.now(), heardAt = -Infinity;
        let lastMotion = config.current.motion, lastIntensity = config.current.intensity;
        motion.enabled = lastMotion; motion.setIntensity(lastIntensity, last);
        const levels: { time: number; level: number }[] = [];
        function tick(now: number) {
          if (!alive || !renderer) return;
          const dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
          const cfg = config.current, level = client.meter.sample();
          if (level > .015) heardAt = now;
          levels.push({ time: now, level }); while (levels[0]?.time < now - 400) levels.shift();
          const shifted = levels.findLast(item => item.time <= now - cfg.delay)?.level ?? 0;
          const speaking = client.speaking;
          const sample = lips.sample(now - cfg.delay, shifted, speaking);
          weights = core.smoothPose(weights, sample.weights, dt);
          // Smooth the complete jaw target once. Pose smoothing still handles
          // lip width and smile, but must not add a second delay to the jaw.
          const mouthTarget = window.PortraitRendering.controls(sample.weights, 0, {
            jawDepth: cfg.jaw, articulation: sample.articulation,
          })[0];
          const mouthOpening = jaw.update(mouthTarget, dt);
          if (cfg.motion !== lastMotion) { motion.setEnabled(cfg.motion, now); lastMotion = cfg.motion; }
          if (cfg.intensity !== lastIntensity) { motion.setIntensity(cfg.intensity, now); lastIntensity = cfg.intensity; }
          const body = motion.update(now, { speaking: speaking && now - heardAt < 450, reduced: document.hidden });
          renderer.render(weights, blink.update(now), false, false, {
            ...body, jawDepth: cfg.jaw, articulation: sample.articulation, mouthOpening,
          });
          if (renderer.lost) setError('Bộ vẽ đã bị gián đoạn. Tải lại trang để khôi phục.');
          frame = requestAnimationFrame(tick);
        }
        frame = requestAnimationFrame(tick);
      } catch (exception) { if (alive) { setError(exception instanceof Error ? exception.message : 'Không tải được nhân vật.'); setLoading(false); } }
    }
    void setup();
    return () => { alive = false; cancelAnimationFrame(frame); images.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [client, lips]);

  return <div className="portrait-wrap">
    <canvas ref={canvas} width={560} height={700} aria-label="Nhân vật trợ lý chuyển động theo giọng trả lời" />
    {loading && <div className="portrait-cover"><LoaderCircle className="spin" />Đang chuẩn bị nhân vật</div>}
    {error && <div className="portrait-cover error" role="alert">{error}</div>}
  </div>;
}
