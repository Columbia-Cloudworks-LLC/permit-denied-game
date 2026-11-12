import { Rng } from '../game/rng';
import { WEATHER_SALT } from '../world/season';
import type { WeatherDetail, WeatherKind, WeatherPreset } from "../world/season";

export interface WeatherFlake {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  kind: WeatherKind;
  /** Ground heading the flake is drawn along: dust and rain sheets streak with the wind. */
  heading: number;
  /** Length multiplier along `heading`: a dust sheet is long, a gust mote short. */
  len: number;
}

const CAP = 36;
/** Iso screen-horizontal on the ground: heat ripples lie flat across the view. */
const SCREEN_FLAT = -Math.PI / 4;
const LEGACY_HEADING = 0.4;

/** Seeded prevailing wind for a town, as a ground heading. Dust sheets and squall rain follow it. */
export function windHeading(seed: number): number {
  return ((Math.imul(seed ^ WEATHER_SALT, 2654435761) >>> 8) % 6283) / 1000;
}

interface Bed {
  /** Share of the base particle cap; heat shimmer is a few bands, not a shower. */
  cap: number;
  life: number;
  /** Spawn height range. */
  z0: number;
  z1: number;
}

const BEDS: Record<WeatherKind, Bed> = {
  clear: { cap: 1, life: 1.6, z0: 2, z1: 5 },
  flurries: { cap: 1, life: 1.6, z0: 2, z1: 5 },
  leaves: { cap: 1, life: 1.6, z0: 2, z1: 5 },
  rain: { cap: 1, life: 1.6, z0: 2, z1: 5 },
  dust: { cap: 1, life: 1.9, z0: 0.15, z1: 2.6 },
  downpour: { cap: 1.2, life: 1, z0: 3, z1: 6 },
  shimmer: { cap: 0.4, life: 1.3, z0: 0.04, z1: 0.3 },
};

/** Camera-local presentation. Restarting the town replaces the renderer state via reset. */
export class SeasonWeather {
  flakes: WeatherFlake[] = [];
  private key = "";
  private rng = new Rng(WEATHER_SALT);

  reset(key: string): void {
    if (key === this.key) return;
    this.flakes = [];
    this.key = key;
    let seed = WEATHER_SALT;
    for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    this.rng.reset(seed);
  }

  step(input: {
    dt: number;
    kind: WeatherKind;
    detail: WeatherDetail;
    camX: number;
    camY: number;
    seed: number;
    /** Storms run denser; omitted means one. */
    intensity?: number;
  }): void {
    const intensity = Math.max(0, input.intensity ?? 1);
    const key = `${input.kind}:${input.detail}:${input.seed}:${intensity}`;
    this.reset(key);
    if (input.detail !== "on" || input.kind === "clear") {
      this.flakes = [];
      return;
    }
    const bed = BEDS[input.kind];
    const cap = Math.round(CAP * intensity * bed.cap);
    const spawns = input.dt * 18 * intensity * bed.cap * (1.6 / bed.life);
    const wind = windHeading(input.seed);
    // Whole spawns first, then the fractional remainder by chance, so storms fill faster.
    for (let n = Math.floor(spawns); n > 0 && this.flakes.length < cap; n--) this.flakes.push(this.spawnFlake(input, bed, wind));
    if (this.flakes.length < cap && this.rng.next() < spawns % 1) this.flakes.push(this.spawnFlake(input, bed, wind));
    const next: WeatherFlake[] = [];
    for (const flake of this.flakes) {
      flake.x += flake.vx * input.dt;
      flake.y += flake.vy * input.dt;
      flake.z += flake.vz * input.dt;
      flake.life -= input.dt;
      const far = Math.hypot(flake.x - input.camX, flake.y - input.camY) > 16;
      if (flake.life > 0 && flake.z > 0 && !far) next.push(flake);
    }
    this.flakes = next.slice(-cap);
  }

