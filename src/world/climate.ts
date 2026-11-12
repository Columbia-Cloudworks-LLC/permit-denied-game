import type { BiomeId } from "./biomes";

/**
 * Climate envelopes. A county's geography (latitude, elevation, aridity, maritime influence,
 * bedrock) classifies into one of a fixed set of climate zones; the zone's envelope then tells
 * every other system what the place allows: snow, freezing water, weather odds, hazards, winter
 * look, soil, sun, and the regional building dress. Nothing here names a state or province;
 * the region table that supplies geography lives in the lazy overworld chunk (`regionClimate.ts`).
 *
 * This module stays in the startup bundle: it is plain data plus pure functions, and must not
 * import the region manifest. It deliberately imports no runtime code from `season.ts`.
 */

type Season = "spring" | "summer" | "autumn" | "winter";
type Condition = "clear" | "overcast" | "precip" | "storm" | "fog" | "dust" | "heat";

export type Bedrock = "sandstone" | "granite" | "limestone" | "volcanic" | "alluvium";

export interface ClimateGeography {
  /** Degrees north. */
  latitude: number;
  /** Metres above sea level. */
  elevation: number;
  /** 0 = rainforest wet, 1 = hyper-arid. */
  aridity: number;
  /** 0 = deep continental interior, 1 = open ocean coast. */
  maritime: number;
  bedrock: Bedrock;
}

export const CLIMATE_IDS = [
  "sonoran-desert",
  "mojave-desert",
  "chihuahuan-desert",
  "canyonlands",
  "great-basin",
  "mediterranean-coast",
  "gulf-subtropical",
  "tropical",
  "humid-south",
  "upland-south",
  "southern-plains",
  "temperate",
  "great-plains",
  "alpine",
  "pacific-maritime",
  "boreal",
  "subarctic",
] as const;
export type ClimateId = (typeof CLIMATE_IDS)[number];

/** What grows and stands on undeveloped ground. */
export type Landscape = "desert" | "canyonlands" | "prairie" | "alpine" | "subtropical" | "forest" | "boreal";
/** Local soil: tints track marks, dust plumes, verges and bare lots. */
export type SoilId = "red-sandstone" | "pale-caliche" | "coastal-sand" | "volcanic-red" | "dark-loam" | "prairie-loess" | "granite-grit" | "podzol";
/** Regional roof silhouettes for houses, motels and low civic buildings. */
export type RoofRegion = "southwest" | "subtropical" | "temperate";
/** Regional wall palette family. */
export type WallRegion = "southwest" | "gulf" | "brick-belt" | "mountain" | "pacific";
/** Climate-specific hazard a weather condition turns into. */
export type HazardId = "haboob" | "blowing-dust" | "monsoon" | "squall" | "heat" | "blizzard";

export interface SunProfile {
  /** Multiplies into the weather light tint. White is neutral. */
  tint: number;
  /** Lit/shaded face spread. 1 is the legacy ramp; desert noon runs higher. */
  contrast: number;
  /** Ground shadow colour and strength. */
  shadow: number;
  shadowAlpha: number;
}

export interface SoilProfile {
  id: SoilId;
  /** Loose dust thrown by tracks and wind. */
  dust: number;
  /** Compacted tread mark on dry ground. */
  track: number;
  /** The same ground churned wet. */
  mud: number;
  /** Bare verge and shoulder. */
  verge: number;
}

export const SOILS: Readonly<Record<SoilId, SoilProfile>> = {
  "red-sandstone": { id: "red-sandstone", dust: 0xc98a5e, track: 0x9c5a38, mud: 0x7a4028, verge: 0xb87a50 },
  "pale-caliche": { id: "pale-caliche", dust: 0xdccfb0, track: 0xb5a684, mud: 0x8c7a5a, verge: 0xcbbd98 },
  "coastal-sand": { id: "coastal-sand", dust: 0xe2d6b4, track: 0xc2b088, mud: 0x94825e, verge: 0xd6c8a0 },
  "volcanic-red": { id: "volcanic-red", dust: 0xb4684a, track: 0x8a4630, mud: 0x5e2c1e, verge: 0xa25a40 },
  "dark-loam": { id: "dark-loam", dust: 0x9c8a70, track: 0x5c4a38, mud: 0x3e3026, verge: 0x6e5c46 },
  "prairie-loess": { id: "prairie-loess", dust: 0xc4b08a, track: 0x8a7450, mud: 0x5e4c34, verge: 0xa8946c },
  "granite-grit": { id: "granite-grit", dust: 0xb4b0a6, track: 0x7e7a70, mud: 0x56524a, verge: 0x9a968a },
  podzol: { id: "podzol", dust: 0xa89c88, track: 0x66584a, mud: 0x443a30, verge: 0x7c6e5c },
};

