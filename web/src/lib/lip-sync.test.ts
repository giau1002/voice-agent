import { describe, expect, it, vi } from 'vitest';
import { LipSync } from './lip-sync';

const rest = () => ({ rest: 1, AA: 0, OO: 0, MBP: 0 });
function setup(plan: Pose = { rest: 0, AA: .2, OO: .8, MBP: 0 }) {
  const start = vi.fn();
  window.PortraitCore = {
    pose: (name: string) => name === 'AA' ? { rest: 0, AA: 1, OO: 0, MBP: 0 } : rest(),
    blend: (a: Pose, b: Pose, value: number) => Object.fromEntries(Object.keys(a).map(key => [key, a[key] * (1 - value) + b[key] * value])),
    SpeechPlanner: class { start = start; sample() { return { weights: plan, articulation: .9 }; } },
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
  it('keeps quiet audible vowels visibly articulated without flattening louder speech', () => {
    const { lips } = setup({ rest: 0, AA: 1, OO: 0, MBP: 0 }); lips.pushText('a ', 0);
    const quiet = lips.sample(20, .025, true).weights.AA;
    const louder = lips.sample(40, .12, true).weights.AA;
    expect(quiet).toBeGreaterThan(.55);
    expect(louder).toBeGreaterThan(quiet);
    expect(louder).toBeLessThanOrEqual(1);
  });
  it('retains closed consonants instead of forcing all audible words open', () => {
    const { lips } = setup({ rest: 0, AA: 0, OO: 0, MBP: 1 }); lips.pushText('m ', 0);
    const sample = lips.sample(20, .1, true);
    expect(sample.weights.AA).toBe(0); expect(sample.weights.OO).toBe(0);
    expect(sample.weights.MBP).toBeGreaterThan(.5);
  });
  it('releases smoothly in a short pause and cannot prime lips from non-speaking audio', () => {
    const { lips } = setup({ rest: 0, AA: 1, OO: 0, MBP: 0 }); lips.pushText('a ', 0);
    const vowel = lips.sample(20, .1, true).weights.AA;
    expect(lips.sample(95, 0, true).weights.AA).toBeLessThan(vowel);
    expect(lips.sample(151, 0, true).weights).toEqual(rest());
    lips.sample(160, .9, false);
    expect(lips.sample(170, 0, true).weights).toEqual(rest());
  });
});
