export class CameraShake {
  private x = 0;
  private y = 0;
  private t = 0;
  private mag = 0;

  punch(mag: number): void {
    if (mag < 0.35) return;
    this.mag = Math.max(this.mag, Math.min(14, mag * 5.5));
    this.t = 0.16 + Math.min(0.18, mag * 0.04);
  }

  step(dt: number): { x: number; y: number } {
    if (this.t <= 0) {
      this.x = 0;
      this.y = 0;
      this.mag = 0;
      return { x: 0, y: 0 };
    }
    this.t -= dt;
    const fall = Math.max(0, this.t / 0.28);
    this.x = (Math.random() * 2 - 1) * this.mag * fall;
    this.y = (Math.random() * 2 - 1) * this.mag * fall * 0.7;
    return { x: this.x, y: this.y };
  }
}