export interface ClimateEnvelope {
  id: ClimateId;
  label: string;
  /** Representative geography of the zone; flags below derive from it. */
  geography: ClimateGeography;
  /** Mean temperature of the coldest month, °C, from `winterMeanC`. */
  winterMeanC: number;
  /** Snowfall, snow cover, snow-capped roofs and trees. */
  allowsSnow: boolean;
  /** Frozen ponds and ice. */
  allowsFreeze: boolean;
  landscape: Landscape;
  /** Default biome when the session does not name one. */
  biome: BiomeId;
  soil: SoilId;
  /** The palette season a snowless winter borrows: dry ochre (`summer`), dormant tan (`autumn`) or mild green (`spring`). */
  winterLook: Exclude<Season, "winter">;
  roofs: RoofRegion;
  walls: WallRegion;
  sun: SunProfile;
  /** Relative odds of each county sky by season. Zero means the zone never rolls it. */
  weather: Readonly<Record<Season, Readonly<Record<Condition, number>>>>;
}

/**
 * Coldest-month mean in °C. Latitude sets the baseline, continental interiors north of the
 * mid-thirties lose more, open coasts keep ocean warmth, and height costs 5 °C per kilometre.
 */
export function winterMeanC(geo: ClimateGeography): number {
  const baseline = 27 - 1.05 * (geo.latitude - 20);
  const continental = (1 - geo.maritime) * Math.max(0, geo.latitude - 34) * 1.3;
  return baseline - continental + geo.maritime * 8 - geo.elevation * 0.005;
}

/** Dry air needs a colder winter before anything sticks. */
function snowLineC(geo: ClimateGeography): number {
  return 7 - geo.aridity * 4;
}

export function geographyAllowsSnow(geo: ClimateGeography): boolean {
  return winterMeanC(geo) < snowLineC(geo);
}

/** Ponds freeze a little before snow settles. */
export function geographyAllowsFreeze(geo: ClimateGeography): boolean {
  return winterMeanC(geo) < snowLineC(geo) + 2.5;
}

/** The zone a geography falls in. Pure thresholds over the geography; no place names. */
export function classifyClimate(geo: ClimateGeography): ClimateId {
  const snow = geographyAllowsSnow(geo);
  if (geo.latitude < 24 && geo.maritime >= 0.8) return "tropical";
  if (geo.aridity >= 0.7) {
    if (snow) return geo.bedrock === "sandstone" ? "canyonlands" : "great-basin";
    if (geo.latitude >= 34.5) return "mojave-desert";
    return geo.elevation >= 900 ? "chihuahuan-desert" : "sonoran-desert";
  }
  if (!snow) {
    if (geo.aridity >= 0.5 && geo.maritime >= 0.6) return "mediterranean-coast";
    if (geo.latitude < 31.5 && geo.maritime >= 0.4) return "gulf-subtropical";
    if (geo.aridity >= 0.35 && geo.maritime < 0.4) return "southern-plains";
    return geographyAllowsFreeze(geo) ? "upland-south" : "humid-south";
  }
  if (geo.elevation >= 1500) return "alpine";
  if (geo.latitude >= 58) return "subarctic";
  if (geo.maritime >= 0.7 && geo.latitude < 56) return "pacific-maritime";
  if (geo.aridity >= 0.42) return "great-plains";
  return geo.latitude >= 47.5 ? "boreal" : "temperate";
}

const geo = (latitude: number, elevation: number, aridity: number, maritime: number, bedrock: Bedrock): ClimateGeography =>
  ({ latitude, elevation, aridity, maritime, bedrock });

type Odds = Readonly<Record<Condition, number>>;
const odds = (clear: number, overcast: number, precip: number, storm: number, fog: number, dust = 0, heat = 0): Odds =>
  ({ clear, overcast, precip, storm, fog, dust, heat });

