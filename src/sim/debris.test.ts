import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from "../structure/building";
import { DEBRIS } from "../game/constants";
import { createDozer, stepDozer } from "../vehicle/dozer";
import { createRoadVehicle, roadSpeed, stepRoadVehicle } from "../vehicle/roadVehicle";
import { createTown } from "../world/town";
import {
  addDebrisBody,
  crushBody,
  obstructionAt,
  spawnCollapseDebris,
  stepDebris,
  totalDebrisMass,
} from "./debris";
import { stepWorld, type Upgrades } from "./worldSim";

const upgrades: Upgrades = { blade: 0, engine: 0, push: 0 };

function stepOnce(town: ReturnType<typeof createTown>, dozer = createDozer(2, 2, 0), dt = SIM_DT) {
  const particles = new ParticlePool();
  return stepDebris(town, dozer, particles, [], 1, dt);
}

describe("debris spawn and mass", () => {
  it('conserves structural mass and ownership when a burst goes directly to pile', () => {
    const town = createTown();
    town.pile.ownerAt = () => 'large-building';
    const spawn = { x: 12, y: 18, dx: 1, dy: 0, material: 'concrete' as const, floor: 20, cellSize: 1.15 };
    expect(spawnCollapseDebris(town, spawn, 0)).toEqual([]);
    expect(totalDebrisMass(town)).toBeCloseTo(1.15 * 1.15 * 1.85 * 1.35, 5);
    town.pile.removeOwner('large-building');
    expect(totalDebrisMass(town)).toBeCloseTo(0, 5);
  });
  it("spawns debris along collapse displacement and direction", () => {
    const town = createTown();
    const house = town.buildings[0]!;
    const cell = house.grid[0]![0]![0]!;
    const particles = new ParticlePool();
    applyCellDamage(house, cell, 999, 1, 0, particles, []);
    const steps = Math.ceil(2 / SIM_DT);
    for (let i = 0; i < steps; i++) {
      const out = stepStructures([house], SIM_DT, particles, []);
      for (const spawn of out.rubbleSpawns) {
        spawnCollapseDebris(town, spawn);
      }
    }
    expect(town.rubble.length).toBeGreaterThan(0);
    const cx = house.x + (cell.gx + 0.5) * house.cellSize;
    const cy = house.y + (cell.gy + 0.5) * house.cellSize;
    const meanX = town.rubble.reduce((s, r) => s + r.x, 0) / town.rubble.length;
    const meanY = town.rubble.reduce((s, r) => s + r.y, 0) / town.rubble.length;
    const along = (meanX - cx) * cell.fallDx + (meanY - cy) * cell.fallDy;
    expect(along).toBeGreaterThan(0.2);
  });

  it("preserves approximate mass through crushing", () => {
    const town = createTown();
    spawnCollapseDebris(town, {
      x: 12,
      y: 18,
      dx: 1,
      dy: 0,
      material: "concrete",
      floor: 1,
      cellSize: 1.15,
    });
    const before = totalDebrisMass(town);
    expect(before).toBeGreaterThan(0.8);
    const remnant = town.rubble.find((r) => r.layer === "remnant");
    expect(remnant).toBeTruthy();
    crushBody(town, remnant!, new ParticlePool());
    const after = totalDebrisMass(town);
    expect(Math.abs(after - before)).toBeLessThan(0.04);
    expect(Math.abs(after - before) / before).toBeLessThan(0.05);
  });

  it("spawns recognizable roof remnants at the falling panel instead of generic scatter", () => {
    const town = createTown();
    const created = spawnCollapseDebris(town, {
      x: 14.2,
      y: 18.4,
      dx: 0.15,
      dy: 0.8,
      material: "wood",
      floor: 1,
      cellSize: 1.15,
      source: "roof",
      heading: Math.PI / 2,
      elev: 0.62,
      panelW: 1.05,
      panelD: 0.48,
    });
    const panels = created.filter((r) => r.skin === "roofing");
    expect(panels.length).toBe(1);
    expect(panels[0]!.shape).toBe("panel");
    expect(panels[0]!.thickness).toBeGreaterThan(0.1);
    expect(Math.hypot(panels[0]!.x - 14.2, panels[0]!.y - 18.4)).toBeLessThan(0.55);
    expect(created.filter((r) => r.layer === "fragment").length).toBeLessThanOrEqual(2);
  });

  it("keeps metal roof remnants on the metal finish instead of ranch shingles", () => {
    const town = createTown();
    const created = spawnCollapseDebris(town, {
      x: 16,
      y: 12,
      dx: 0.2,
      dy: 0.7,
      material: "metal",
      floor: 1,
      cellSize: 1.15,
      source: "roof",
      heading: 0.4,
      elev: 0.2,
      panelW: 1.1,
      panelD: 0.7,
    });
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((r) => r.skin !== "roofing")).toBe(true);
    expect(created.some((r) => r.shape === "panel" && r.material === "metal")).toBe(true);
  });

  it("keeps ranch roof collapse inside debris caps", () => {
    const town = createTown();
    const ranch = createBuildingFromArchetype("ranch", "BOUND", 20, 8);
    town.buildings.push(ranch);
    const particles = new ParticlePool();
    const dozer = createDozer(22, 14, -Math.PI / 2);
    for (const cell of ranch.cells) applyCellDamage(ranch, cell, 999, 0, 1, particles, []);
    for (let i = 0; i < 240; i++) {
      stepWorld(town, dozer, particles, upgrades, SIM_DT);
    }
    expect(ranch.roofs.every((r) => r.state === "gone")).toBe(true);
    expect(town.rubble.filter((r) => r.layer === "remnant").length).toBeLessThanOrEqual(DEBRIS.remnantCap);
    expect(town.rubble.filter((r) => r.layer === "fragment").length).toBeLessThanOrEqual(DEBRIS.fragmentCap);
    const awake = town.rubble.filter((r) => !r.sleeping).length;
    expect(awake).toBeLessThanOrEqual(DEBRIS.activeCap + 8);
  });
});

