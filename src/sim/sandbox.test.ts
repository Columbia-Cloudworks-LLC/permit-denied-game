import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { parseSessionFromSearch, sessionFailsOn, sessionForcesUpgrade } from "../game/session";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage } from "../structure/building";
import { createDozer, stepDozer } from "../vehicle/dozer";
import { createRoadVehicle, roadSpeed } from "../vehicle/roadVehicle";
import { createTown } from "../world/town";
import {
  addDebrisBody,
  crushBody,
  lastDebrisStats,
  obstructionAt,
  spawnCollapseDebris,
  totalDebrisMass,
} from "./debris";
import { stepWorld, type Upgrades } from "./worldSim";

const upgrades: Upgrades = { blade: 0, engine: 0, push: 0 };

function driveWorld(
  town: ReturnType<typeof createTown>,
  dozer: ReturnType<typeof createDozer>,
  steps: number,
  drive = { throttle: 1, steer: 0, blade: true },
): void {
  const particles = new ParticlePool();
  for (let i = 0; i < steps; i++) {
    stepDozer(
      dozer,
      {
        throttle: drive.throttle,
        steer: drive.steer,
        blade: drive.blade,
        engineMul: 1.28,
        bladeMul: 1,
        pushMul: 1,
      },
      SIM_DT,
    );
    stepWorld(town, dozer, particles, { blade: 0, engine: 1, push: 0 }, SIM_DT);
  }
}

describe("sandbox session rules", () => {
  it("parses sandbox URL without treating a missing seed as zero", () => {
    expect(parseSessionFromSearch("?sandbox=1")).toMatchObject({
      kind: "sandbox",
      district: "classic",
      seed: 0x0ddba11,
    });
    expect(parseSessionFromSearch("?sandbox=1&seed=0").seed).toBe(0);
    expect(parseSessionFromSearch("?district=d100&sandbox=1").seed).toBe(0x100d15c);
  });

  it("does not force clock, heat, or track failure in sandbox", () => {
    const sandbox = sessionFailsOn({ kind: "sandbox", district: "classic", seed: 1 });
    expect(sandbox).toEqual({ heat: false, track: false, clock: false });
    expect(sessionForcesUpgrade({ kind: "sandbox", district: "classic", seed: 1 })).toBe(false);
    const challenge = sessionFailsOn({ kind: "challenge", district: "classic", seed: 1 });
    expect(challenge).toEqual({ heat: true, track: true, clock: true });
  });

  it("restarts the same seed as an intact town", () => {
    const first = createTown({ district: "d10", seed: 77 });
    first.buildings[0]!.cells[0]!.hp = 0;
    first.pile.addMass(4, 4, 3, "brick");
    const restart = createTown({ district: "d10", seed: 77 });
    expect(restart.buildings).toHaveLength(10);
    expect(restart.rubble).toHaveLength(0);
    expect(restart.pile.totalMass()).toBe(0);
    expect(restart.buildings[0]!.x).toBe(first.buildings[0]!.x);
    expect(restart.buildings.every((b) => b.cells.every((c) => c.state === "intact"))).toBe(true);
  });
});