/** The original four-season table: summer storms, winter snow, spring rain. */
const HUMID_WEATHER: ClimateEnvelope["weather"] = {
  spring: odds(3, 2, 3, 1, 1),
  summer: odds(6, 2, 1, 2, 0.5),
  autumn: odds(4, 3, 2, 1, 1.5),
  winter: odds(3, 3, 3, 1, 1),
};
/** Low desert: spring wind, a monsoon summer of heat, haboobs and downpours, and a dry mild winter. */
const DESERT_WEATHER: ClimateEnvelope["weather"] = {
  spring: odds(5, 1, 0.5, 0, 0, 3, 0.5),
  summer: odds(2, 1, 0.5, 3, 0, 2.5, 4),
  autumn: odds(5, 1, 0.5, 1, 0, 1.5, 1),
  winter: odds(6, 2, 1, 0, 0.2, 1, 0),
};
/** High desert: the same summer pattern, weaker, with a real winter. */
const HIGH_DESERT_WEATHER: ClimateEnvelope["weather"] = {
  spring: odds(4, 2, 1, 0.5, 0.2, 2.5, 0),
  summer: odds(4, 1, 0.5, 2, 0, 2, 2),
  autumn: odds(5, 2, 1, 0.5, 0.5, 1, 0),
  winter: odds(3, 3, 3, 1, 1, 0.5, 0),
};
/** Gulf and tropical coasts: summer squalls and heat, no winter weather to speak of. */
const SUBTROPICAL_WEATHER: ClimateEnvelope["weather"] = {
  spring: odds(4, 2, 2, 1, 1),
  summer: odds(3, 2, 3, 3, 0.5, 0, 1.5),
  autumn: odds(4, 2, 2, 2, 1),
  winter: odds(5, 2, 2, 0.5, 1),
};
/** Dry-summer coast: marine-layer fog and heat in summer, the year's rain in winter. */
const MEDITERRANEAN_WEATHER: ClimateEnvelope["weather"] = {
  spring: odds(5, 2, 1.5, 0.5, 1.5),
  summer: odds(6, 1, 0, 0, 2, 0.5, 2),
  autumn: odds(5, 2, 1, 0.5, 1, 1, 1),
  winter: odds(3, 3, 3, 1, 1),
};
/** Humid South: the humid table plus summer heat. */
const SOUTHERN_WEATHER: ClimateEnvelope["weather"] = { ...HUMID_WEATHER, summer: odds(5, 2, 1.5, 2.5, 0.5, 0, 1.5) };
/** Southern plains: spring storms and dust, a hot summer, a mild winter. */
const SOUTHERN_PLAINS_WEATHER: ClimateEnvelope["weather"] = {
  spring: odds(3, 2, 2.5, 2, 0.5, 0.8),
  summer: odds(5, 1, 1, 2, 0, 0.8, 2.5),
  autumn: odds(5, 2, 1.5, 1, 0.5, 0.5, 0.5),
  winter: odds(5, 3, 2, 0.5, 1),
};
/** Open plains: the humid table plus spring and summer blowing dust. */
const PLAINS_WEATHER: ClimateEnvelope["weather"] = { ...HUMID_WEATHER, spring: odds(3, 2, 2.5, 1.5, 0.5, 0.8), summer: odds(6, 2, 1, 2.5, 0.2, 0.6, 0.8) };

const DESERT_SUN: SunProfile = { tint: 0xfff0d2, contrast: 1.28, shadow: 0x1c1a4a, shadowAlpha: 0.3 };
const CANYON_SUN: SunProfile = { tint: 0xffecd0, contrast: 1.22, shadow: 0x221c48, shadowAlpha: 0.28 };
const COAST_SUN: SunProfile = { tint: 0xfff6e4, contrast: 1.1, shadow: 0x1a2440, shadowAlpha: 0.24 };
const TEMPERATE_SUN: SunProfile = { tint: 0xffffff, contrast: 1, shadow: 0x1a140c, shadowAlpha: 0.22 };
const NORTHERN_SUN: SunProfile = { tint: 0xeef2f6, contrast: 0.9, shadow: 0x101820, shadowAlpha: 0.18 };

type ZoneTraits = Omit<ClimateEnvelope, "id" | "winterMeanC" | "allowsSnow" | "allowsFreeze">;

