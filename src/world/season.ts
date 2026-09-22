import { Rng } from "../game/rng";
import type { FieldState } from "./biomes";
import type { GroundCondition } from "./groundCondition";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type SeasonId = (typeof SEASONS)[number];
export type SeasonSelection = SeasonId | "random";
export type WeatherDetail = "on" | "reduced" | "off";
export type WeatherKind = "clear" | "rain" | "flurries" | "leaves";

/**
 * Missing or invalid `season` query values resolve to summer.
 * Summer keeps clear ground and liquid water, which is how maps behaved before seasons.
 * `random` is a selection, not a resolved season. Callers resolve it once from the seed.
 */
export const SEASON_COMPATIBILITY = "missing-or-invalid-season-is-summer";

/** Separate from layout, biome, and weather streams. */
export const SEASON_SALT = 0x5ea501;
export const WEATHER_SALT = 0x7ea7e2;

export const WEATHER_DETAILS: readonly WeatherDetail[] = ["on", "reduced", "off"];

export interface WeatherPreset {
  season: SeasonId;
  kind: WeatherKind;
  /** Presentation only. No traction, braking, heat, or visibility penalty. */
  gameplay: "none";
  /** Light warmth applied as a world tint. White is neutral. */
  light: number;
  haze: number;
}

export const WEATHER_PRESETS: Record<SeasonId, readonly WeatherPreset[]> = {
  spring: [
    { season: "spring", kind: "rain", gameplay: "none", light: 0xd5e4d0, haze: 0.08 },
    { season: "spring", kind: "clear", gameplay: "none", light: 0xe7f3dc, haze: 0.02 },
  ],
  summer: [
    { season: "summer", kind: "clear", gameplay: "none", light: 0xfff6df, haze: 0.02 },
    { season: "summer", kind: "clear", gameplay: "none", light: 0xffe7c4, haze: 0.03 },
  ],
  autumn: [
    { season: "autumn", kind: "leaves", gameplay: "none", light: 0xf3d2a4, haze: 0.05 },
    { season: "autumn", kind: "clear", gameplay: "none", light: 0xecc99a, haze: 0.04 },
  ],
  winter: [
    { season: "winter", kind: "flurries", gameplay: "none", light: 0xd7e3ef, haze: 0.07 },
    { season: "winter", kind: "clear", gameplay: "none", light: 0xe7eef5, haze: 0.04 },
  ],
};

export function isSeasonId(value: string): value is SeasonId {
  return (SEASONS as readonly string[]).includes(value);
}

export function isWeatherDetail(value: string): value is WeatherDetail {
  return (WEATHER_DETAILS as readonly string[]).includes(value);
}

export function resolveSeason(seed: number): SeasonId {
  const rng = new Rng((seed ^ SEASON_SALT) >>> 0);
  return SEASONS[rng.int(0, SEASONS.length - 1)]!;
}

/** Explicit seasons pass through. Random rolls once. Missing or invalid values are summer. */
export function resolveSeasonSelection(selection: SeasonSelection | undefined, seed: number): SeasonId {
  if (selection === "random") return resolveSeason(seed);
  if (selection && isSeasonId(selection)) return selection;
  return "summer";
}

export function groundConditionForSeason(season: SeasonId): GroundCondition {
  return season === "winter" ? "snow" : "clear";
}

export function waterFrozen(season: SeasonId): boolean {
  return season === "winter";
}

export function seasonLabel(season: SeasonId): string {
  switch (season) {
    case "spring":
      return "Spring";
    case "summer":
      return "Summer";
    case "autumn":
      return "Autumn";
    case "winter":
      return "Winter";
    default: {
      const _never: never = season;
      return _never;
    }
  }
}

export function permittedFieldStates(season: SeasonId): readonly FieldState[] {
  switch (season) {
    case "winter":
      return ["stubble", "tilled", "tilled"];
    case "spring":
      return ["tilled", "tilled", "tilled", "short"];
    case "summer":
      return ["short", "short", "mature"];
    case "autumn":
      return ["mature", "mature", "mature", "stubble"];
    default: {
      const _never: never = season;
      return _never;
    }
  }
}

export function standingCrop(state: FieldState): boolean {
  return state === "short" || state === "mature";
}

export function resolveWeather(season: SeasonId, seed: number): WeatherPreset {
  const rng = new Rng((seed ^ WEATHER_SALT) >>> 0);
  const table = WEATHER_PRESETS[season];
  return table[rng.int(0, table.length - 1)]!;
}

export function seasonTrackColor(season: SeasonId): number {
  switch (season) {
    case "spring":
      return 0x6a5340;
    case "summer":
      return 0xc4b49a;
    case "autumn":
      return 0x8a5a28;
    case "winter":
      return 0xb7c3cc;
    default: {
      const _never: never = season;
      return _never;
    }
  }
}

export const ICE_COLOR = 0x6e8ea4;
export const ICE_CRACK = 0x4a6274;
