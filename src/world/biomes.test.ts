import { describe, expect, it } from "vitest";
import { BIOME_IDS, BIOME_PROFILES, selectBiome, speciesCompatible } from "./biomes";
import type { TopologyFamily } from "./rural";

const TOPOLOGIES: TopologyFamily[] = ["county", "crossroads", "tjunction", "curve-farm", "loop", "frontage"];

describe("biome selection", () => {
  it("is deterministic for district, seed, and topology", () => {
    for (const topology of TOPOLOGIES) {
      const a = selectBiome("d10", 0x51a11, topology);
      const b = selectBiome("d10", 0x51a11, topology);
      expect(a.id).toBe(b.id);
      expect(a).toEqual(BIOME_PROFILES[a.id]);
    }
  });

  it("stays inside the four explicit palettes", () => {
    for (const district of ["d10", "d30", "d100"] as const) {
      for (const topology of TOPOLOGIES) {
        for (const seed of [1, 19, 0x51a11, 334353]) {
          expect(BIOME_IDS).toContain(selectBiome(district, seed, topology).id);
        }
      }
    }
  });

  it("keeps species inside one compatible palette", () => {
    expect(speciesCompatible(BIOME_PROFILES["temperate-broadleaf"], "oak")).toBe(true);
    expect(speciesCompatible(BIOME_PROFILES["temperate-broadleaf"], "pine")).toBe(false);
    expect(speciesCompatible(BIOME_PROFILES["northern-conifer"], "pine")).toBe(true);
    expect(speciesCompatible(BIOME_PROFILES["northern-conifer"], "oak")).toBe(false);
    expect(speciesCompatible(BIOME_PROFILES["mixed-woodland"], "oak")).toBe(true);
    expect(speciesCompatible(BIOME_PROFILES["mixed-woodland"], "pine")).toBe(true);
    expect(speciesCompatible(BIOME_PROFILES["agricultural-plain"], "oak-shrub")).toBe(true);
    expect(speciesCompatible(BIOME_PROFILES["agricultural-plain"], "pine-sapling")).toBe(false);
    expect(speciesCompatible(BIOME_PROFILES["northern-conifer"], "mailbox")).toBe(true);
  });

  it("does not treat mixed woodland as an accident", () => {
    expect(BIOME_PROFILES["mixed-woodland"].trees).toEqual(["oak", "pine"]);
    expect(BIOME_PROFILES["northern-conifer"].groundCover).not.toContain("dirt");
  });
});
