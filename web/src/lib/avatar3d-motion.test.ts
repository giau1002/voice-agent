import { describe, expect, it } from 'vitest';
import { AvatarBodyMotion, AvatarFaceMotion, jawTarget } from './avatar3d-motion';
import { mapAvatarMorph } from './avatar3d';

const speech = { speaking: true, level: .05, motion: true, intensity: 1, reduced: false };

describe('3D facial articulation', () => {
  it('applies jaw gain once and preserves bilabial closures', () => {
    expect(jawTarget({ AA: .4 }, .8, 1.5)).toBeCloseTo(.48);
    expect(jawTarget({ MBP: 1 }, 1, 1.8)).toBe(0);
    expect(jawTarget({ rest: 1 }, 1, 1.8)).toBe(0);
    expect(jawTarget({ AA: 1 }, 1, 1.8)).toBe(1);
  });

  it('keeps actual jaw velocity bounded and settles closed after playback', () => {
    const face = new AvatarFaceMotion();
    const dt = 1 / 60;
    let previous = 0, current = 0;
    for (let step = 0; step < 150; step++) {
      const frame = face.update({ weights: { AA: 1 }, articulation: 1, jaw: 1.5, speaking: step < 90 }, dt);
      current = frame.opening;
      expect(Math.abs(current - previous) / dt).toBeLessThanOrEqual(4.51);
      previous = current;
    }
    expect(current).toBeLessThan(.001);
  });

  it('closes on M/B/P during ongoing audible speech', () => {
    const face = new AvatarFaceMotion();
    for (let step = 0; step < 60; step++) face.update({ weights: { AA: 1 }, articulation: 1, jaw: 1.5, speaking: true }, 1 / 60);
    let closed = 1;
    for (let step = 0; step < 30; step++) closed = face.update({ weights: { MBP: .7, rest: .3 }, articulation: 1, jaw: 1.5, speaking: true }, 1 / 60).opening;
    expect(closed).toBeLessThan(.002);
  });

  it('maps exported MPFB ARKit and Meta morph names', () => {
    expect(mapAvatarMorph('jawOpen')).toBe('jawOpen');
    expect(mapAvatarMorph('MHB_faceunits01_eyeBlinkLeft')).toBe('eyeBlinkLeft');
    expect(mapAvatarMorph('mouthSmile_R')).toBe('mouthSmileRight');
    expect(mapAvatarMorph('viseme_aa')).toBe('viseme:AA:aa');
    expect(mapAvatarMorph('viseme_PP')).toBe('viseme:MBP:pp');
    expect(mapAvatarMorph('vrc.v_ou')).toBe('viseme:OO:ou');
    expect(mapAvatarMorph('unrelatedBodyShape')).toBeNull();
  });
});

describe('3D body motion', () => {
  it('inserts a still hold between bounded speech gestures', () => {
    const motion = new AvatarBodyMotion(() => .5);
    motion.update(0, 1 / 60, speech);
    let a = motion.update(0, 1 / 60, speech), b = a;
    for (let now = 0; now <= 2000; now += 20) {
      b = motion.update(now, .02, speech);
      expect(Math.abs(b.pitch)).toBeLessThan(.07);
      expect(Math.abs(b.yaw)).toBeLessThan(.08);
      expect(Math.abs(b.roll)).toBeLessThan(.04);
      if (now === 1600) a = b;
    }
    expect(b.yaw).toBeCloseTo(a.yaw, 10);
    expect(b.pitch).toBeCloseTo(a.pitch, 10);
  });

  it('blinks every2–3seconds and promptly reopens the eyes', () => {
    const motion = new AvatarBodyMotion(() => .5);
    motion.update(0, .02, speech);
    expect(motion.update(2400, .02, speech).blink).toBe(0);
    expect(motion.update(2500, .02, speech).blink).toBe(0);
    expect(motion.update(2570, .02, speech).blink).toBe(1);
    expect(motion.update(2710, .02, speech).blink).toBe(0);
    motion.update(5000, .02, speech);
    expect(motion.update(5070, .02, speech).blink).toBe(1);
  });

  it('eases bones to rest when reduced motion is requested', () => {
    const motion = new AvatarBodyMotion(() => .7);
    motion.update(0, .02, speech); motion.update(1500, .02, speech);
    motion.update(1520, .02, { ...speech, reduced: true });
    const rest = motion.update(2300, .02, { ...speech, reduced: true });
    expect(rest.pitch).toBe(0); expect(rest.yaw).toBe(0); expect(rest.roll).toBe(0);
    expect(rest.chestPitch).toBe(0); expect(rest.chestRoll).toBe(0);
  });
});
