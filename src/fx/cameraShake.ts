/** Seconds a directional jolt takes to spring back to rest. */
const JOLT_SECONDS = 0.22;

/**
 * Trauma frequency in Hz across impact heft: light timber chatters fast, dense masonry and
 * concrete heave slowly. Heft spans roughly 0.9 (wood) to 1.45 (a tall concrete block).
 */
const HEFT = { light: 0.9, heavy: 1.45, chatterHz: 30, heaveHz: 9 } as const;

/** 0 for the lightest structures, 1 for the heaviest. */
function heftT(heft: number): number {
  return Math.max(0, Math.min(1, (heft - HEFT.light) / (HEFT.heavy - HEFT.light)));
}

export class CameraShake {
  private x = 0;
  private y = 0;
  private t = 0;
  private mag = 0;
  private jx = 0;
  private jy = 0;
  private jt = 0;
  /** Sample-and-hold noise: the trauma glides from (ax, ay) to (bx, by) over one period. */
  private hz: number = HEFT.chatterHz;
  private phase = 1;
  private ax = 0;
  private ay = 0;
  private bx = 0;
  private by = 0;

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.t = 0;
    this.mag = 0;
    this.jx = 0;
    this.jy = 0;
    this.jt = 0;
    this.phase = 1;
    this.ax = this.ay = this.bx = this.by = 0;
  }

  /**
   * Random trauma, plus a screen-space lurch along (dirX, dirY) when a direction is given.
   * Heft scales the character: light hits chatter at a high rate with less travel; heavy hits
   * heave slower, wider and longer.
   */
  punch(mag: number, dirX = 0, dirY = 0, heft = 1): void {
    if (mag < 0.35) return;
    const h = heftT(heft);
    this.mag = Math.max(this.mag, Math.min(14, mag * 5.5 * (0.75 + 0.5 * h)));
    this.t = 0.16 + Math.min(0.18, mag * 0.04) + h * 0.08;
    this.hz = HEFT.chatterHz + (HEFT.heaveHz - HEFT.chatterHz) * h;
    this.phase = 1;
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
    const noise = this.stepNoise(dt);
    this.x = noise.x * this.mag * fall + jolt.x;
    this.y = noise.y * this.mag * fall * 0.7 + jolt.y;
    return { x: this.x, y: this.y };
  }

  /** Noise in [-1, 1] that picks a new target hz times a second and glides toward it. */
  private stepNoise(dt: number): { x: number; y: number } {
    this.phase += dt * this.hz;
    if (this.phase >= 1) {
      this.phase %= 1;
      this.ax = this.bx;
      this.ay = this.by;
      this.bx = Math.random() * 2 - 1;
      this.by = Math.random() * 2 - 1;
    }
    return { x: this.ax + (this.bx - this.ax) * this.phase, y: this.ay + (this.by - this.ay) * this.phase };
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
