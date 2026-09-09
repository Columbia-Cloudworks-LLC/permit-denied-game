export interface PerfSnapshot {
  frameMs: number;
  simCpuMs: number;
  renderPrepMs: number;
  droppedSimSec: number;
  budgetConversions: number;
  debrisActive: number;
  debrisSleeping: number;
  contactPairs: number;
  buildingsStepped: number;
  buildingsSkipped: number;
  collisionRebuilds: number;
  renderVisible: number;
  renderTotal: number;
  bodyMass: number;
  pileMass: number;
}

export interface PerfSummary {
  samples: number;
  frameMs: Percentiles;
  simCpuMs: Percentiles;
  renderPrepMs: Percentiles;
  last: PerfSnapshot;
}

export interface Percentiles {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  mean: number;
}

const EMPTY: PerfSnapshot = {
  frameMs: 0,
  simCpuMs: 0,
  renderPrepMs: 0,
  droppedSimSec: 0,
  budgetConversions: 0,
  debrisActive: 0,
  debrisSleeping: 0,
  contactPairs: 0,
  buildingsStepped: 0,
  buildingsSkipped: 0,
  collisionRebuilds: 0,
  renderVisible: 0,
  renderTotal: 0,
  bodyMass: 0,
  pileMass: 0,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

function summarize(values: number[]): Percentiles {
  if (values.length === 0) return { p50: 0, p90: 0, p99: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
  };
}

export class PerfCollector {
  enabled = false;
  private lastFrameAt = 0;
  private readonly frames: number[] = [];
  private readonly sims: number[] = [];
  private readonly preps: number[] = [];
  last: PerfSnapshot = { ...EMPTY };

  reset(): void {
    this.lastFrameAt = 0;
    this.frames.length = 0;
    this.sims.length = 0;
    this.preps.length = 0;
    this.last = { ...EMPTY };
  }

  record(sample: PerfSnapshot): void {
    this.last = sample;
    if (!this.enabled) return;
    this.frames.push(sample.frameMs);
    this.sims.push(sample.simCpuMs);
    this.preps.push(sample.renderPrepMs);
    if (this.frames.length > 3600) {
      this.frames.shift();
      this.sims.shift();
      this.preps.shift();
    }
  }

  markFrameStart(now: number): number {
    const interval = this.lastFrameAt === 0 ? 0 : now - this.lastFrameAt;
    this.lastFrameAt = now;
    return interval;
  }

  summary(): PerfSummary {
    return {
      samples: this.frames.length,
      frameMs: summarize(this.frames),
      simCpuMs: summarize(this.sims),
      renderPrepMs: summarize(this.preps),
      last: this.last,
    };
  }
}

export function formatPerfOverlay(s: PerfSnapshot, fps: number): string {
  return [
    `CPU FRAME ${s.frameMs.toFixed(1)}ms  (~${fps.toFixed(0)} Hz)`,
    `SIM ${s.simCpuMs.toFixed(2)}ms  PREP ${s.renderPrepMs.toFixed(2)}ms  (GPU not measured)`,
    `DEBRIS act ${s.debrisActive} sleep ${s.debrisSleeping} pairs ${s.contactPairs} absorb ${s.budgetConversions}`,
    `BUILDINGS step ${s.buildingsStepped} skip ${s.buildingsSkipped} hash ${s.collisionRebuilds}`,
    `DRAW vis ${s.renderVisible} / ${s.renderTotal}`,
    `MASS body ${s.bodyMass.toFixed(1)} pile ${s.pileMass.toFixed(1)}  drop ${s.droppedSimSec.toFixed(3)}s`,
  ].join("\n");
}

export function emptyPerfSnapshot(): PerfSnapshot {
  return { ...EMPTY };
}