describe("blade and vehicle contact", () => {
  it.each([false, true])("moving debris wakes a sleeping target regardless of creation order (%s)", sleeperFirst => {
    const town = createTown();
    const make = (x: number) => addDebrisBody(town, { x, y: 18, w: .6, d: .6, material: "metal", layer: "remnant", mass: 1, heading: 0 });
    const first = make(sleeperFirst ? 12.4 : 12);
    const second = make(sleeperFirst ? 12 : 12.4);
    const sleeper = sleeperFirst ? first : second;
    const moving = sleeperFirst ? second : first;
    sleeper.sleeping = true;
    sleeper.vx = sleeper.vy = sleeper.omega = 0;
    moving.vx = 2;
    stepOnce(town);
    expect(sleeper.sleeping).toBe(false);
    expect(sleeper.x).toBeGreaterThan(12.4);
    expect(totalDebrisMass(town)).toBeCloseTo(2, 4);
  });

  it("blade contact pushes and rotates off-center debris", () => {
    const town = createTown();
    const dozer = createDozer(10, 17.6, 0);
    dozer.bladeDown = true;
    dozer.vx = 4;
    const slab = addDebrisBody(town, {
      x: 11.55,
      y: 18.15,
      w: 0.85,
      d: 0.14,
      material: "wood",
      layer: "remnant",
      shape: "beam",
      heading: Math.PI / 2,
      mass: 0.5,
    });
    const startX = slab.x;
    const startH = slab.heading;
    const particles = new ParticlePool();
    for (let i = 0; i < 50; i++) {
      stepDozer(
        dozer,
        { throttle: 1, steer: 0, blade: true, engineMul: 1, bladeMul: 1, pushMul: 1 },
        SIM_DT,
      );
      stepDebris(town, dozer, particles, [], 1, SIM_DT);
    }
    expect(slab.x).toBeGreaterThan(startX + 0.15);
    expect(Math.abs(slab.heading - startH)).toBeGreaterThan(0.04);
  });

  it("keeps debris contacts stable under sustained compression", () => {
    const town = createTown();
    const a = addDebrisBody(town, {
      x: 14,
      y: 17.6,
      w: 0.55,
      d: 0.4,
      material: "concrete",
      layer: "remnant",
      mass: 2.2,
    });
    const b = addDebrisBody(town, {
      x: 14.28,
      y: 17.6,
      w: 0.5,
      d: 0.38,
      material: "concrete",
      layer: "remnant",
      mass: 2,
    });
    const dozer = createDozer(12.4, 17.6, 0);
    dozer.bladeDown = true;
    dozer.vx = 3.2;
    const particles = new ParticlePool();
    for (let i = 0; i < 180; i++) {
      stepDebris(town, dozer, particles, [], 1, SIM_DT);
    }
    expect(Number.isFinite(a.x) && Number.isFinite(b.x)).toBe(true);
    expect(Number.isFinite(a.vx) && Number.isFinite(a.omega)).toBe(true);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    expect(dist).toBeGreaterThan(0.18);
    expect(dist).toBeLessThan(2.4);
    expect(Math.hypot(a.vx, a.vy)).toBeLessThan(8);
  });

  it("settles a riding fragment after its support moves", () => {
    const town = createTown();
    const core = addDebrisBody(town, {
      x: 16,
      y: 17.6,
      w: 0.7,
      d: 0.5,
      material: "concrete",
      layer: "remnant",
      elev: 0,
      thickness: 0.32,
      mass: 2.4,
    });
    const chip = addDebrisBody(town, {
      x: 16.05,
      y: 17.62,
      w: 0.18,
      d: 0.12,
      material: "brick",
      layer: "fragment",
      elev: 0.3,
      thickness: 0.08,
      mass: 0.16,
    });
    for (let i = 0; i < 40; i++) stepOnce(town);
    const raised = chip.elev;
    expect(raised).toBeGreaterThan(0.08);
    core.x = 19;
    core.y = 20;
    for (let i = 0; i < 70; i++) stepOnce(town);
    expect(chip.elev).toBeLessThan(raised - 0.04);
  });

  it("lets the dozer rearrange a heap that stops a road vehicle", () => {
    const town = createTown();
    for (let i = 0; i < 5; i++) {
      addDebrisBody(town, {
        x: 12 + i * 0.22,
        y: 17.55 + (i % 2) * 0.12,
        w: 0.48,
        d: 0.36,
        material: "concrete",
        layer: "remnant",
        mass: 1.8,
        elev: 0.02,
        thickness: 0.3,
      });
    }
    const heapX = 12.4;
    const before = obstructionAt(town, heapX, 17.6, 0.8);
    expect(before.resistance).toBeGreaterThan(1.2);

    const car = createRoadVehicle(10.2, 17.6, 0);
    town.roadCar = car;
    const carStart = roadSpeed(car);
    void carStart;
    for (let i = 0; i < 90; i++) {
      stepRoadVehicle(car, town, SIM_DT);
      stepOnce(town, createDozer(2, 2, 0));
    }
    const blockedSpeed = roadSpeed(car);
    expect(blockedSpeed).toBeLessThan(3.2);

    const dozer = createDozer(10.4, 17.6, 0);
    const particles = new ParticlePool();
    for (let i = 0; i < 140; i++) {
      stepDozer(
        dozer,
        { throttle: 1, steer: 0, blade: true, engineMul: 1.28, bladeMul: 1, pushMul: 1 },
        SIM_DT,
      );
      stepDebris(town, dozer, particles, [], 1.28, SIM_DT);
    }
    const moved = town.rubble.filter((r) => r.layer === "remnant");
    const meanX = moved.reduce((s, r) => s + r.x, 0) / Math.max(1, moved.length);
    expect(meanX).toBeGreaterThan(heapX + 0.35);
  });
});