const ZONES: Readonly<Record<ClimateId, ZoneTraits>> = {
  "sonoran-desert": { label: "Sonoran Desert", geography: geo(33, 350, 0.95, 0.05, "granite"), landscape: "desert", biome: "arid-scrub", soil: "pale-caliche", winterLook: "summer", roofs: "southwest", walls: "southwest", sun: DESERT_SUN, weather: DESERT_WEATHER },
  "mojave-desert": { label: "Mojave Desert", geography: geo(35.5, 600, 1, 0.05, "granite"), landscape: "desert", biome: "arid-scrub", soil: "pale-caliche", winterLook: "summer", roofs: "southwest", walls: "southwest", sun: DESERT_SUN, weather: DESERT_WEATHER },
  "chihuahuan-desert": { label: "Chihuahuan Desert", geography: geo(31.5, 1100, 0.85, 0.05, "limestone"), landscape: "desert", biome: "arid-scrub", soil: "red-sandstone", winterLook: "summer", roofs: "southwest", walls: "southwest", sun: DESERT_SUN, weather: DESERT_WEATHER },
  canyonlands: { label: "Canyonlands", geography: geo(37.5, 1500, 0.8, 0, "sandstone"), landscape: "canyonlands", biome: "arid-scrub", soil: "red-sandstone", winterLook: "summer", roofs: "southwest", walls: "southwest", sun: CANYON_SUN, weather: HIGH_DESERT_WEATHER },
  "great-basin": { label: "Great Basin", geography: geo(40, 1350, 0.8, 0, "granite"), landscape: "desert", biome: "arid-scrub", soil: "pale-caliche", winterLook: "summer", roofs: "temperate", walls: "mountain", sun: CANYON_SUN, weather: HIGH_DESERT_WEATHER },
  "mediterranean-coast": { label: "Mediterranean Coast", geography: geo(34, 50, 0.6, 0.9, "alluvium"), landscape: "subtropical", biome: "subtropical-coast", soil: "coastal-sand", winterLook: "spring", roofs: "southwest", walls: "pacific", sun: COAST_SUN, weather: MEDITERRANEAN_WEATHER },
  "gulf-subtropical": { label: "Gulf Subtropical", geography: geo(29, 10, 0.15, 0.7, "limestone"), landscape: "subtropical", biome: "subtropical-coast", soil: "coastal-sand", winterLook: "spring", roofs: "subtropical", walls: "gulf", sun: COAST_SUN, weather: SUBTROPICAL_WEATHER },
  tropical: { label: "Tropical", geography: geo(21, 20, 0.2, 1, "volcanic"), landscape: "subtropical", biome: "subtropical-coast", soil: "volcanic-red", winterLook: "summer", roofs: "subtropical", walls: "gulf", sun: COAST_SUN, weather: SUBTROPICAL_WEATHER },
  "humid-south": { label: "Humid South", geography: geo(33, 150, 0.2, 0.3, "alluvium"), landscape: "forest", biome: "temperate-broadleaf", soil: "volcanic-red", winterLook: "autumn", roofs: "subtropical", walls: "gulf", sun: TEMPERATE_SUN, weather: SOUTHERN_WEATHER },
  "upland-south": { label: "Upland South", geography: geo(37, 300, 0.25, 0.2, "limestone"), landscape: "forest", biome: "temperate-broadleaf", soil: "dark-loam", winterLook: "autumn", roofs: "temperate", walls: "brick-belt", sun: TEMPERATE_SUN, weather: SOUTHERN_WEATHER },
  "southern-plains": { label: "Southern Plains", geography: geo(33, 400, 0.45, 0.1, "limestone"), landscape: "prairie", biome: "agricultural-plain", soil: "red-sandstone", winterLook: "autumn", roofs: "subtropical", walls: "southwest", sun: COAST_SUN, weather: SOUTHERN_PLAINS_WEATHER },
  temperate: { label: "Temperate", geography: geo(41, 200, 0.3, 0.25, "limestone"), landscape: "forest", biome: "temperate-broadleaf", soil: "dark-loam", winterLook: "autumn", roofs: "temperate", walls: "brick-belt", sun: TEMPERATE_SUN, weather: HUMID_WEATHER },
  "great-plains": { label: "Great Plains", geography: geo(41, 600, 0.5, 0, "limestone"), landscape: "prairie", biome: "agricultural-plain", soil: "prairie-loess", winterLook: "autumn", roofs: "temperate", walls: "brick-belt", sun: TEMPERATE_SUN, weather: PLAINS_WEATHER },
  alpine: { label: "Alpine", geography: geo(40, 2200, 0.4, 0, "granite"), landscape: "alpine", biome: "northern-conifer", soil: "granite-grit", winterLook: "autumn", roofs: "temperate", walls: "mountain", sun: NORTHERN_SUN, weather: HUMID_WEATHER },
  "pacific-maritime": { label: "Pacific Maritime", geography: geo(46, 60, 0.2, 0.85, "volcanic"), landscape: "forest", biome: "mixed-woodland", soil: "dark-loam", winterLook: "autumn", roofs: "temperate", walls: "pacific", sun: NORTHERN_SUN, weather: HUMID_WEATHER },
  boreal: { label: "Boreal", geography: geo(50, 300, 0.3, 0.2, "granite"), landscape: "boreal", biome: "northern-conifer", soil: "podzol", winterLook: "autumn", roofs: "temperate", walls: "mountain", sun: NORTHERN_SUN, weather: HUMID_WEATHER },
  subarctic: { label: "Subarctic", geography: geo(62, 300, 0.35, 0.2, "granite"), landscape: "boreal", biome: "northern-conifer", soil: "podzol", winterLook: "autumn", roofs: "temperate", walls: "mountain", sun: NORTHERN_SUN, weather: HUMID_WEATHER },
};

