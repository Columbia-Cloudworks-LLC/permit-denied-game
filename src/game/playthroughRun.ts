import {
  digestDrift,
  parsePlaythrough,
  PlaythroughPlayer,
  PlaythroughRecorder,
  type Playthrough,
  type PlaythroughAction,
  type PlaythroughActionInput,
  type PlaythroughControl,
  type PlaythroughDigest,
  type PlaythroughSetup,
} from "../debug/playthrough";
import type { Dozer } from "../vehicle/dozer";
import type { Town } from "../world/town";

const PLAYTHROUGH_STORAGE_KEY = "pd.playthrough.last";

export interface PlaythroughStatus {
  state: "idle" | "recording" | "replaying";
  step: number;
  steps: number;
  paused: boolean;
  done: boolean;
  /** Drifted fields after a finished replay; empty is a match, null is not yet judged. */
  drift: string[] | null;
  hasLast: boolean;
  note: string;
}

/** End-of-run state a replay must reproduce. */
export function playthroughDigest(town: Town, dozer: Dozer, cash: number, elapsed: number, steps: number): PlaythroughDigest {
  const cells: Record<string, number> = {};
  let cellHp = 0;
  for (const building of town.buildings) for (const cell of building.cells) {
    cells[cell.state] = (cells[cell.state] ?? 0) + 1;
    cellHp += cell.hp;
  }
  return {
    steps,
    cash,
    elapsed,
    dozer: { x: dozer.x, y: dozer.y, heading: dozer.heading, heat: dozer.heat, track: dozer.track },
    rubble: town.rubble.length,
    rubbleMass: town.rubble.reduce((sum, r) => sum + r.mass, 0),
    cells,
    cellHp,
  };
}

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function loadStored(): Playthrough | null {
  try {
    const text = storage()?.getItem(PLAYTHROUGH_STORAGE_KEY);
    return text ? parsePlaythrough(text) : null;
  } catch { return null; }
}

function store(playthrough: Playthrough): boolean {
  try { storage()?.setItem(PLAYTHROUGH_STORAGE_KEY, JSON.stringify(playthrough)); return !!storage(); } catch { return false; }
}

/** Debug session capture and replay. The game feeds every fixed step through `control`. */
export class PlaythroughRun {
  private recorder: PlaythroughRecorder | null = null;
  private player: PlaythroughPlayer | null = null;
  private drift: string[] | null = null;
  last: Playthrough | null = loadStored();
  note = "";

  get replaying(): boolean { return !!this.player; }
  get replayed(): Playthrough | null { return this.player?.playthrough ?? null; }
  /** Every recorded step has run; nothing may step the replay further. */
  get exhausted(): boolean { return !!this.player && this.player.steps >= this.player.playthrough.steps; }
  /** A paused or finished replay holds the simulation. */
  get holds(): boolean { return !!this.player?.holds; }

  record(setup: PlaythroughSetup, build: string): void {
    this.player = null;
    this.drift = null;
    this.recorder = new PlaythroughRecorder(setup, build);
    this.note = "Recording. Stop from the badge or the Debug binder.";
  }

  replay(playthrough: Playthrough): void {
    this.recorder = null;
    this.drift = null;
    this.player = new PlaythroughPlayer(playthrough);
    this.note = `Replaying ${playthrough.steps} steps recorded on build ${playthrough.build}.`;
  }

  /** The control for this step: the recorded one in replay, otherwise the live one (captured while recording). */
  control(live: PlaythroughControl): PlaythroughControl {
    if (this.player) return this.player.control();
    this.recorder?.control(live);
    return live;
  }

  /** Remember a live action that changes the run; ignored unless recording. */
  noteAction(action: PlaythroughActionInput): void {
    this.recorder?.action(action);
  }

  due(): PlaythroughAction[] {
    return this.player?.due() ?? [];
  }

  togglePause(): void {
    if (this.player) this.player.paused = !this.player.paused;
  }

  /** Judge a finished replay once against the recorded end state. */
  settle(digest: () => PlaythroughDigest): void {
    if (!this.player?.done || this.drift) return;
    this.drift = digestDrift(this.player.playthrough.final, digest());
    this.note = this.drift.length ? `Replay drifted: ${this.drift.join(", ")}.` : "Replay matched the recorded end state.";
  }

  /** Finish a recording (kept as the last playthrough) or leave a replay. */
  stop(digest: () => PlaythroughDigest): Playthrough | null {
    const recorder = this.recorder;
    const final = recorder ? digest() : null;
    this.player = null;
    this.recorder = null;
    this.drift = null;
    if (!recorder || !final) return null;
    this.last = recorder.finish(final);
    this.note = store(this.last)
      ? `Saved ${this.last.steps} steps in this browser. Save File exports it.`
      : `Recorded ${this.last.steps} steps; too large for browser storage, use Save File.`;
    return this.last;
  }

  /** Accept a loaded payload as the last playthrough; throws with the reason on a bad file. */
  load(input: unknown): Playthrough {
    this.last = parsePlaythrough(input);
    store(this.last);
    return this.last;
  }

  status(): PlaythroughStatus {
    const player = this.player;
    return {
      state: this.recorder ? "recording" : player ? "replaying" : "idle",
      step: this.recorder?.steps ?? player?.steps ?? 0,
      steps: player?.playthrough.steps ?? this.recorder?.steps ?? 0,
      paused: !!player?.paused,
      done: !!player?.done,
      drift: this.drift,
      hasLast: !!this.last,
      note: this.note,
    };
  }
}
