import type { BiomeId, BiomeProfile } from "./biomes";

/** Map-level ground weather. Shared by terrain tiles and lot covers; never rolled per lot. */
export type GroundCondition = "clear" | "snow";

export function mapGroundCondition(biome: BiomeProfile | BiomeId): GroundCondition {
  const id = typeof biome === "string" ? biome : biome.id;
  switch (id) {
    case "northern-conifer":
      return "snow";
    case "temperate-broadleaf":
    case "mixed-woodland":
    case "agricultural-plain":
      return "clear";
    default: {
      const _never: never = id;
      return _never;
    }
  }
}