  /** A new flake somewhere over the camera, drifting by weather kind. */
  private spawnFlake(input: { kind: WeatherKind; camX: number; camY: number }, bed: Bed, wind: number): WeatherFlake {
    const spread = 10;
    const flake: WeatherFlake = {
      x: input.camX + (this.rng.next() - 0.5) * spread,
      y: input.camY + (this.rng.next() - 0.5) * spread,
      z: bed.z0 + this.rng.next() * (bed.z1 - bed.z0),
      ...FLAKE_DRIFT[input.kind],
      life: bed.life,
      kind: input.kind,
      heading: LEGACY_HEADING,
      len: 1,
    };
    const wx = Math.cos(wind), wy = Math.sin(wind);
    if (input.kind === "dust") {
      // Three sheets to one gust: long ochre streaks, with fast grit skipping through low.
      const gust = this.rng.next() < 0.25;
      const speed = gust ? 9 : 4.6 + this.rng.next() * 1.6;
      // Start upwind so the streak crosses the view instead of leaving it.
      flake.x -= wx * 4;
      flake.y -= wy * 4;
      flake.vx = wx * speed;
      flake.vy = wy * speed;
      flake.vz = gust ? 0.6 : -0.05;
      flake.heading = wind;
      flake.len = gust ? 0.3 : 1.6 + this.rng.next() * 1.4;
      if (gust) { flake.z = 0.1 + this.rng.next() * 0.5; flake.life = 0.9; }
    } else if (input.kind === "downpour") {
      // Steeper and faster than rain, leaning with the wind.
      flake.vx = wx * 2.2;
      flake.vy = wy * 2.2;
      flake.heading = wind;
      flake.len = 2.2;
    } else if (input.kind === "shimmer") {
      flake.heading = SCREEN_FLAT;
      flake.len = 1 + this.rng.next() * 1.2;
    }
    return flake;
  }
}

const FLAKE_DRIFT: Record<WeatherKind, { vx: number; vy: number; vz: number }> = {
  clear: { vx: 0.35, vy: 0.6, vz: -0.8 },
  flurries: { vx: 0.35, vy: 0.6, vz: -0.8 },
  leaves: { vx: 0.8, vy: 0.6, vz: -0.8 },
  rain: { vx: 0.2, vy: 2.4, vz: -3.2 },
  dust: { vx: 0, vy: 0, vz: 0 },
  downpour: { vx: 0, vy: 0, vz: -7.5 },
  shimmer: { vx: 0.12, vy: -0.12, vz: 0.22 },
};

export function presentationTint(light: number, detail: WeatherDetail): number {
  if (detail === "off") return 0xffffff;
  if (detail === "reduced") return mixWhite(light, 0.72);
  return light;
}

function mixWhite(color: number, white: number): number {
  const mix = (channel: number) => Math.min(255, Math.round(channel * (1 - white) + 255 * white));
  return (mix((color >> 16) & 255) << 16) | (mix((color >> 8) & 255) << 8) | mix(color & 255);
}

/** Screen veil over the world. `edge` is extra alpha that grows away from the dozer. */
export interface HazeVeil {
  color: number;
  /** Uniform alpha across the view. */
  alpha: number;
  /** Alpha added by the screen edge, none at the dozer: a dust storm's short visibility. */
  edge: number;
}

/**
 * Only heavy haze (fog, storms, dust) gets a veil; reduced effects halve it and Off removes it.
 * Dust closes in with distance instead of washing the whole view, and extreme heat leaves a
 * faint warm rim.
 */
export function hazeVeil(weather: Pick<WeatherPreset, "kind" | "haze" | "light" | "hazeTint">, detail: WeatherDetail): HazeVeil | null {
  const strength = detail === "off" ? 0 : detail === "reduced" ? 0.5 : 1;
  if (!strength) return null;
  const color = weather.hazeTint ?? weather.light;
  if (weather.kind === "dust") return { color, alpha: weather.haze * 0.4 * strength, edge: weather.haze * 1.5 * strength };
  if (weather.kind === "shimmer") return { color, alpha: 0, edge: weather.haze * 1.6 * strength };
  return weather.haze >= 0.1 ? { color, alpha: weather.haze * 0.9 * strength, edge: 0 } : null;
}
