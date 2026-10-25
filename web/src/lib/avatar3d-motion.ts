import { JawMotion } from './jaw-motion';

export const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smooth = (value: number) => value ** 3 * (value * (value * 6 - 15) + 10);
const speechShapes = ['AA', 'EE', 'OH', 'OO', 'MBP', 'FV', 'TDL', 'smile'] as const;

/** Estimated text visemes, gated by received speech audio upstream. This is not
 * acoustic phoneme recognition or Audio2Face. Apply user jaw gain only here. */
export function jawTarget(weights: Pose, articulation: number, jaw: number): number {
  const opening = clamp01(weights.AA) + clamp01(weights.EE) * .5 + clamp01(weights.OH) * .78
    + clamp01(weights.OO) * .58 + clamp01(weights.FV) * .22 + clamp01(weights.TDL) * .45
    + clamp01(weights.smile) * .2;
  return clamp01(opening * clamp01(articulation) * Math.max(.6, Math.min(1.8, jaw || 1)));
}

export class AvatarFaceMotion {
  private jaw = new JawMotion();
  private weights: Pose = {};

  update(input: { weights: Pose; articulation: number; jaw: number; speaking: boolean }, dt: number) {
    const elapsed = Math.max(0, Math.min(.1, dt));
    const pose = input.speaking ? input.weights : {};
    const opening = this.jaw.update(jawTarget(pose, input.articulation, input.jaw), elapsed);
    const blend = 1 - Math.exp(-elapsed / .085);
    for (const name of speechShapes) {
      this.weights[name] = (this.weights[name] || 0) + (clamp01(pose[name]) - (this.weights[name] || 0)) * blend;
    }
    return { opening, weights: this.weights };
  }
}

interface HeadPose { pitch: number; yaw: number; roll: number }
const neutral = (): HeadPose => ({ pitch: 0, yaw: 0, roll: 0 });

/** Phrase-length gestures have an eased transition followed by a hold. Only
 * bones move: neither the camera nor the character's root is animated. */
export class AvatarBodyMotion {
  private pose = neutral();
  private from = neutral();
  private to = neutral();
  private started = -Infinity;
  private duration = 0;
  private nextGesture = 0;
  private wasSpeaking = false;
  private wasEnabled = true;
  private heardAt = -Infinity;
  private nextBlink = 0;
  private blinkStarted = -Infinity;
  private nextGaze = 0;
  private gaze = { yaw: 0, pitch: 0 };
  private gazeTarget = { yaw: 0, pitch: 0 };
  private glancing = false;

  constructor(private random: () => number = Math.random) {}

  private begin(now: number, target: HeadPose, duration: number, hold: number) {
    this.from = { ...this.pose }; this.to = target;
    this.started = now; this.duration = duration; this.nextGesture = now + duration + hold;
  }

  update(now: number, dt: number, input: { speaking: boolean; level: number; motion: boolean; intensity: number; reduced: boolean }) {
    const elapsed = Math.max(0, Math.min(.1, dt));
    if (input.speaking && input.level > .015) this.heardAt = now;
    const speaking = input.speaking && now - this.heardAt < 320;
    const enabled = input.motion && !input.reduced;
    const intensity = Math.max(.5, Math.min(1.4, input.intensity || 1));

    if (this.duration > 0) {
      const t = smooth(clamp01((now - this.started) / this.duration));
      for (const axis of ['pitch', 'yaw', 'roll'] as const) this.pose[axis] = this.from[axis] + (this.to[axis] - this.from[axis]) * t;
    }
    if (!enabled && this.wasEnabled) this.begin(now, neutral(), 600, Infinity);
    if (enabled && (!this.wasEnabled || speaking !== this.wasSpeaking || now >= this.nextGesture)) {
      if (!speaking && this.wasSpeaking) this.begin(now, neutral(), 1200, 1500);
      else {
        const strength = intensity * (speaking ? 1 : .22);
        const sign = this.random() < .5 ? -1 : 1;
        this.begin(now, {
          pitch: (this.random() - .3) * .065 * strength,
          yaw: sign * (.018 + this.random() * .036) * strength,
          roll: (this.random() - .5) * .045 * strength,
        }, (speaking ? 950 : 2000) + this.random() * 650, (speaking ? 450 : 1500) + this.random() * 1100);
      }
    }
    this.wasSpeaking = speaking; this.wasEnabled = enabled;

    if (!this.nextBlink) this.nextBlink = now + 2000 + this.random() * 1000;
    if (now >= this.nextBlink) {
      this.blinkStarted = now;
      this.nextBlink = now + 2000 + this.random() * 1000;
    }
    const blinkAge = (now - this.blinkStarted) / 190;
    const blink = blinkAge < 0 || blinkAge >= 1 ? 0
      : blinkAge < .35 ? smooth(blinkAge / .35)
        : blinkAge < .48 ? 1 : 1 - smooth((blinkAge - .48) / .52);

    if (enabled && now >= this.nextGaze) {
      this.glancing = !this.glancing;
      this.gazeTarget = this.glancing ? { yaw: (this.random() - .5) * .032, pitch: (this.random() - .5) * .018 } : { yaw: 0, pitch: 0 };
      this.nextGaze = now + (this.glancing ? 650 : 1800) + this.random() * 1200;
    }
    const gazeBlend = 1 - Math.exp(-elapsed / .10);
    this.gaze.yaw += ((enabled ? this.gazeTarget.yaw : 0) - this.gaze.yaw) * gazeBlend;
    this.gaze.pitch += ((enabled ? this.gazeTarget.pitch : 0) - this.gaze.pitch) * gazeBlend;
    const breath = enabled ? Math.sin(now * Math.PI * 2 / 4300) * .004 : 0;
    return {
      ...this.pose, blink,
      chestPitch: breath, chestRoll: enabled ? Math.sin(now * Math.PI * 2 / 7200) * .0015 : 0,
      // Eyes retain contact instead of following every head turn mechanically.
      gazeYaw: this.gaze.yaw - this.pose.yaw * .45,
      gazePitch: this.gaze.pitch - this.pose.pitch * .35,
      smile: speaking ? .045 : .08 + Math.sin(now * Math.PI * 2 / 8700) * .015,
    };
  }
}
