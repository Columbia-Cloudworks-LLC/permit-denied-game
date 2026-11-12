import { mixSeed, Rng } from "../game/rng";
import type { FieldState } from "./biomes";
import { aridLandscape, climateHazard, defaultClimate, lookSeason, snowOnGround, type ClimateEnvelope, type HazardId } from "./climate";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type SeasonId = (typeof SEASONS)[number];
export type SeasonSelection = SeasonId | "random";
export type WeatherDetail = "on" | "reduced" | "off";
/** Particle bed. `dust` is a haboob's ochre sheets, `downpour` a monsoon or squall, `shimmer` clear-sky heat haze. */
export type WeatherKind = "clear" | "rain" | "flurries" | "leaves" | "dust" | "downpour" | "shimmer";

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
export const WEATHER_CONDITIONS = ["clear", "overcast", "precip", "storm", "fog", "dust", "heat"] as const;
export type WeatherConditionId = (typeof WEATHER_CONDITIONS)[number];

export interface WeatherPreset {
  season: SeasonId;
  condition: WeatherConditionId;
  kind: WeatherKind;
  /** Particle density multiplier. Storms are heavier than plain rain or snow. */
  intensity: number;
  /** The preset itself is presentation. Time Challenge stakes come from `weatherRisk`, by rule. */
  gameplay: "none";
  /** Light warmth applied as a world tint. White is neutral. */
  light: number;
  haze: number;
  /** Haze colour; absent is the neutral grey veil. Dust storms run ochre. */
  hazeTint?: number;
  /** The climate hazard this sky is, when it is one: haboob, monsoon, squall, heat, blizzard. */
  hazard?: HazardId;
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

/** The legacy seed-rolled seasonal sky. A snowless winter rolls its look season's table, so it never draws flurries. */
export function resolveWeather(season: SeasonId, seed: number, climate: ClimateEnvelope = defaultClimate()): WeatherPreset {
  const rng = new Rng((seed ^ WEATHER_SALT) >>> 0);
  const table = WEATHER_PRESETS[lookSeason(season, climate)];
  return { ...table[rng.int(0, table.length - 1)]!, season };
}

export function isWeatherCondition(value: string): value is WeatherConditionId {
  return (WEATHER_CONDITIONS as readonly string[]).includes(value);
}

const HAZARD_LABELS: Readonly<Record<HazardId, string>> = {
  haboob: "Haboob",
  "blowing-dust": "Blowing Dust",
  monsoon: "Monsoon",
  squall: "Squall",
  heat: "Extreme Heat",
  blizzard: "Blizzard",
};

/** Precipitation reads as the season and climate allow: snow only in a snowy winter, rain otherwise. */
export function weatherConditionLabel(season: SeasonId, condition: WeatherConditionId, climate: ClimateEnvelope = defaultClimate()): string {
  const hazard = climateHazard(climate, season, condition);
  if (hazard) return HAZARD_LABELS[hazard];
  switch (condition) {
    case "clear":
      return "Clear";
    case "overcast":
      return "Overcast";
    case "precip":
      return snowOnGround(season, climate) ? "Snow" : "Rain";
    case "storm":
      return "Storm";
    case "fog":
      return "Fog";
    case "dust":
      return "Blowing Dust";
    case "heat":
      return "Extreme Heat";
    default: {
      const _never: never = condition;
      return _never;
    }
  }
}

const CLEAR_LIGHT: Record<SeasonId, number> = { spring: 0xe7f3dc, summer: 0xfff6df, autumn: 0xecc99a, winter: 0xe7eef5 };
const OVERCAST_LIGHT: Record<SeasonId, number> = { spring: 0xd2dacd, summer: 0xdcdcd2, autumn: 0xd2c2ac, winter: 0xd0d8e0 };

/** The preset a county's chosen condition produces in the locked season. */
export function weatherPresetFor(season: SeasonId, condition: WeatherConditionId, climate: ClimateEnvelope = defaultClimate()): WeatherPreset {
  const snow = snowOnGround(season, climate);
  const look = lookSeason(season, climate);
  const hazard = climateHazard(climate, season, condition);
  const base = { season, condition, gameplay: "none" as const, ...(hazard ? { hazard } : {}) };
  // Leaves only drift where broadleaf woods stand.
  const leaves = look === "autumn" && !aridLandscape(climate) && climate.landscape !== "subtropical";
  switch (condition) {
    case "clear":
      // Autumn keeps its drifting leaves on a clear day.
      return { ...base, kind: leaves ? "leaves" : "clear", intensity: 1, light: CLEAR_LIGHT[look], haze: 0.02 };
    case "overcast":
      return { ...base, kind: "clear", intensity: 1, light: OVERCAST_LIGHT[look], haze: 0.08 };
    case "precip":
      return { ...base, kind: snow ? "flurries" : "rain", intensity: 1, light: snow ? 0xd7e3ef : 0xd5e0d6, haze: 0.08 };
    case "storm":
      if (hazard === "monsoon" || hazard === "squall") return { ...base, kind: "downpour", intensity: 3, light: hazard === "monsoon" ? 0xb8b4b0 : 0xa8b6be, haze: 0.18 };
      return { ...base, kind: snow ? "flurries" : "rain", intensity: 2.4, light: snow ? 0xc4d0dc : 0xb4bec6, haze: 0.14 };
    case "fog":
      return { ...base, kind: "clear", intensity: 1, light: 0xd8dcdc, haze: 0.3 };
    case "dust":
      return { ...base, kind: "dust", intensity: hazard === "haboob" ? 2.2 : 1.2, light: 0xe6c898, haze: hazard === "haboob" ? 0.34 : 0.2, hazeTint: 0xc9a06a };
    case "heat":
      return { ...base, kind: "shimmer", intensity: 1, light: 0xfff0cc, haze: 0.06, hazeTint: 0xf4e2b8 };
    default: {
      const _never: never = condition;
      return _never;
    }
  }
}

/**
 * A county's rolled condition for this map load: seeded, and always legal for the season and the
 * county's climate (`ClimateEnvelope.weather`). Without a climate it rolls the temperate table.
 */
export function rollWeatherCondition(season: SeasonId, seed: number, climate: Pick<ClimateEnvelope, "weather"> = defaultClimate()): WeatherConditionId {
  const rng = new Rng(mixSeed(seed ^ WEATHER_SALT));
  const odds = climate.weather[season];
  const total = WEATHER_CONDITIONS.reduce((sum, id) => sum + odds[id], 0);
  let roll = rng.next() * total;
  for (const id of WEATHER_CONDITIONS) {
    roll -= odds[id];
    if (roll < 0) return id;
  }
  return "clear";
}

export const ICE_COLOR = 0x6e8ea4;
export const ICE_CRACK = 0x4a6274;
