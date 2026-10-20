export interface MouthSample { weights: Pose; articulation: number }

/** Text suggests the shape; actual received PCM controls when the mouth can move.
 *  No claim of phoneme alignment: Soniox's current plugin has no word/viseme timings.
 */
export class LipSync {
  private planner: InstanceType<Window['PortraitCore']['SpeechPlanner']> | null = null;
  private pending = '';
  private lastTextAt = -Infinity;
  private heardAt = -Infinity;

  clear() { this.planner = null; this.pending = ''; this.heardAt = -Infinity; }

  pushText(chunk: string, now: number, final = false) {
    this.pending += chunk;
    this.lastTextAt = now;
    // Streams can split in the middle of a Unicode word. Wait for whitespace
    // or stream end, rather than treating every packet as a complete syllable.
    const end = final ? this.pending.length : Math.max(this.pending.lastIndexOf(' '), this.pending.lastIndexOf('\n')) + 1;
    if (end <= 0) return;
    const text = this.pending.slice(0, end).trim();
    this.pending = this.pending.slice(end);
    if (text) {
      this.planner = new window.PortraitCore.SpeechPlanner();
      this.planner.start(text, 'vi-VN', now, 1);
    }
  }

  sample(now: number, level: number, speaking: boolean): MouthSample {
    const core = window.PortraitCore;
    if (level > .015) this.heardAt = now;
    // Retain a short release for natural closures; no random silent lip motion.
    const audible = speaking && now - this.heardAt < 130;
    if (!audible) return { weights: core.pose('rest'), articulation: 1 };
    if (this.pending && now - this.lastTextAt > 180) this.pushText('', now, true);
    let sample = this.planner?.sample(now);
    if (!sample || sample.weights.rest > .98) {
      sample = { weights: core.blend(core.pose('rest'), core.pose('AA'), .65), articulation: .85 };
    }
    const energy = Math.min(1, Math.max(.28, level * 4));
    return { weights: core.blend(core.pose('rest'), sample.weights, energy), articulation: sample.articulation ?? 1 };
  }
}