export const CLIMATES: Readonly<Record<ClimateId, ClimateEnvelope>> = Object.fromEntries(CLIMATE_IDS.map(id => {
  const traits = ZONES[id];
  return [id, {
    id, ...traits,
    winterMeanC: winterMeanC(traits.geography),
    allowsSnow: geographyAllowsSnow(traits.geography),
    allowsFreeze: geographyAllowsFreeze(traits.geography),
  } satisfies ClimateEnvelope];
})) as Record<ClimateId, ClimateEnvelope>;

export function isClimateId(value: string | null | undefined): value is ClimateId {
  return !!value && (CLIMATE_IDS as readonly string[]).includes(value);
}

export function climateById(id: string | null | undefined): ClimateEnvelope | undefined {
  return isClimateId(id) ? CLIMATES[id] : undefined;
}

/** The envelope a geography falls in. */
export function deriveClimate(geography: ClimateGeography): ClimateEnvelope {
  return CLIMATES[classifyClimate(geography)];
}

/** Maps with a biome but no county: each biome's home climate, so legacy links keep their winters. */
const BIOME_CLIMATE: Readonly<Record<BiomeId, ClimateId>> = {
  "temperate-broadleaf": "temperate",
  "northern-conifer": "boreal",
  "mixed-woodland": "temperate",
  "agricultural-plain": "great-plains",
  "arid-scrub": "sonoran-desert",
  "subtropical-coast": "gulf-subtropical",
};

export function climateForBiome(biome: BiomeId | { id: BiomeId }): ClimateEnvelope {
  return CLIMATES[BIOME_CLIMATE[typeof biome === "string" ? biome : biome.id]];
}

export function defaultClimate(): ClimateEnvelope {
  return CLIMATES.temperate;
}

/** Warm-arid and canyon country: mesas, washes and xeriscape instead of turf and woods. */
export function aridLandscape(climate: Pick<ClimateEnvelope, "landscape">): boolean {
  return climate.landscape === "desert" || climate.landscape === "canyonlands";
}

/** Snow lies on the ground: winter, in a zone that allows it. */
export function snowOnGround(season: Season, climate: Pick<ClimateEnvelope, "allowsSnow">): boolean {
  return season === "winter" && climate.allowsSnow;
}

/** Ponds are ice the dozer can cross: winter, in a zone that freezes. */
export function waterFrozen(season: Season, climate: Pick<ClimateEnvelope, "allowsFreeze">): boolean {
  return season === "winter" && climate.allowsFreeze;
}

/**
 * The season the world is painted in. A snowless winter never reaches the winter palettes,
 * snow caps or bare-branch phenology: it borrows the zone's `winterLook` instead.
 */
export function lookSeason<S extends Season>(season: S, climate: Pick<ClimateEnvelope, "allowsSnow" | "winterLook">): S | ClimateEnvelope["winterLook"] {
  return season === "winter" && !climate.allowsSnow ? climate.winterLook : season;
}

/** The named hazard a rolled sky becomes in this zone and season; `undefined` is ordinary weather. */
export function climateHazard(climate: Pick<ClimateEnvelope, "landscape" | "allowsSnow">, season: Season, condition: Condition | undefined): HazardId | undefined {
  switch (condition) {
    case "dust":
      return aridLandscape(climate) ? "haboob" : "blowing-dust";
    case "heat":
      return "heat";
    case "storm":
      if (season === "winter") return climate.allowsSnow ? "blizzard" : undefined;
      if (aridLandscape(climate)) return season === "spring" ? undefined : "monsoon";
      return climate.landscape === "subtropical" ? "squall" : undefined;
    default:
      return undefined;
  }
}

/** Conditions this zone can roll in a season, in table order. */
export function legalConditions(climate: Pick<ClimateEnvelope, "weather">, season: Season): Condition[] {
  const row = climate.weather[season];
  return (Object.keys(row) as Condition[]).filter(id => row[id] > 0);
}
