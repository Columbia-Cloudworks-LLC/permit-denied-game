import { Rng } from "../game/rng";
import type { DistrictId } from "../game/session";
import type { TopologyFamily } from "./rural";

export type BiomeId =
  | "temperate-broadleaf"
  | "northern-conifer"
  | "mixed-woodland"
  | "agricultural-plain";

export type FieldCropId = "corn" | "wheat" | "soy";
export type FieldState = "tilled" | "short" | "mature" | "stubble";
export type BiomeGroundCover = "grass" | "scrub" | "dirt";

export interface BiomeProfile {
  id: BiomeId;
  trees: readonly string[];
  saplings: readonly string[];
  shrubs: readonly string[];
  crops: readonly FieldCropId[];
  waterLikelihood: number;
  forestDensity: number;
  fieldDensity: number;
  groundCover: readonly BiomeGroundCover[];
}

export const BIOME_IDS: readonly BiomeId[] = [
  "temperate-broadleaf",
  "northern-conifer",
  "mixed-woodland",
  "agricultural-plain",
];

export const BIOME_SALT = 0xb10be;

export const BIOME_PROFILES: Record<BiomeId, BiomeProfile> = {
  "temperate-broadleaf": {
    id: "temperate-broadleaf",
    trees: ["oak"],
    saplings: ["oak-sapling"],
    shrubs: ["oak-shrub"],
    crops: ["corn", "wheat"],
    waterLikelihood: 0.72,
    forestDensity: 0.7,
    fieldDensity: 0.35,
    groundCover: ["grass", "scrub", "dirt"],
  },
  "northern-conifer": {
    id: "northern-conifer",
    trees: ["pine"],
    saplings: ["pine-sapling"],
    shrubs: ["pine-shrub"],
    crops: ["wheat"],
    waterLikelihood: 0.8,
    forestDensity: 0.85,
    fieldDensity: 0.15,
    groundCover: ["grass", "scrub"],
  },
  "mixed-woodland": {
    id: "mixed-woodland",
    trees: ["oak", "pine"],
    saplings: ["oak-sapling", "pine-sapling"],
    shrubs: ["oak-shrub", "pine-shrub"],
    crops: ["corn", "wheat", "soy"],
    waterLikelihood: 0.78,
    forestDensity: 0.75,
    fieldDensity: 0.3,
    groundCover: ["grass", "scrub"],
  },
  "agricultural-plain": {
    id: "agricultural-plain",
    trees: ["oak"],
    saplings: ["oak-sapling"],
    shrubs: ["oak-shrub"],
    crops: ["corn", "wheat", "soy"],
    waterLikelihood: 0.45,
    forestDensity: 0.22,
    fieldDensity: 0.95,
    groundCover: ["grass", "dirt"],
  },
};

const SPECIES = new Set(["oak", "pine", "oak-sapling", "pine-sapling", "oak-shrub", "pine-shrub"]);

export function biomeCompatibleSpecies(): readonly string[] {
  return [...SPECIES];
}

export function speciesCompatible(biome: BiomeProfile, assetId: string): boolean {
  if (!SPECIES.has(assetId)) return true;
  return biome.trees.includes(assetId) || biome.saplings.includes(assetId) || biome.shrubs.includes(assetId);
}

export function selectBiome(district: Exclude<DistrictId, "classic">, seed: number, topology: TopologyFamily): BiomeProfile {
  const rng = new Rng(seed ^ BIOME_SALT);
  const weights = biomeWeights(district, topology);
  return BIOME_PROFILES[pickWeighted(BIOME_IDS, (id) => Math.max(0, weights[id]), rng)];
}

export function defaultBiome(): BiomeProfile {
  return BIOME_PROFILES["temperate-broadleaf"];
}

function biomeWeights(district: Exclude<DistrictId, "classic">, topology: TopologyFamily): Record<BiomeId, number> {
  const weights: Record<BiomeId, number> = {
    "temperate-broadleaf": 3,
    "northern-conifer": 2,
    "mixed-woodland": 3,
    "agricultural-plain": 2,
  };
  switch (topology) {
    case "curve-farm":
    case "frontage":
      weights["agricultural-plain"] += 10;
      break;
    case "county":
      weights["temperate-broadleaf"] += 4;
      break;
    case "tjunction":
      weights["northern-conifer"] += 5;
      break;
    case "loop":
    case "crossroads":
      weights["mixed-woodland"] += 4;
      break;
    default: {
      const _never: never = topology;
      return _never;
    }
  }
  if (district === "d10") weights["agricultural-plain"] += 2;
  if (district === "d100") {
    weights["mixed-woodland"] += 2;
    weights["agricultural-plain"] -= 1;
  }
  return weights;
}

function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = rng.range(0, Math.max(1e-6, total));
  for (const item of items) {
    roll -= weight(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!;
}
