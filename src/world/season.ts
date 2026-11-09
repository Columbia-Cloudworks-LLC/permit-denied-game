import { mixSeed, Rng } from "../game/rng";
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
const SEASON_SALT = 0x5ea501;
export const WEATHER_SALT = 0x7ea7e2;

export const WEATHER_DETAILS: readonly WeatherDetail[] = ["on", "reduced", "off"];

/** County-level sky. Separate from the season, which is locked for the whole run. */
export const WEATHER_CONDITIONS = ["clear", "overcast", "precip", "storm", "fog"] as const;
export type WeatherConditionId = (typeof WEATHER_CONDITIONS)[number];

export interface WeatherPreset {
  season: SeasonId;
  condition: WeatherConditionId;
  kind: WeatherKind;
  /** Particle density multiplier. Storms are heavier than plain rain or snow. */
  intensity: number;
  /** Presentation only. No traction, braking, heat, or visibility penalty. */
  gameplay: "none";
  /** Light warmth applied as a world tint. White is neutral. */
  light: number;
  haze: number;
}

const WEATHER_PRESETS: Record<SeasonId, readonly WeatherPreset[]> = {
  spring: [
    { season: "spring", condition: "precip", kind: "rain", intensity: 1, gameplay: "none", light: 0xd5e4d0, haze: 0.08 },
    { season: "spring", condition: "clear", kind: "clear", intensity: 1, gameplay: "none", light: 0xe7f3dc, haze: 0.02 },
  ],
  summer: [
    { season: "summer", condition: "clear", kind: "clear", intensity: 1, gameplay: "none", light: 0xfff6df, haze: 0.02 },
    { season: "summer", condition: "clear", kind: "clear", intensity: 1, gameplay: "none", light: 0xffe7c4, haze: 0.03 },
  ],
  autumn: [
    { season: "autumn", condition: "clear", kind: "leaves", intensity: 1, gameplay: "none", light: 0xf3d2a4, haze: 0.05 },
    { season: "autumn", condition: "clear", kind: "clear", intensity: 1, gameplay: "none", light: 0xecc99a, haze: 0.04 },
  ],
  winter: [
    { season: "winter", condition: "precip", kind: "flurries", intensity: 1, gameplay: "none", light: 0xd7e3ef, haze: 0.07 },
    { season: "winter", condition: "clear", kind: "clear", intensity: 1, gameplay: "none", light: 0xe7eef5, haze: 0.04 },
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

export function groundConditionForSeason(season: SeasonId): GroundCondition {
  return season === "winter" ? "snow" : "clear";
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

export function isWeatherCondition(value: string): value is WeatherConditionId {
  return (WEATHER_CONDITIONS as readonly string[]).includes(value);
}

/** Precipitation reads as the season allows: snow in winter, rain otherwise. */
export function weatherConditionLabel(season: SeasonId, condition: WeatherConditionId): string {
  switch (condition) {
    case "clear":
      return "Clear";
    case "overcast":
      return "Overcast";
    case "precip":
      return season === "winter" ? "Snow" : "Rain";
    case "storm":
      return season === "winter" ? "Blizzard" : "Storm";
    case "fog":
      return "Fog";
    default: {
      const _never: never = condition;
      return _never;
    }
  }
}

const CLEAR_LIGHT: Record<SeasonId, number> = { spring: 0xe7f3dc, summer: 0xfff6df, autumn: 0xecc99a, winter: 0xe7eef5 };
const OVERCAST_LIGHT: Record<SeasonId, number> = { spring: 0xd2dacd, summer: 0xdcdcd2, autumn: 0xd2c2ac, winter: 0xd0d8e0 };

/** The preset a county's chosen condition produces in the locked season. */
export function weatherPresetFor(season: SeasonId, condition: WeatherConditionId): WeatherPreset {
  const snow = season === "winter";
  const base = { season, condition, gameplay: "none" as const };
  switch (condition) {
    case "clear":
      // Autumn keeps its drifting leaves on a clear day.
      return { ...base, kind: season === "autumn" ? "leaves" : "clear", intensity: 1, light: CLEAR_LIGHT[season], haze: 0.02 };
    case "overcast":
      return { ...base, kind: "clear", intensity: 1, light: OVERCAST_LIGHT[season], haze: 0.08 };
    case "precip":
      return { ...base, kind: snow ? "flurries" : "rain", intensity: 1, light: snow ? 0xd7e3ef : 0xd5e0d6, haze: 0.08 };
    case "storm":
      return { ...base, kind: snow ? "flurries" : "rain", intensity: 2.4, light: snow ? 0xc4d0dc : 0xb4bec6, haze: 0.14 };
    case "fog":
      return { ...base, kind: "clear", intensity: 1, light: 0xd8dcdc, haze: 0.3 };
    default: {
      const _never: never = condition;
      return _never;
    }
  }
}

/** Relative odds of each condition by season. Summer storms, winter snow, spring rain. */
const CONDITION_ODDS: Record<SeasonId, Record<WeatherConditionId, number>> = {
  spring: { clear: 3, overcast: 2, precip: 3, storm: 1, fog: 1 },
  summer: { clear: 6, overcast: 2, precip: 1, storm: 2, fog: 0.5 },
  autumn: { clear: 4, overcast: 3, precip: 2, storm: 1, fog: 1.5 },
  winter: { clear: 3, overcast: 3, precip: 3, storm: 1, fog: 1 },
};

/** A county's rolled condition for this map load: seeded, and always legal for the season. */
export function rollWeatherCondition(season: SeasonId, seed: number): WeatherConditionId {
  const rng = new Rng(mixSeed(seed ^ WEATHER_SALT));
  const odds = CONDITION_ODDS[season];
  const total = WEATHER_CONDITIONS.reduce((sum, id) => sum + odds[id], 0);
  let roll = rng.next() * total;
  for (const id of WEATHER_CONDITIONS) {
    roll -= odds[id];
    if (roll < 0) return id;
  }
  return "clear";
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
