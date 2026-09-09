import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { createDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import { stepWorld } from "../sim/worldSim";
import { applyCellDamage } from "./building";
import { siteDescriptor } from "./site";

function flatten(town: ReturnType<typeof createTown>, name?: string): void {
  const particles = new ParticlePool();
  const targets = name ? town.buildings.filter((b) => b.name === name) : [town.buildings[0]!];
  for (const b of targets) {
    for (const cell of b.cells) applyCellDamage(b, cell, 999, 1, 0, particles, []);
  }
  const dozer = createDozer(town.maxX - 2, town.maxY - 2, 0);
  for (let i = 0; i < 400; i++) stepWorld(town, dozer, particles, { blade: 0, engine: 0, push: 0 }, SIM_DT);
}

describe("persistent collapsed sites", () => {
  it("creates exactly one collapsed site for a fully demolished building", () => {
    const town = createTown();
    flatten(town, "LOT 4 COTTAGE");
    const house = town.buildings[0]!;
    expect(house.fullyDown).toBe(true);
    expect(town.collapsedSites.filter((s) => s.buildingId === house.id)).toHaveLength(1);
    flatten(town, "LOT 4 COTTAGE");
    expect(town.collapsedSites.filter((s) => s.buildingId === house.id)).toHaveLength(1);
  });

  it("keeps the site after live rubble for that building is gone", () => {
    const town = createTown();
    flatten(town);
    const site = town.collapsedSites[0]!;
    expect(site).toBeTruthy();
    town.rubble.length = 0;
    expect(town.collapsedSites).toHaveLength(1);
    expect(town.collapsedSites[0]!.buildingId).toBe(site.buildingId);
    expect(town.collapsedSites[0]!.marks.length).toBeGreaterThan(4);
  });

  it("rebuilds collapsed-site state on restart and a new seed", () => {
    const town = createTown({ seed: 11 });
    flatten(town);
    expect(town.collapsedSites.length).toBeGreaterThan(0);
    const again = createTown({ seed: 11 });
    expect(again.collapsedSites).toHaveLength(0);
    const other = createTown({ seed: 12 });
    expect(other.collapsedSites).toHaveLength(0);
    flatten(again);
    flatten(other);
    expect(siteDescriptor(again.collapsedSites[0]!)).not.toBe(siteDescriptor(other.collapsedSites[0]!));
  });
});
