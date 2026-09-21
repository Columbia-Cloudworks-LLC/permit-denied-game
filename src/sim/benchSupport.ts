import { ParticlePool } from "../fx/particles";
import type { Dozer } from "../vehicle/dozer";
import type { Town } from "../world/town";
import { SIM_DT } from "../game/constants";
import { applyCellDamage } from "../structure/building";
import { stepDozer } from "../vehicle/dozer";
import { stepWorld, type Upgrades } from "./worldSim";

export const BENCH_UPGRADES: Upgrades = { blade: 0, engine: 0, push: 0 };

/** Yield so Vitest's worker RPC can ACK during long CPU-bound loops. */
export function pumpVitestRpc(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

export function smashNearest(town: Town, n: number, particles = new ParticlePool()): void {
  for (const b of town.buildings.slice(0, n)) {
    for (const cell of b.cells.slice(0, Math.ceil(b.cells.length * 0.45))) {
      applyCellDamage(b, cell, 999, 1, 0, particles, []);
    }
  }
}

export function timeSteps(
  town: Town,
  dozer: Dozer,
  steps: number,
  drive = true,
  particles = new ParticlePool(),
): number[] {
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
    stepWorld(town, dozer, particles, BENCH_UPGRADES, SIM_DT);
    samples.push(performance.now() - t0);
  }
  return samples;
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

export function report(label: string, samples: number[]): void {
  const mean = samples.reduce((s, v) => s + v, 0) / Math.max(1, samples.length);
  console.log(
    `[bench] ${label} n=${samples.length} mean=${mean.toFixed(3)}ms p50=${percentile(samples, 50).toFixed(3)} p90=${percentile(samples, 90).toFixed(3)} p99=${percentile(samples, 99).toFixed(3)} max=${percentile(samples, 100).toFixed(3)}`,
  );
}
