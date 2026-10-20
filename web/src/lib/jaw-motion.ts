const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** Damped jaw movement in atlas coordinates. Filter the final opening, including
 * articulation and audio gain, rather than stacking another filter on poses. */
export class JawMotion {
  private opening = 0;
  private velocity = 0;

  update(target: number, dt: number): number {
    target = Math.max(0, Math.min(1, target));
    const elapsed = Math.max(0, Math.min(.1, dt));
    const steps = Math.max(1, Math.ceil(elapsed * 240));
    const step = elapsed / steps;
    for (let i = 0; i < steps; i++) {
      const acceleration = clamp(26 * 26 * (target - this.opening) - 52 * this.velocity, 100);
      this.velocity = clamp(this.velocity + acceleration * step, 4.5);
      this.opening = Math.max(0, Math.min(1, this.opening + this.velocity * step));
    }
    return this.opening;
  }
}