describe("rubble persistence and excavation", () => {
  it("preserves mass through aggregation, reactivation, and crushing past budgets", () => {
    const town = createTown();
    let spawned = 0;
    for (let i = 0; i < 80; i++) {
      spawnCollapseDebris(town, {
        x: 6 + (i % 8) * 1.4,
        y: 8 + Math.floor(i / 8) * 1.2,
        dx: 1,
        dy: 0,
        material: i % 2 === 0 ? "concrete" : "brick",
        floor: 1,
        cellSize: 1.15,
      });
      spawned++;
    }
    const afterSpawn = totalDebrisMass(town);
    expect(afterSpawn).toBeGreaterThan(20);
    const particles = new ParticlePool();
    const crushN = Math.min(40, town.rubble.length);
    for (let i = 0; i < crushN; i++) {
      const body = town.rubble[0];
      if (!body) break;
      crushBody(town, body, particles);
    }
    expect(Math.abs(totalDebrisMass(town) - afterSpawn) / afterSpawn).toBeLessThan(0.08);
    expect(spawned).toBe(80);
    const parked = createDozer(2, 2, 0);
    for (const r of town.rubble) {
      r.sleeping = true;
      r.touchedAt = -10;
    }
    for (let i = 0; i < 4; i++) stepWorld(town, parked, particles, upgrades, SIM_DT);
    expect(town.rubble.filter((r) => r.layer === "remnant").length).toBeLessThanOrEqual(96);
    expect(town.rubble.filter((r) => r.layer === "fragment").length).toBeLessThanOrEqual(140);
  });

  it("keeps an old barricade visible, obstructive, and editable after distant demolition", () => {
    const town = createTown();
    for (let i = 0; i < 6; i++) {
      addDebrisBody(town, {
        x: 12.1 + i * 0.2,
        y: 17.55 + (i % 2) * 0.1,
        w: 0.5,
        d: 0.36,
        material: "concrete",
        layer: "remnant",
        mass: 2.1,
        elev: 0.03,
        thickness: 0.3,
      });
    }
    town.pile.addMass(12.4, 17.6, 6.5, "concrete");
    const heapX = 12.4;
    const before = obstructionAt(town, heapX, 17.6, 0.8);
    expect(before.blocked).toBe(true);
    expect(before.height).toBeGreaterThan(0.16);

    const far = town.buildings.find((b) => b.name === "CIVIC ANNEX")!;
    const particles = new ParticlePool();
    for (const cell of far.cells) {
      applyCellDamage(far, cell, 999, 1, 0, particles, []);
    }
    const dummy = createDozer(2, 2, 0);
    for (let i = 0; i < 240; i++) {
      stepWorld(town, dummy, particles, upgrades, SIM_DT);
    }
    const after = obstructionAt(town, heapX, 17.6, 0.8);
    expect(after.resistance).toBeGreaterThan(1.2);
    expect(after.height).toBeGreaterThan(0.12);
    let heapMass = 0;
    for (const r of town.rubble) {
      if (Math.hypot(r.x - heapX, r.y - 17.6) < 1.8) heapMass += r.mass;
    }
    for (let x = heapX - 1.2; x <= heapX + 1.2; x += 0.5) {
      for (let y = 17.6 - 0.8; y <= 17.6 + 0.8; y += 0.5) {
        heapMass += town.pile.sample(x, y).mass * 0.12;
      }
    }
    expect(heapMass).toBeGreaterThan(2.2);
    expect(after.blocked || after.resistance > 1.6).toBe(true);

    const dozer = createDozer(10.3, 17.6, 0);
    driveWorld(town, dozer, 160);
    const cleared = obstructionAt(town, heapX, 17.6, 0.75);
    expect(cleared.resistance).toBeLessThan(before.resistance * 0.85);
  });

  it("lets a test car pass before a heap, fail during it, and pass after a blade clearing", () => {
    const town = createTown();
    const particles = new ParticlePool();
    const parked = createDozer(2, 28, 0);

    town.roadCar = createRoadVehicle(3.4, 17.6, 0);
    for (let i = 0; i < 70; i++) stepWorld(town, parked, particles, upgrades, SIM_DT);
    const openSpeed = roadSpeed(town.roadCar);
    expect(openSpeed).toBeGreaterThan(2.4);
    const openX = town.roadCar.x;

    town.roadCar = createRoadVehicle(3.4, 17.6, 0);
    for (let i = 0; i < 6; i++) {
      addDebrisBody(town, {
        x: 7.6 + i * 0.2,
        y: 17.55,
        w: 0.52,
        d: 0.38,
        material: "concrete",
        layer: "remnant",
        mass: 2.2,
        thickness: 0.32,
      });
    }
    town.pile.addMass(8.1, 17.6, 6.2, "concrete");
    expect(obstructionAt(town, 8.1, 17.6, 0.75).blocked).toBe(true);
    for (let i = 0; i < 90; i++) stepWorld(town, parked, particles, upgrades, SIM_DT);
    const blockedSpeed = roadSpeed(town.roadCar);
    expect(blockedSpeed).toBeLessThan(openSpeed * 0.85);
    expect(town.roadCar.x).toBeLessThan(openX + 0.4);

    const dozer = createDozer(5.8, 17.6, 0);
    driveWorld(town, dozer, 180);
    town.roadCar = createRoadVehicle(3.4, 17.6, 0);
    for (let i = 0; i < 150; i++) stepWorld(town, parked, particles, upgrades, SIM_DT);
    expect(town.roadCar.x).toBeGreaterThan(8.4);
  });

  it("finishes an offscreen collapse once and pays the bonus exactly once", () => {
    const town = createTown();
    const house = town.buildings[0]!;
    const particles = new ParticlePool();
    for (const cell of house.cells) {
      applyCellDamage(house, cell, 999, 0, 1, particles, []);
    }
    const dozer = createDozer(town.maxX - 2, town.maxY - 2, 0);
    let cashEvents = 0;
    for (let i = 0; i < 320; i++) {
      const out = stepWorld(town, dozer, particles, upgrades, SIM_DT);
      cashEvents += out.events.filter((e) => e.kind === "cash" && e.cash === 140).length;
    }
    expect(house.fullyDown).toBe(true);
    expect(house.collapseBonusPaid).toBe(true);
    expect(cashEvents).toBe(1);
    expect(totalDebrisMass(town)).toBeGreaterThan(1);
    const again = stepWorld(town, dozer, particles, upgrades, SIM_DT);
    expect(again.events.filter((e) => e.kind === "cash" && e.cash === 140)).toHaveLength(0);
  });

  it("rebuilds collision after damage and clears it on reset", () => {
    const town = createTown();
    const house = town.buildings[0]!;
    const particles = new ParticlePool();
    const dozer = createDozer(house.x - 0.4, house.y + house.d * house.cellSize * 0.5, 0);
    stepWorld(town, dozer, particles, upgrades, SIM_DT);
    expect(house.collisionDirty).toBe(false);
    for (let gx = 0; gx < house.w; gx++) {
      applyCellDamage(house, house.grid[0]![gx]![0]!, 999, 1, 0, particles, []);
    }
    expect(house.collisionDirty).toBe(true);
    const out = stepWorld(town, dozer, particles, upgrades, SIM_DT);
    expect(out.metrics.collisionRebuilds).toBe(1);
    expect(house.collisionDirty).toBe(false);
    const fresh = createTown();
    expect(fresh.buildings[0]!.cells.every((c) => c.state === "intact")).toBe(true);
    expect(fresh.pile.totalMass()).toBe(0);
  });

  it("records debris stats after a production step", () => {
    const town = createTown();
    spawnCollapseDebris(town, {
      x: 12,
      y: 18,
      dx: 1,
      dy: 0,
      material: "wood",
      floor: 0,
      cellSize: 1.15,
    });
    stepWorld(town, createDozer(2, 2, 0), new ParticlePool(), upgrades, SIM_DT);
    const stats = lastDebrisStats();
    expect(stats.bodyMass + stats.pileMass).toBeGreaterThan(0.2);
    expect(stats.active + stats.sleeping).toBe(town.rubble.length);
  });
});
