import { describe, expect, it } from 'vitest';
import { JawMotion } from './jaw-motion';

describe('final jaw movement', () => {
  it('suppresses rapid articulation flutter while preserving a held open vowel', () => {
    const jaw = new JawMotion();
    for (let i = 0; i < 60; i++) jaw.update(.7, 1 / 60);
    const outputs = Array.from({ length: 60 }, (_, i) => jaw.update(i % 2 ? .82 : .58, 1 / 60));
    expect(Math.max(...outputs) - Math.min(...outputs)).toBeLessThan(.05);
    expect(outputs.reduce((sum, value) => sum + value, 0) / outputs.length).toBeCloseTo(.7, 1);
  });

  it('eases open and closed without losing the selected opening or leaving the jaw moving', () => {
    const jaw = new JawMotion();
    expect(jaw.update(.8, 1 / 60)).toBeLessThan(.02);
    let opening = 0;
    for (let i = 0; i < 18; i++) opening = jaw.update(.8, 1 / 60);
    expect(opening).toBeGreaterThan(.75);
    expect(opening).toBeLessThanOrEqual(.8);
    const firstClosingFrame = jaw.update(0, 1 / 60);
    expect(opening - firstClosingFrame).toBeLessThan(.03);
    for (let i = 0; i < 30; i++) opening = jaw.update(0, 1 / 60);
    expect(opening).toBeLessThan(.001);
  });

  it('has similar timing at 30, 60 and 120 fps and stays bounded during dropped frames', () => {
    const results = [30, 60, 120].map(fps => {
      const jaw = new JawMotion();
      let opening = 0;
      for (let i = 0; i < fps / 5; i++) opening = jaw.update(.85, 1 / fps);
      return opening;
    });
    expect(Math.max(...results) - Math.min(...results)).toBeLessThan(.005);
    const jaw = new JawMotion();
    for (const target of [1, 0, 1, 0]) {
      const opening = jaw.update(target, 5);
      expect(opening).toBeGreaterThanOrEqual(0);
      expect(opening).toBeLessThanOrEqual(1);
    }
  });
});
