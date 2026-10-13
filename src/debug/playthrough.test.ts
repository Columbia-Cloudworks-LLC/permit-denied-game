import { describe, expect, it } from "vitest";
import {
  digestDrift,
  parsePlaythrough,
  PlaythroughPlayer,
  PlaythroughRecorder,
  type PlaythroughControl,
  type PlaythroughDigest,
} from "./playthrough";
import { playthroughLabel } from "../render/playthroughPanel";
import type { PlaythroughStatus } from "../game/playthroughRun";

const digest = (over: Partial<PlaythroughDigest> = {}): PlaythroughDigest => ({
  steps: 4,
  cash: 120,
  elapsed: 4 / 60,
  dozer: { x: 1, y: 2, heading: 0.5, heat: 3, track: 0 },
  rubble: 2,
  rubbleMass: 1.5,
  cells: { intact: 10, breached: 1 },
  cellHp: 900,
  ...over,
});

const setup = {
  rules: { kind: "sandbox", district: "d10", seed: 7, ranchFocus: false, season: "summer", seasonExplicit: false, weatherDetail: "on" },
  campaign: null,
  upgrades: { blade: 0, engine: 0, push: 0 },
} as const;

function record(controls: PlaythroughControl[]) {
  const recorder = new PlaythroughRecorder(structuredClone(setup) as never, "1.0.0");
  controls.forEach((control, i) => {
    if (i === 2) recorder.action({ kind: "upgrade", id: "engine" });
    recorder.control(control);
  });
  return recorder.finish(digest({ steps: controls.length }), "2026-10-13T00:00:00.000Z");
}

const W = { throttle: 1, steer: 0, blade: false };
const WD = { throttle: 1, steer: 0.4, blade: true };
const IDLE = { throttle: 0, steer: 0, blade: false };

describe("playthrough recording", () => {
  it("stores only control changes and replays the exact per-step control stream", () => {
    const stream = [IDLE, W, W, W, WD, WD, IDLE];
    const p = record(stream);
    expect(p.controls).toEqual([[0, 0, 0, 0], [1, 1, 0, 0], [4, 1, 0.4, 1], [6, 0, 0, 0]]);
    expect(p.steps).toBe(7);
    const player = new PlaythroughPlayer(parsePlaythrough(JSON.stringify(p)));
    expect(stream.map(() => player.control())).toEqual(stream);
    expect(player.holds).toBe(true);
  });

  it("releases each action once, before the step it was recorded at", () => {
    const player = new PlaythroughPlayer(record([W, W, W, W]));
    player.control();
    expect(player.due()).toEqual([]);
    player.control();
    expect(player.done).toBe(false);
    expect(player.due()).toEqual([{ at: 2, kind: "upgrade", id: "engine" }]);
    expect(player.due()).toEqual([]);
  });

  it("holds while paused and copies the setup so later play cannot change the recording", () => {
    const live = structuredClone(setup) as never as { upgrades: { blade: number } };
    const recorder = new PlaythroughRecorder(live as never, "1.0.0");
    recorder.control(W);
    const p = recorder.finish(digest());
    live.upgrades.blade = 9;
    expect(p.upgrades.blade).toBe(0);
    const player = new PlaythroughPlayer(p);
    expect(player.holds).toBe(false);
    player.paused = true;
    expect(player.holds).toBe(true);
  });
});

describe("playthrough verification", () => {
  it("names every end-state field that drifted", () => {
    expect(digestDrift(digest(), digest())).toEqual([]);
    expect(digestDrift(digest(), digest({ cash: 121, dozer: { ...digest().dozer, x: 1.0000001 }, cells: { intact: 10 } })))
      .toEqual(["cash", "dozer.x", "cells.breached"]);
  });

  it("rejects payloads that cannot rebuild the run", () => {
    const good = record([W]);
    expect(() => parsePlaythrough("[]")).toThrow("Not a PERMIT DENIED playthrough file.");
    expect(() => parsePlaythrough(null)).toThrow("JSON object");
    expect(() => parsePlaythrough({ ...good, version: 2 })).toThrow("Unsupported playthrough version 2.");
    expect(() => parsePlaythrough({ ...good, rules: undefined })).toThrow("site setup");
    expect(() => parsePlaythrough({ ...good, steps: -1 })).toThrow("step count");
    expect(() => parsePlaythrough({ ...good, actions: undefined })).toThrow("input stream");
    expect(() => parsePlaythrough({ ...good, controls: [[0, 1, "x", 0]] })).toThrow("control entry");
    expect(parsePlaythrough(good)).toBe(good);
  });
});

describe("playthrough badge", () => {
  const status = (over: Partial<PlaythroughStatus>): PlaythroughStatus => ({
    state: "replaying", step: 0, steps: 0, paused: false, done: false, drift: null, hasLast: true, note: "", ...over,
  });

  it("shows capture time, replay progress and the verdict", () => {
    expect(playthroughLabel(status({ state: "idle" }))).toBe("");
    expect(playthroughLabel(status({ state: "recording", step: 3720 }))).toBe("REC 1:02");
    expect(playthroughLabel(status({ step: 600, steps: 3600, paused: true }))).toBe("REPLAY 0:10 / 1:00 · PAUSED");
    expect(playthroughLabel(status({ step: 3600, steps: 3600, drift: [] }))).toBe("REPLAY 1:00 / 1:00 · MATCH");
    expect(playthroughLabel(status({ step: 3600, steps: 3600, drift: ["cash"] }))).toBe("REPLAY 1:00 / 1:00 · DRIFT");
  });
});
