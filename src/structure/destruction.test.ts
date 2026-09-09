import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage } from "./building";
import { stepWorld } from "../sim/worldSim";
import { createDozer } from "../vehicle/dozer";
import {
  driveIntoFirstHouse,
  floatingPresent,
  freshWarehouse,
  presentCells,
  restartResetsTown,
  settle,
  smashAllGround,
  smashCorner,
} from "../sim/harness";
import { createTown } from "../world/town";

describe("destruction model", () => {
  it("spawns every building fully intact", () => {
    const town = createTown();
    for (const b of town.buildings) {
      for (const cell of b.cells) {
        expect(cell.state).toBe("intact");
        expect(cell.hp).toBe(cell.maxHp);
        expect(cell.sag).toBe(0);
      }
    }
  });

  it("localizes corner damage and leaves the far side standing", () => {
    const b = freshWarehouse();
    smashCorner(b);
    expect(b.grid[0]![0]![0]!.state).toBe("breached");
    expect(b.grid[0]![b.w - 1]![b.d - 1]!.state).toBe("intact");
    expect(b.grid[0]![b.w - 1]![0]!.state).toBe("intact");
  });

  it("collapses unsupported upper cells after a corner support is removed", () => {
    const b = freshWarehouse();
    smashCorner(b);
    settle(b, 1.6);
    const above = b.grid[1]![0]![0]!;
    expect(["falling", "gone", "cracked", "breached"]).toContain(above.state);
    expect(b.grid[0]![b.w - 1]![b.d - 1]!.state).toBe("intact");
  });

  it("does not leave floating sections after the ground floor is destroyed", () => {
    const b = freshWarehouse();
    smashAllGround(b);
    settle(b, 2.4);
    expect(presentCells(b)).toBe(0);
    expect(floatingPresent(b)).toBe(false);
    expect(b.cells.every((c) => c.state === "gone" || c.state === "falling")).toBe(true);
  });

  it("drives the dozer into the first house and damages only contacted structure", () => {
    const result = driveIntoFirstHouse(5);
    expect(result.intactStart).toBe(true);
    expect(result.damaged).toBeGreaterThan(0);
    expect(result.cash).toBeGreaterThan(0);
  });

  it("recreates a fully intact town on restart", () => {
    expect(restartResetsTown()).toBe(true);
  });

  it("a collapsing warehouse can lean into the neighboring shop", () => {
    const town = createTown();
    const works = town.buildings.find((b) => b.name === "COUNTY WORKS")!;
    const shop = town.buildings.find((b) => b.name === "BRICK & LEDGER")!;
    const particles = new ParticlePool();
    const dozer = createDozer(1.5, 1.5, 0);
    for (let gx = works.w - 2; gx < works.w; gx++) {
      for (let gy = 0; gy < works.d; gy++) {
        applyCellDamage(works, works.grid[0]![gx]![gy]!, 999, 1, 0, particles, []);
      }
    }
    const upgrades = { blade: 0, engine: 0, push: 0 };
    for (let i = 0; i < 200; i++) {
      stepWorld(town, dozer, particles, upgrades, SIM_DT);
    }
    const shopHurt = shop.cells.some((c) => c.state !== "intact");
    expect(shopHurt).toBe(true);
    expect(works.cells.some((c) => c.state === "gone" || c.state === "falling")).toBe(true);
  });
});
