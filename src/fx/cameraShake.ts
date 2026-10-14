/** Seconds a directional jolt takes to spring back to rest. */
const JOLT_SECONDS = 0.22;

export class CameraShake {
  private x = 0;
  private y = 0;
  private t = 0;
  private mag = 0;
  private jx = 0;
  private jy = 0;
  private jt = 0;

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.t = 0;
    this.mag = 0;
    this.jx = 0;
    this.jy = 0;
    this.jt = 0;
  }

  /** Random trauma, plus a screen-space lurch along (dirX, dirY) when a direction is given. */
  punch(mag: number, dirX = 0, dirY = 0): void {
    if (mag < 0.35) return;
    this.mag = Math.max(this.mag, Math.min(14, mag * 5.5));
    this.t = 0.16 + Math.min(0.18, mag * 0.04);
    const len = Math.hypot(dirX, dirY);
    if (len < 1e-6) return;
    const k = Math.min(16, mag * 6.5) / len;
    this.jx = dirX * k;
    this.jy = dirY * k;
    this.jt = JOLT_SECONDS;
  }

  step(dt: number): { x: number; y: number } {
    const jolt = this.stepJolt(dt);
    if (this.t <= 0) {
      this.mag = 0;
      this.x = jolt.x;
      this.y = jolt.y;
      return { x: this.x, y: this.y };
    }
    this.t -= dt;
    const fall = Math.max(0, this.t / 0.28);
    this.x = (Math.random() * 2 - 1) * this.mag * fall + jolt.x;
    this.y = (Math.random() * 2 - 1) * this.mag * fall * 0.7 + jolt.y;
    return { x: this.x, y: this.y };
  }

  /** The lurch snaps out at once and eases back with a slight overshoot. */
  private stepJolt(dt: number): { x: number; y: number } {
    if (this.jt <= 0) return { x: 0, y: 0 };
    this.jt = Math.max(0, this.jt - dt);
    const t = 1 - this.jt / JOLT_SECONDS;
    const k = Math.cos(t * Math.PI * 1.5) * (1 - t);
    return { x: this.jx * k, y: this.jy * k };
  }
}
