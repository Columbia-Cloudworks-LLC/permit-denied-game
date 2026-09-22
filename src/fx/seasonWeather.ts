import type { WeatherDetail, WeatherKind } from "../world/season";

export interface WeatherFlake {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  kind: WeatherKind;
}

const CAP = 36;

/** Camera-local presentation. Restarting the town replaces the renderer state via reset. */
export class SeasonWeather {
  flakes: WeatherFlake[] = [];
  private key = "";

  reset(key: string): void {
    if (key === this.key) return;
    this.flakes = [];
    this.key = key;
  }

  step(input: {
    dt: number;
    kind: WeatherKind;
    detail: WeatherDetail;
    camX: number;
    camY: number;
    seed: number;
  }): void {
    const key = `${input.kind}:${input.detail}:${input.seed}`;
    this.reset(key);
    if (input.detail !== "on" || input.kind === "clear") {
      this.flakes = [];
      return;
    }
    if (this.flakes.length < CAP && Math.random() < input.dt * 18) {
      const spread = 10;
      this.flakes.push({
        x: input.camX + (Math.random() - 0.5) * spread,
        y: input.camY + (Math.random() - 0.5) * spread,
        z: 2 + Math.random() * 3,
        vx: input.kind === "leaves" ? 0.8 : input.kind === "rain" ? 0.2 : 0.35,
        vy: input.kind === "rain" ? 2.4 : 0.6,
        vz: input.kind === "rain" ? -3.2 : -0.8,
        life: 1.6,
        kind: input.kind,
      });
    }
    const next: WeatherFlake[] = [];
    for (const flake of this.flakes) {
      flake.x += flake.vx * input.dt;
      flake.y += flake.vy * input.dt;
      flake.z += flake.vz * input.dt;
      flake.life -= input.dt;
      const far = Math.hypot(flake.x - input.camX, flake.y - input.camY) > 16;
      if (flake.life > 0 && flake.z > 0 && !far) next.push(flake);
    }
    this.flakes = next.slice(-CAP);
  }
}

export function presentationTint(light: number, detail: WeatherDetail): number {
  if (detail === "off") return 0xffffff;
  if (detail === "reduced") return mixWhite(light, 0.72);
  return light;
}

function mixWhite(color: number, white: number): number {
  const mix = (channel: number) => Math.min(255, Math.round(channel * (1 - white) + 255 * white));
  return (mix((color >> 16) & 255) << 16) | (mix((color >> 8) & 255) << 8) | mix(color & 255);
}
