import { describe, expect, it } from "vitest";
import { DEBRIS, SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { createDozer, stepDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import { spawnCollapseDebris, totalDebrisMass } from "./debris";
import { stepWorld } from "./worldSim";
import { BENCH_UPGRADES, pumpVitestRpc, report, smashNearest } from "./benchSupport";

describe("simulation soak", () => {
  it("accelerates a 20-minute classic sandbox without losing wreckage", { timeout: 240_000 }, async () => {
    const town = createTown();
    const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
    const particles = new ParticlePool();
    const minutes = 20;
    const steps = Math.floor((minutes * 60) / SIM_DT);
    const stride = 12;
    let lastMass = 0;
    const samples: number[] = [];
    await pumpVitestRpc();
    for (let i = 0; i < steps; i += stride) {
      if (i === Math.floor(steps * 0.05)) smashNearest(town, 2, particles);
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
      if (i === Math.floor(steps * 0.45)) smashNearest(town, 5, particles);
      stepDozer(dozer, { throttle: 0.4, steer: 0.05, blade: true, engineMul: 1, bladeMul: 1, pushMul: 1 }, SIM_DT);
      const t0 = performance.now();
      for (let k = 0; k < stride; k++) stepWorld(town, dozer, particles, BENCH_UPGRADES, SIM_DT);
      samples.push((performance.now() - t0) / stride);
      lastMass = totalDebrisMass(town);
      if (samples.length % 20 === 0) await pumpVitestRpc();
    }
    report("classic 20min accelerated (per step)", samples);
    expect(lastMass).toBeGreaterThan(0.5);
    expect(town.buildings.some((b) => b.fullyDown || b.cells.some((c) => c.state !== "intact"))).toBe(true);
    expect(town.rubble.length).toBeLessThanOrEqual(DEBRIS.remnantCap + DEBRIS.fragmentCap + DEBRIS.hardOverflow);
    expect(town.collapsedSites.length).toBe(town.buildings.filter((b) => b.fullyDown).length);
  });
});
