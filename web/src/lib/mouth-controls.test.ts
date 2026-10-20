/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { LipSync } from './lip-sync';

function loadAsset(file: string) {
  const sandbox = { module: { exports: {} as any } };
  runInNewContext(readFileSync(`${process.cwd()}/public/avatar/${file}`, 'utf8'), sandbox);
  return sandbox.module.exports;
}
const renderer = loadAsset('continuous-renderer.js');

it('opens quiet spoken vowels deeper using the actual planner and renderer controls', () => {
  const core = loadAsset('core.js');
  window.PortraitCore = core;
  for (const [text, time, minimum] of [['a ', 150, .7], ['em ', 60, .3]] as const) {
    const lips = new LipSync(); lips.pushText(text, 0, true);
    const sample = lips.sample(time, .025, true);
    const values = renderer.controls(sample.weights, 0, { jawDepth: 1.5, articulation: sample.articulation });
    expect(values[0]).toBeGreaterThan(minimum);
    expect(values[0]).toBeLessThanOrEqual(1);
  }
});

it('preserves complete closures and bounds opening to the calibrated mouth atlas', () => {
  expect(renderer.controls({ rest: 1 }, 0, { jawDepth: 1.8 })[0]).toBe(0);
  expect(renderer.controls({ MBP: 1 }, 0, { jawDepth: 1.8 })[0]).toBe(0);
  expect(renderer.controls({ AA: 1 }, 0, { jawDepth: 1.8 })[0]).toBe(1);
  const medium = renderer.controls({ AA: .4 }, 0, { jawDepth: 1.2 })[0];
  const deeper = renderer.controls({ AA: .4 }, 0, { jawDepth: 1.5 })[0];
  expect(deeper).toBeGreaterThan(medium);
});
