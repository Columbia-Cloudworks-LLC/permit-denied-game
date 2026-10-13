import type { CampaignRun } from "../game/campaignRun";
import type { SessionRules } from "../game/session";
import type { Upgrades } from "../sim/worldSim";

/**
 * A recorded playthrough: the setup that rebuilds the site, then the drive control
 * applied on every fixed step and the discrete actions between steps. Replaying the
 * same steps on the same build reproduces the run exactly.
 */
const PLAYTHROUGH_FORMAT = "permit-denied-playthrough" as const;
const PLAYTHROUGH_VERSION = 1 as const;

export interface PlaythroughControl {
  throttle: number;
  steer: number;
  blade: boolean;
}

export type UpgradeId = "blade" | "engine" | "push";

/** `at` is the number of fixed steps already run when the action happened. */
export type PlaythroughAction =
  | { at: number; kind: "upgrade"; id: UpgradeId }
  | { at: number; kind: "resubmit"; fee: number }
  | { at: number; kind: "road-vehicle" };

type WithoutAt<A> = A extends unknown ? Omit<A, "at"> : never;
export type PlaythroughActionInput = WithoutAt<PlaythroughAction>;

/** End-of-run state compared after a replay finishes. */
export interface PlaythroughDigest {
  steps: number;
  cash: number;
  elapsed: number;
  dozer: { x: number; y: number; heading: number; heat: number; track: number };
  rubble: number;
  rubbleMass: number;
  cells: Record<string, number>;
  cellHp: number;
}

export interface PlaythroughSetup {
  rules: SessionRules;
  campaign: CampaignRun | null;
  upgrades: Upgrades;
}

export interface Playthrough extends PlaythroughSetup {
  format: typeof PLAYTHROUGH_FORMAT;
  version: typeof PLAYTHROUGH_VERSION;
  build: string;
  recordedAt: string;
  steps: number;
  /** Control changes only: `[step, throttle, steer, blade]`, held until the next entry. */
  controls: [number, number, number, 0 | 1][];
  actions: PlaythroughAction[];
  final: PlaythroughDigest;
}

const IDLE: PlaythroughControl = { throttle: 0, steer: 0, blade: false };

export class PlaythroughRecorder {
  private readonly controls: Playthrough["controls"] = [];
  private readonly actions: PlaythroughAction[] = [];
  private last: PlaythroughControl = IDLE;
  steps = 0;

  constructor(private readonly setup: PlaythroughSetup, private readonly build: string) {}

  /** Record the control for step `steps`, then count that step. */
  control(control: PlaythroughControl): void {
    const { throttle, steer, blade } = control;
    if (this.controls.length === 0 || throttle !== this.last.throttle || steer !== this.last.steer || blade !== this.last.blade) {
      this.controls.push([this.steps, throttle, steer, blade ? 1 : 0]);
      this.last = { throttle, steer, blade };
    }
    this.steps++;
  }

  action(action: PlaythroughActionInput): void {
    this.actions.push({ ...action, at: this.steps } as PlaythroughAction);
  }

  finish(final: PlaythroughDigest, recordedAt = new Date().toISOString()): Playthrough {
    return {
      format: PLAYTHROUGH_FORMAT,
      version: PLAYTHROUGH_VERSION,
      build: this.build,
      recordedAt,
      ...structuredClone(this.setup),
      steps: this.steps,
      controls: this.controls.map(entry => [...entry]),
      actions: this.actions.map(action => ({ ...action })),
      final,
    };
  }
}

export class PlaythroughPlayer {
  steps = 0;
  paused = false;
  private controlIndex = 0;
  private actionIndex = 0;

  constructor(readonly playthrough: Playthrough) {}

  get done(): boolean {
    return this.steps >= this.playthrough.steps && this.actionIndex >= this.playthrough.actions.length;
  }

  /** True while the simulation must not advance: paused, or every recorded step has run. */
  get holds(): boolean {
    return this.paused || this.steps >= this.playthrough.steps;
  }

  /** Actions recorded at or before the current step that have not been applied yet. */
  due(): PlaythroughAction[] {
    const out: PlaythroughAction[] = [];
    const actions = this.playthrough.actions;
    while (this.actionIndex < actions.length && actions[this.actionIndex]!.at <= this.steps) out.push(actions[this.actionIndex++]!);
    return out;
  }

  /** The recorded control for the next step, then count that step. */
  control(): PlaythroughControl {
    const controls = this.playthrough.controls;
    while (this.controlIndex + 1 < controls.length && controls[this.controlIndex + 1]![0] <= this.steps) this.controlIndex++;
    const entry = controls[this.controlIndex];
    const control = entry && entry[0] <= this.steps ? { throttle: entry[1], steer: entry[2], blade: entry[3] === 1 } : IDLE;
    this.steps++;
    return control;
  }
}

/** Field names whose end-of-run values differ; empty when the replay matched the recording. */
export function digestDrift(expected: PlaythroughDigest, actual: PlaythroughDigest): string[] {
  const drift: string[] = [];
  const flat = (digest: PlaythroughDigest): Record<string, number> => ({
    steps: digest.steps,
    cash: digest.cash,
    elapsed: digest.elapsed,
    ...Object.fromEntries(Object.entries(digest.dozer).map(([key, value]) => ["dozer." + key, value])),
    rubble: digest.rubble,
    rubbleMass: digest.rubbleMass,
    cellHp: digest.cellHp,
    ...Object.fromEntries(Object.entries(digest.cells).map(([key, value]) => ["cells." + key, value])),
  });
  const a = flat(expected), b = flat(actual);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[key] !== b[key]) drift.push(key);
  return drift;
}

/** Validate a loaded payload; throws with a reason a developer can act on. */
export function parsePlaythrough(input: unknown): Playthrough {
  const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
  if (!value || typeof value !== "object") throw new Error("Playthrough must be a JSON object.");
  const p = value as Partial<Playthrough>;
  if (p.format !== PLAYTHROUGH_FORMAT) throw new Error("Not a PERMIT DENIED playthrough file.");
  if (p.version !== PLAYTHROUGH_VERSION) throw new Error(`Unsupported playthrough version ${String(p.version)}.`);
  if (!p.rules || typeof p.rules.seed !== "number" || !p.upgrades || !p.final) throw new Error("Playthrough is missing its site setup.");
  if (!Number.isInteger(p.steps) || p.steps! < 0) throw new Error("Playthrough step count is invalid.");
  if (!Array.isArray(p.controls) || !Array.isArray(p.actions)) throw new Error("Playthrough input stream is missing.");
  for (const entry of p.controls) {
    if (!Array.isArray(entry) || entry.length !== 4 || !entry.every(n => typeof n === "number" && Number.isFinite(n))) {
      throw new Error("Playthrough control entry is malformed.");
    }
  }
  return p as Playthrough;
}
