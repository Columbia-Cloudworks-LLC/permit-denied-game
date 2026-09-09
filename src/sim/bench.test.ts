import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage } from "../structure/building";
import { createDozer, stepDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import type { DistrictId } from "../game/session";
import { addDebrisBody, spawnCollapseDebris, totalDebrisMass } from "./debris";
import { stepWorld, type Upgrades } from "./worldSim";

const upgrades: Upgrades = { blade: 0, engine: 0, push: 0 };

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

function timeSteps(
  town: ReturnType<typeof createTown>,
  dozer: ReturnType<typeof createDozer>,
  steps: number,
  drive = true,
): number[] {
  const particles = new ParticlePool();
  const samples: number[] = [];
  for (let i = 0; i < steps; i++) {
    if (drive) {
      stepDozer(
        dozer,
        { throttle: 1, steer: 0, blade: true, engineMul: 1, bladeMul: 1, pushMul: 1 },
        SIM_DT,
      );
    }
    const t0 = performance.now();
    stepWorld(town, dozer, particles, upgrades, SIM_DT);
    samples.push(performance.now() - t0);
  }
  return samples;
}

function report(label: string, samples: number[]): void {
  const mean = samples.reduce((s, v) => s + v, 0) / Math.max(1, samples.length);
  // eslint-disable-next-line no-console
  console.log(
    `[bench] ${label} n=${samples.length} mean=${mean.toFixed(3)}ms p50=${percentile(samples, 50).toFixed(3)} p90=${percentile(samples, 90).toFixed(3)} p99=${percentile(samples, 99).toFixed(3)} max=${percentile(samples, 100).toFixed(3)}`,
  );
}

function smashNearest(town: ReturnType<typeof createTown>, n: number): void {
  const particles = new ParticlePool();
  for (const b of town.buildings.slice(0, n)) {
    for (const cell of b.cells.slice(0, Math.ceil(b.cells.length * 0.45))) {
      applyCellDamage(b, cell, 999, 1, 0, particles, []);
    }
  }
}

describe("district simulation benches", () => {
  it("measures intact, collapse, push, and revisit costs", { timeout: 120_000 }, () => {
    const districts: DistrictId[] = ["classic", "d10", "d30", "d100"];
    for (const district of districts) {
      const town = createTown({ district, seed: 9 });
      const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
      report(`${district} intact`, timeSteps(town, dozer, 90));
      smashNearest(town, district === "classic" ? 3 : 4);
      report(`${district} collapses`, timeSteps(town, dozer, 180, false));
      for (let i = 0; i < 8; i++) {
        addDebrisBody(town, {
          x: dozer.x + 1.2 + i * 0.16,
          y: dozer.y,
          w: 0.4,
          d: 0.28,
          material: "concrete",
          layer: "remnant",
          mass: 1.4,
        });
      }
      report(`${district} push`, timeSteps(town, dozer, 120));
      smashNearest(town, Math.min(town.buildings.length, 8));
      report(`${district} demolish`, timeSteps(town, dozer, 240, false));
      dozer.x = town.buildings[0]!.x + 1;
      dozer.y = town.buildings[0]!.y + 1;
      report(`${district} revisit`, timeSteps(town, dozer, 90, false));
      expect(totalDebrisMass(town)).toBeGreaterThanOrEqual(0);
    }
  });

  it("accelerates a 20-minute classic sandbox without losing wreckage", { timeout: 180_000 }, async () => {
    const town = createTown();
    const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
    const particles = new ParticlePool();
    const minutes = 20;
    const steps = Math.floor((minutes * 60) / SIM_DT);
    const stride = 12;
    let lastMass = 0;
    const samples: number[] = [];
    for (let i = 0; i < steps; i += stride) {
      if (i === Math.floor(steps * 0.05)) smashNearest(town, 2);
      if (i === Math.floor(steps * 0.2)) {
        spawnCollapseDebris(town, {
          x: 12,
          y: 18,
          dx: 1,
          dy: 0,
          material: "concrete",
          floor: 1,
          cellSize: 1.15,
        });
      }
      if (i === Math.floor(steps * 0.45)) smashNearest(town, 5);
      stepDozer(dozer, { throttle: 0.4, steer: 0.05, blade: true, engineMul: 1, bladeMul: 1, pushMul: 1 }, SIM_DT);
      const t0 = performance.now();
      for (let k = 0; k < stride; k++) stepWorld(town, dozer, particles, upgrades, SIM_DT);
      samples.push((performance.now() - t0) / stride);
      lastMass = totalDebrisMass(town);
      if (samples.length % 400 === 0) await Promise.resolve();
    }
    report("classic 20min accelerated (per step)", samples);
    expect(lastMass).toBeGreaterThan(0.5);
    expect(town.buildings.some((b) => b.fullyDown || b.cells.some((c) => c.state !== "intact"))).toBe(true);
  });
});
