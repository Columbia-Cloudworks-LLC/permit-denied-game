import { describe, expect, it } from "vitest";
import { DOZER, SIM_DT } from "../game/constants";
import { createBuildingFromArchetype } from "../structure/building";
import type { CoverKind, WorldEvent } from "../structure/types";
import { impactHeft } from "./worldSim";
import { ParticlePool } from "../fx/particles";
import { createDozer } from "../vehicle/dozer";
import { pointOnRoad } from "../world/roads";
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

  const patch = (town: ReturnType<typeof createTown>, cover: CoverKind) =>
    town.ground.push({ x: 0, y: 0, w: 40, d: 40, heading: 0, cover, seed: 1, z: 0.02 });

  /** Drive straight at 4 m/s for the given distance, emitting cues each fixed step. */
  function roll(town: ReturnType<typeof createTown>, bladeDown: boolean, metres: number, start = { x: 6, y: 20 }) {
    const dozer = createDozer(start.x, start.y, 0), particles = new ParticlePool(), events: WorldEvent[] = [];
    dozer.vx = 4;
    dozer.bladeDown = bladeDown;
    for (let t = 0; t < metres / 4; t += SIM_DT) {
      dozer.x += dozer.vx * SIM_DT;
      dozer.odo += dozer.vx * SIM_DT;
      emitDozerCues(town, dozer, particles, events, SIM_DT);
      particles.step(SIM_DT);
    }
    return { particles, events };
  }

  it("strikes sparks and a grinding scrape from a lowered blade on pavement only", () => {
    const paved = createTown();
    patch(paved, "parking");
    const down = roll(paved, true, 3);
    expect(down.events.some((e) => e.kind === "scrape")).toBe(true);
    const raised = createTown();
    patch(raised, "parking");
    expect(roll(raised, false, 3).events.some((e) => e.kind === "scrape")).toBe(false);
    const grass = createTown();
    patch(grass, "grass");
    expect(roll(grass, true, 3).events).toHaveLength(0);
    const sparks = new ParticlePool();
    sparks.sparks(0, 0, 3, 0, 4, 1.2);
    expect(sparks.items.filter((p) => p.alive && p.kind === "spark").every((p) => p.vx > 0)).toBe(true);
    for (let i = 0; i < 40; i++) sparks.step(SIM_DT);
    expect(sparks.items.some((p) => p.alive && p.kind === "spark")).toBe(false);
  });

  it("presses continuous, surface-tinted treads that weather as more are laid", () => {
    const town = createTown();
    patch(town, "dirt");
    const before = town.marks.length;
    roll(town, false, 10);
    const treads = town.marks.slice(before).filter((m) => m.kind === "tire");
    expect(treads.length).toBeGreaterThanOrEqual(18);
    expect(treads.every((m) => m.tint === 0x2a1f12)).toBe(true);
    const left = treads.filter((m) => m.y < 20).sort((a, b) => a.x - b.x);
    for (let i = 1; i < left.length; i++) {
      expect(left[i]!.x - left[i]!.w / 2).toBeLessThanOrEqual(left[i - 1]!.x + left[i - 1]!.w / 2);
    }
    expect(left[0]!.alpha).toBeLessThan(left[left.length - 1]!.alpha);
  });

  it("leaves no tread on road asphalt, but the lowered blade still sparks there", () => {
    const town = createTown();
    let start: { x: number; y: number } | undefined;
    for (let y = town.minY + 2; y < town.maxY - 2 && !start; y += 0.5) {
      for (let x = town.minX + 2; x < town.maxX - 12; x += 0.5) {
        if ([0, 2, 4, 6].every((dx) => pointOnRoad(town.network, x + dx, y))) { start = { x, y }; break; }
      }
    }
    const before = town.marks.filter((m) => m.kind === "tire").length;
    const { events } = roll(town, true, 3, start!);
    expect(town.marks.filter((m) => m.kind === "tire")).toHaveLength(before);
    expect(events.some((e) => e.kind === "scrape")).toBe(true);
  });
});

describe("impact heft", () => {
  it("weighs dense materials and taller structures heavier", () => {
    const low = createBuildingFromArchetype("ranch", "T", 0, 0);
    expect(impactHeft(low, "concrete")).toBeGreaterThan(impactHeft(low, "wood"));
    expect(impactHeft({ ...low, floors: 6 }, "brick")).toBeGreaterThan(impactHeft({ ...low, floors: 1 }, "brick"));
  });

});

describe("dozer pivot and track-crawl cues", () => {
  const patch = (town: ReturnType<typeof createTown>, cover: CoverKind) =>
    town.ground.push({ x: 0, y: 0, w: 40, d: 40, heading: 0, cover, seed: 1, z: 0.02 });

  /** Pivot in place at full steer, off the road, for half a second, emitting cues each step. */
  function pivot(town: ReturnType<typeof createTown>, speed = 0) {
    const dozer = createDozer(6, 20, 0), particles = new ParticlePool(), events: WorldEvent[] = [];
    for (let t = 0; t < 0.5; t += SIM_DT) {
      dozer.vx = Math.cos(dozer.heading) * speed;
      dozer.vy = Math.sin(dozer.heading) * speed;
      dozer.yaw = DOZER.steer;
      dozer.heading += dozer.yaw * SIM_DT;
      emitDozerCues(town, dozer, particles, events, SIM_DT);
    }
    return { dozer, particles, events };
  }

  it("churns surface-tinted clumps from the inside track in a neutral turn, but not on pavement", () => {
    const grass = createTown();
    patch(grass, "grass");
    const turned = pivot(grass);
    const clumps = turned.particles.items.filter((p) => p.alive && p.kind === "crop");
    expect(clumps.length).toBeGreaterThan(0);
    // Positive yaw turns toward the right-hand side, so the inside track and its clumps are there.
    const right = { x: -Math.sin(turned.dozer.heading), y: Math.cos(turned.dozer.heading) };
    expect(clumps.some((p) => (p.x - 6) * right.x + (p.y - 20) * right.y > 0.2)).toBe(true);
    const snow = createTown();
    snow.groundCondition = "snow";
    patch(snow, "dirt");
    expect(pivot(snow).particles.items.some((p) => p.alive && p.kind === "crop" && p.tint === 0xe6ecef)).toBe(true);
    const paved = createTown();
    patch(paved, "parking");
    expect(pivot(paved).particles.items.some((p) => p.alive && p.kind === "crop")).toBe(false);
    expect(pivot(grass).events.some((e) => e.kind === "track-bind")).toBe(false);
    expect(pivot(grass, 4).events.some((e) => e.kind === "track-bind")).toBe(true);
  });

  it("reports the blade landing once, and rolls the hull when one track mounts a pile", () => {
    const town = createTown();
    const dozer = createDozer(6, 20, 0), events: WorldEvent[] = [];
    dozer.bladeLanded = true;
    emitDozerCues(town, dozer, new ParticlePool(), events, SIM_DT);
    expect(events.filter((e) => e.kind === "blade-drop")).toHaveLength(1);
    // Rubble heaped under the right-hand (+y) track only.
    for (let i = 0; i < 40; i++) town.pile.addMass(6 + (i % 5) * 0.2, 20.62, 1.2, "brick");
    dozer.bladeLanded = false;
    dozer.vy = 0;
    dozer.vx = 0;
    emitDozerCues(town, dozer, new ParticlePool(), [], SIM_DT);
    expect(dozer.rideRoll).toBeGreaterThan(0);
    expect(dozer.rideRoll).toBeLessThanOrEqual(0.026);
  });
});
