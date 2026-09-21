import { describe, expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { createDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import { coverAtPoint, emitDozerCues } from "./dozerCues";

describe("dozer surface cues", () => {
  it("samples lot cover and emits bounded track marks on soft ground", () => {
    const town = createTown();
    town.ground.push({
      x: 4,
      y: 4,
      w: 8,
      d: 8,
      heading: 0,
      cover: "dirt",
      seed: 1,
      z: 0.02,
    });
    const dozer = createDozer(8, 8, 0);
    dozer.vx = 4;
    dozer.odo = 0.88;
    dozer.heat = 0.4;
    const particles = new ParticlePool();
    const before = town.marks.length;
    emitDozerCues(town, dozer, particles, [], 1 / 60);
    expect(coverAtPoint(town, 8, 8)).toBe("dirt");
    expect(town.marks.length).toBeGreaterThanOrEqual(before);
    expect(town.marks.length).toBeLessThanOrEqual(before + 8);
    expect(particles.items.filter((p) => p.alive).length).toBeGreaterThan(0);
    expect(particles.items.filter((p) => p.alive).length).toBeLessThanOrEqual(12);
  });
});
