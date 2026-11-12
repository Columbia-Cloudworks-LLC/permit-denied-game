import { expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage, createBuildingFromArchetype } from "../structure/building";
import { buildingSolids, landformSolids, stepVehicleWorld } from "./world";
import { describe } from "vitest";
import { campaignLevelById } from "../game/campaign";
import { BIOME_PROFILES } from "../world/biomes";
import { spawnAsset } from "../world/catalog";
import { CLIMATES } from "../world/climate";
import { createTown } from "../world/town";
import type { MesaFeature } from "../world/terrainFeatures";
import { createDozer } from "./dozer";
import { createVehicle } from "./runtime";

it("counts a column whose cladding is stripped, so vehicles stop hitting the old wall-sized box", () => {
  const b = createBuildingFromArchetype("steel-warehouse", "SKIN", 0, 0);
  const column = b.cells.find((c) => c.floor === 0 && c.role === "column" && c.cladding)!;
  const before = { ...buildingSolids(b) };
  applyCellDamage(b, column, column.cladding!.hp, 0, 1, new ParticlePool(), []);
  // The column still stands, but its footprint shrank: the stamp must move.
  expect(column.hp).toBeGreaterThan(0);
  const after = buildingSolids(b);
  expect(after.standing).toBe(before.standing);
  expect(after.stripped).toBe(before.stripped + 1);
  // Destroying the stripped column moves the standing count instead.
  applyCellDamage(b, column, 999, 0, 1, new ParticlePool(), []);
  expect(buildingSolids(b).standing).toBe(before.standing - 1);
});

describe("landform solids", () => {
  const town = createTown({ district: "d30", seed: 19, campaign: campaignLevelById("county"), biome: BIOME_PROFILES["arid-scrub"], climate: CLIMATES.canyonlands });
  const mesa = town.features.find((f): f is MesaFeature => f.kind === "mesa")!;

  it("boxes every rock cell of a mesa, and nothing of its talus ring", () => {
    const boxes = landformSolids(town.features);
    const covered = (x: number, y: number): boolean => boxes.some((b) => Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.d / 2);
    let rock = 0;
    for (let i = 0; i < mesa.tiers.length; i++) {
      const x = mesa.x + (i % mesa.cols) + 0.5, y = mesa.y + ((i / mesa.cols) | 0) + 0.5;
      expect(covered(x, y)).toBe(mesa.tiers[i]! > 0);
      if (mesa.tiers[i]) rock++;
    }
    expect(boxes.reduce((sum, b) => sum + b.w * b.d, 0)).toBe(town.features.filter((f): f is MesaFeature => f.kind === "mesa").reduce((sum, f) => sum + f.tiers.filter((t) => t > 0).length, 0));
    expect(rock).toBeGreaterThan(0);
    expect(landformSolids(createTown({ district: "d10", seed: 19 }).features)).toEqual([]);
  });

  it("stops a car driven at a cliff and at a fixed boulder", () => {
    const i = mesa.tiers.findIndex((tier, n) => tier > 0 && mesa.tiers[n - 1] === 0);
    const cy = mesa.y + ((i / mesa.cols) | 0) + 0.5;
    const edge = mesa.x + (i % mesa.cols);
    const boulder = spawnAsset("sandstone-boulder", edge - 14, cy - 0.75);
    town.props.push(boulder);
    const dozer = createDozer(town.spawnX, town.spawnY, 0);
    for (const [startX, wall] of [[edge - 4, edge], [edge - 18, boulder.x]] as const) {
      const car = createVehicle("car", startX, cy, 0);
      town.vehicles.push(car);
      for (let step = 0; step < 240; step++) {
        car.vx = 6; car.vy = 0; car.heading = 0; car.sleeping = false;
        stepVehicleWorld(town, dozer, new ParticlePool(), [], 1 / 60);
      }
      // Four seconds at 6 u/s would carry it 24 units; the solid holds its nose at the face.
      expect(car.x).toBeLessThan(wall + 0.6);
      expect(car.x).toBeGreaterThan(startX - 3);
      town.vehicles.length = 0;
    }
    expect(boulder.hp).toBe(boulder.maxHp);
  });
});
