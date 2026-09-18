import { describe, expect, it, vi } from "vitest";
import { campaignLevelById } from "../game/campaign";
import { ARCHETYPES } from "../world/archetypes";
import { SURFACE_CHUNK } from "../world/terrain";
import { evaluateCampaignComposition } from "../world/campaignComposition";
import {
  DENSE_CITY_LEVEL,
  DENSE_CITY_SCENES,
  DENSE_CITY_SEED,
  createDenseCityTown,
  formatDenseCityBench,
  measureDenseCityBench,
  measureDenseCityScene,
} from "./denseCityBench";

describe("dense-city render bench", () => {
  it("keeps downtown density and measures intact, demolition, and overview frames", { timeout: 120_000 }, () => {
    const town = createDenseCityTown();
    const level = campaignLevelById(DENSE_CITY_LEVEL);
    expect(town.buildings.length).toBe(level.generation.buildingCount);
    const composition = evaluateCampaignComposition(town.buildings, level, ARCHETYPES);
    expect(composition.ok, composition.issues.join("; ")).toBe(true);
    const tall = town.buildings.filter((building) => building.floors >= 20).length;
    expect(tall / town.buildings.length).toBeGreaterThanOrEqual(0.22);

    const first = measureDenseCityScene(DENSE_CITY_SCENES[0]!, { seed: DENSE_CITY_SEED, warmup: 2, frames: 8 });
    const second = measureDenseCityScene(DENSE_CITY_SCENES[0]!, { seed: DENSE_CITY_SEED, warmup: 2, frames: 8 });
    expect(first.buildings).toBe(second.buildings);
    expect(first.cells).toBe(second.cells);
    expect(first.visible).toBe(second.visible);
    expect(first.commands).toBe(second.commands);

    const messages: string[] = [];
    const capture = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(capture);
    const group = vi.spyOn(console, "groupCollapsed").mockImplementation(capture);
    const samples = measureDenseCityBench({ seed: DENSE_CITY_SEED, warmup: 2, frames: 12 });
    const pixi = messages.filter((message) => /addChild: Only Containers will be allowed to add children/i.test(message));
    warn.mockRestore();
    group.mockRestore();
    expect(pixi, pixi.join("\n")).toEqual([]);
    expect(samples).toHaveLength(DENSE_CITY_SCENES.length);
    for (const sample of samples) {
      expect(sample.buildings).toBe(level.generation.buildingCount);
      expect(sample.commands).toBeGreaterThan(0);
      expect(sample.drawMs.mean).toBeGreaterThan(0);
    }
    const byId = Object.fromEntries(samples.map((sample) => [sample.id, sample]));
    expect(byId["intact-street-desktop"]!.commands).toBeLessThan(1500);
    expect(byId["intact-overview-desktop"]!.commands).toBeLessThan(2600);
    expect(byId["intact-street-mobile"]!.commands).toBeLessThan(byId["intact-street-desktop"]!.commands);
    const street = byId["intact-street-desktop"]!;
    expect(street.groundRebuilds).toBe(0);
    expect(street.terrainChunks).toBe(
      Math.ceil(town.surface.cols / SURFACE_CHUNK) * Math.ceil(town.surface.rows / SURFACE_CHUNK),
    );
    expect(street.terrainChunks).toBeLessThanOrEqual(512);
    expect(street.terrainCells).toBeLessThanOrEqual(512 * 512);
    expect(town.ground.some((g) => g.w === 6.2 || g.z === -0.02)).toBe(false);
    // eslint-disable-next-line no-console
    console.log(formatDenseCityBench(samples));
  });
});