describe("obstruction query and restart", () => {
  it("updates collision and obstruction after a path is cleared", () => {
    const town = createTown();
    addDebrisBody(town, {
      x: 15,
      y: 17.6,
      w: 0.8,
      d: 0.55,
      material: "concrete",
      layer: "remnant",
      mass: 2.6,
      thickness: 0.36,
    });
    addDebrisBody(town, {
      x: 15.35,
      y: 17.7,
      w: 0.6,
      d: 0.4,
      material: "brick",
      layer: "remnant",
      mass: 1.6,
      thickness: 0.28,
    });
    expect(obstructionAt(town, 15.1, 17.65, 0.75).blocked).toBe(true);

    const dozer = createDozer(13.2, 17.6, 0);
    const particles = new ParticlePool();
    for (let i = 0; i < 160; i++) {
      stepDozer(
        dozer,
        { throttle: 1, steer: 0, blade: true, engineMul: 1.28, bladeMul: 1, pushMul: 1 },
        SIM_DT,
      );
      stepDebris(town, dozer, particles, [], 1.28, SIM_DT);
    }
    const after = obstructionAt(town, 15.1, 17.65, 0.75);
    expect(after.blocked).toBe(false);
    expect(after.resistance).toBeLessThan(1.55);
  });

  it("does not erase an old heap when new rubble spawns elsewhere", () => {
    const town = createTown();
    addDebrisBody(town, {
      x: 8,
      y: 17.6,
      w: 0.7,
      d: 0.5,
      material: "concrete",
      layer: "remnant",
      mass: 2.2,
    });
    const first = town.rubble[0]!.id;
    spawnCollapseDebris(town, {
      x: 30,
      y: 8,
      dx: 0,
      dy: 1,
      material: "wood",
      floor: 0,
      cellSize: 1.15,
    });
    expect(town.rubble.some((r) => r.id === first)).toBe(true);
    expect(obstructionAt(town, 8, 17.6, 0.7).resistance).toBeGreaterThan(0.8);
  });

  it("resets debris and pile state on restart", () => {
    const town = createTown();
    spawnCollapseDebris(town, {
      x: 12,
      y: 18,
      dx: 1,
      dy: 0,
      material: "brick",
      floor: 0,
      cellSize: 1.15,
    });
    town.roadCar = createRoadVehicle();
    expect(town.rubble.length).toBeGreaterThan(0);
    expect(totalDebrisMass(town)).toBeGreaterThan(0);
    const fresh = createTown();
    expect(fresh.rubble.length).toBe(0);
    expect(fresh.marks.length).toBe(0);
    expect(fresh.pile.totalMass()).toBe(0);
    expect(fresh.roadCar).toBeNull();
    expect(obstructionAt(fresh, 12, 18, 1).blocked).toBe(false);
  });

  it("still drives the world after a collapse without dropping sim fields", () => {
    const town = createTown();
    const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
    const particles = new ParticlePool();
    const out = stepWorld(town, dozer, particles, upgrades, SIM_DT);
    expect(out.debrisLoad).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(out.events)).toBe(true);
  });
});
