import { describe, expect, it } from "vitest";
import { BIOME_IDS, BIOME_PROFILES, biomeById, selectBiome, selectCampaignBiome, speciesCompatible } from "./biomes";
import { getAsset } from "./catalog";
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

  it("keeps arid scrub dry, sparse and out of every seed roll", () => {
    const arid = BIOME_PROFILES["arid-scrub"];
    expect(BIOME_IDS).toContain("arid-scrub");
    expect(biomeById("arid-scrub")).toBe(arid);
    expect(arid.groundCover).toEqual(["dirt", "scrub", "prairie"]);
    expect(arid.waterLikelihood).toBeLessThanOrEqual(0.15);
    expect(arid.forestDensity).toBeLessThanOrEqual(0.12);
    expect(arid.fieldDensity).toBeLessThanOrEqual(0.1);
    for (const id of ["saguaro-cactus", "yucca-scrub", "desert-palm"]) {
      expect(getAsset(id).family).toBe("vegetation");
      expect(speciesCompatible(arid, id)).toBe(true);
      expect(speciesCompatible(BIOME_PROFILES["temperate-broadleaf"], id)).toBe(false);
    }
    expect(speciesCompatible(arid, "oak")).toBe(false);
    expect(speciesCompatible(arid, "pine-shrub")).toBe(false);
    // Legacy seeds and districts never roll it: only a region assigns it.
    for (let n = 1; n <= 400; n++) expect(selectCampaignBiome(Math.imul(n, 0x9e3779b1) >>> 0).id).not.toBe("arid-scrub");
    for (const topology of TOPOLOGIES) for (let n = 1; n <= 60; n++) expect(selectBiome("d30", Math.imul(n, 0x9e3779b1) >>> 0, topology).id).not.toBe("arid-scrub");
  });

  it("does not treat mixed woodland as an accident", () => {
    expect(BIOME_PROFILES["mixed-woodland"].trees).toEqual(["oak", "pine"]);
    expect(BIOME_PROFILES["northern-conifer"].groundCover).not.toContain("dirt");
  });
});

describe("landscape species", () => {
  it("keeps desert, coastal and forest flora in their own biomes", () => {
    const arid = BIOME_PROFILES["arid-scrub"];
    const coast = BIOME_PROFILES["subtropical-coast"];
    for (const id of ["prickly-pear", "agave", "creosote-bush", "sagebrush", "joshua-tree", "mesquite"]) {
      expect(getAsset(id).family).toBe("vegetation");
      expect(speciesCompatible(arid, id), id).toBe(true);
      expect(speciesCompatible(coast, id), id).toBe(false);
      for (const forest of ["temperate-broadleaf", "northern-conifer", "mixed-woodland", "agricultural-plain"] as const) {
        expect(speciesCompatible(BIOME_PROFILES[forest], id), `${forest} ${id}`).toBe(false);
      }
    }
    for (const id of ["sabal-palm", "palmetto-scrub"]) {
      expect(speciesCompatible(coast, id), id).toBe(true);
      expect(speciesCompatible(arid, id), id).toBe(false);
      expect(speciesCompatible(BIOME_PROFILES["temperate-broadleaf"], id), id).toBe(false);
    }
    // Live oak carries the coastal woods; rock, orchard trees and ranch gear are not species at all.
    expect(speciesCompatible(coast, "oak")).toBe(true);
    for (const id of ["granite-boulder", "sandstone-rock", "citrus-tree", "windpump", "solar-panel"]) {
      for (const biome of BIOME_IDS) expect(speciesCompatible(BIOME_PROFILES[biome], id)).toBe(true);
    }
  });
});
