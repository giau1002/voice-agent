import { describe, expect, it, vi } from 'vitest';
import { LipSync } from './lip-sync';

const rest = () => ({ rest: 1, AA: 0, OO: 0 });
function setup() {
  const start = vi.fn();
  window.PortraitCore = {
    pose: (name: string) => name === 'AA' ? { rest: 0, AA: 1, OO: 0 } : rest(),
    blend: (a: Pose, b: Pose, value: number) => Object.fromEntries(Object.keys(a).map(key => [key, a[key] * (1 - value) + b[key] * value])),
    SpeechPlanner: class { start = start; sample() { return { weights: { rest: 0, AA: .2, OO: .8 }, articulation: .9 }; } },
  } as unknown as Window['PortraitCore'];
  return { lips: new LipSync(), start };
}
describe('audio-gated text articulation', () => {
  it('never moves lips without received audio', () => {
    const { lips } = setup(); lips.pushText('xin chào ', 0);
    expect(lips.sample(500, 0, true).weights).toEqual(rest());
    expect(lips.sample(500, .8, false).weights).toEqual(rest());
  });
  it('combines text shapes with actual energy and stops at silence', () => {
    const { lips } = setup(); lips.pushText('xin chào ', 0);
    expect(lips.sample(20, .5, true).weights.OO).toBeGreaterThan(.5);
    expect(lips.sample(200, 0, true).weights).toEqual(rest());
  });
  it('buffers split words and flushes on final', () => {
    const { lips, start } = setup(); lips.pushText('ch', 0); expect(start).not.toHaveBeenCalled();
    lips.pushText('ào', 10); lips.pushText('', 20, true);
    expect(start).toHaveBeenCalledWith('chào', 'vi-VN', 20, 1);
  });
  it('clears old text on interruption and uses energy fallback for missing text', () => {
    const { lips } = setup(); lips.pushText('chào ', 0); lips.clear();
    const sample = lips.sample(100, .6, true);
    expect(sample.weights.OO).toBe(0); expect(sample.weights.AA).toBeGreaterThan(0);
    expect(lips.sample(110, .6, false).weights).toEqual(rest());
  });
});
