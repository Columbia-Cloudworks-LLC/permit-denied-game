import type { FloorFinish, Material } from "../structure/types";
import type { ClimateEnvelope } from "../world/climate";
import type { SeasonId, WeatherPreset } from "../world/season";
import { matColors, PAL, shade } from "./palette";

/** Fixed isometric sun from upper-west (world −X, −Y). */
const LIGHT_DIR = { x: -0.72, y: -0.68 };

export type WallFace = "south" | "east";

/**
 * The sun a town is drawn under. A pure function of climate, sky and paint season, never of
 * time: colours baked into cached Graphics stay valid for as long as `key` does.
 */
export interface Sunlight {
  /** Multiplies the whole world: the sky's light warmed or cooled by the zone's sun. */
  tint: number;
  /** Lit/shaded face spread; 1 is the neutral ramp. */
  contrast: number;
  /** Ground shadow colour and strength relative to the neutral shadow. */
  shadow: number;
  shadowStrength: number;
  key: string;
}

const NEUTRAL_SHADOW_ALPHA = 0.22;
export const NEUTRAL_SUN: Sunlight = { tint: 0xffffff, contrast: 1, shadow: PAL.shadow, shadowStrength: 1, key: "neutral" };

/** Cloud, rain, fog and dust scatter the light: flatter faces, softer shadows. */
function skyDiffusion(weather: Pick<WeatherPreset, "condition">): number {
  switch (weather.condition) {
    case "clear":
      return 1;
    case "heat":
      return 1.06;
    case "overcast":
      return 0.82;
    case "precip":
      return 0.8;
    case "storm":
    case "dust":
      return 0.7;
    case "fog":
      return 0.62;
    default: {
      const _never: never = weather.condition;
      return _never;
    }
  }
}

/**
 * Warm, stark, high-contrast sun with indigo shadows in the arid Southwest; a cooler, flatter
 * one in the north, flatter again under snow cloud. A temperate clear day is the neutral sun.
 */
export function sunlightFor(climate: Pick<ClimateEnvelope, "sun">, weather: Pick<WeatherPreset, "condition" | "light">, look: SeasonId): Sunlight {
  const { sun } = climate;
  const diffusion = skyDiffusion(weather) * (look === "winter" ? 0.94 : 1);
  const contrast = Math.round(sun.contrast * diffusion * 100) / 100;
  const shadowStrength = Math.round((sun.shadowAlpha / NEUTRAL_SHADOW_ALPHA) * Math.min(1, diffusion) * 100) / 100;
  const tint = multiplyTint(weather.light, sun.tint);
  return { tint, contrast, shadow: sun.shadow, shadowStrength, key: `${tint.toString(16)}:${contrast}:${sun.shadow.toString(16)}:${shadowStrength}` };
}

function multiplyTint(a: number, b: number): number {
  const mul = (shift: number) => Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255) << shift;
  return mul(16) | mul(8) | mul(0);
}

let active = NEUTRAL_SUN;

/** The renderer sets the town's sun before drawing; every face and shadow colour below reads it. */
export function setSunlight(sun: Sunlight): void {
  active = sun;
}

/** A face brightness step under the active sun: its distance from flat grows with contrast. */
function lit(step: number): number {
  return 1 + (step - 1) * active.contrast;
}

/** Ground shadow under the active sun: its colour, and `alpha` scaled by the sun's strength. */
export function shadowFill(alpha: number): { color: number; alpha: number } {
  return { color: active.shadow, alpha: Math.min(0.6, alpha * active.shadowStrength) };
}

function wallFaceShade(face: WallFace): number {
  const dot = face === "east" ? LIGHT_DIR.x : LIGHT_DIR.y;
  return lit(dot > 0 ? 1.04 : 0.86);
}

export function wallFaceColor(material: Material, face: WallFace, damaged = false): number {
  const c = matColors(material);
  const base = face === "east" ? c.side : c.dark;
  const sunlit = shade(base, wallFaceShade(face));
  return damaged ? shade(sunlit, 0.9) : sunlit;
}

export function topFaceColor(material: Material, damaged = false): number {
  const c = matColors(material);
  const sunlit = shade(c.top, lit(1.06));
  return damaged ? shade(sunlit, 0.88) : sunlit;
}

export function floorFinishColor(finish: FloorFinish, edge = false): number {
  switch (finish) {
    case "concrete":
      return edge ? PAL.concreteDark : PAL.concrete;
    case "plank":
      return edge ? PAL.plankDark : PAL.plank;
    case "tile":
      return edge ? PAL.tileDark : PAL.tile;
    case "linoleum":
      return edge ? PAL.linoleumDark : PAL.linoleum;
    default: {
      const _never: never = finish;
      return _never;
    }
  }
}

export function brokenEdgeColor(material: Material): number {
  const c = matColors(material);
  return shade(c.dark, 0.72);
}

/** Roof slope brightness from the fixed light, not camera facing, spread by the active sun's contrast. */
export function roofSlopeLight(verts: { x: number; y: number; z: number }[]): number {
  if (verts.length < 3) return 0;
  const a = verts[0]!;
  const b = verts[1]!;
  const c = verts[2]!;
  let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  let ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  let nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return ((nx * LIGHT_DIR.x + ny * LIGHT_DIR.y) / len) * active.contrast;
}
