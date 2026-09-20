import { describe, expect, it } from "vitest";
import {
  DEBUG_BRIDGE_VERSION,
  carryDebugQuery,
  createDebugBridge,
  shouldInstallDebugBridge,
  type DebugHost,
  type GameSnapshot,
} from "./bridge";

function emptySnapshot(): GameSnapshot {
  return {
    cash: 0,
    timeLeft: 180,
    elapsed: 0,
    mode: "play",
    session: "sandbox",
    district: "d10",
    seed: 1,
    dozer: { x: 0, y: 0, heading: 0 },
    rubble: 0,
    marks: 0,
    roadCar: null,
    buildings: [],
  };
}

function host(overrides: Partial<DebugHost> = {}): DebugHost {
  const base: DebugHost = {
    ready: () => true,
    snapshot: emptySnapshot,
    inspect: () => {
      throw new Error("unused");
    },
    townSnapshot: () => {
      throw new Error("unused");
    },
    dozerSnapshot: () => ({ x: 1, y: 2, heading: 0, bladeDown: false, vx: 0 }),
    cameraSnapshot: () => ({ x: 0, y: 0, zoom: 1 }),
    yardInspect: () => ({ followRoadCamera: false, loads: 0, autonomousCount: 0, vehicles: [] }),
    urbanSnapshot: () => undefined,
    obstructionAt: () => ({ blocked: false, height: 0, resistance: 0 }),
    lookAtWorld: () => undefined,
    frameDozer: () => undefined,
    lookAtTown: () => undefined,
    step: () => undefined,
    reset: () => undefined,
    setDozerPose: () => undefined,
    spawnRoadVehicle: () => undefined,
    jumpCampaignLevel: () => undefined,
    analyticsStep: () => undefined,
    finish: () => undefined,
    inputAxis: () => ({ throttle: 0, steer: 0 }),
    runVehiclePerfHarness: async () => ({ vehicles: 0, simP95Ms: 0, renderSubmitP95Ms: 0, stats: {}, renderStats: {} }),
  };
  return { ...base, ...overrides };
}

describe("debug bridge gating", () => {
  it("stays off for ordinary production sessions", () => {
    expect(shouldInstallDebugBridge("", false)).toBe(false);
    expect(shouldInstallDebugBridge("?", false)).toBe(false);
    expect(shouldInstallDebugBridge("?sandbox=1&district=d10&seed=19", false)).toBe(false);
    expect(shouldInstallDebugBridge("?mode=challenge", false)).toBe(false);
  });

  it("installs in development and explicit debug or capture-adjacent modes", () => {
    expect(shouldInstallDebugBridge("", true)).toBe(true);
    expect(shouldInstallDebugBridge("?debug=1", false)).toBe(true);
    expect(shouldInstallDebugBridge("?yard=1", false)).toBe(true);
    expect(shouldInstallDebugBridge("?testAsset=vehicle:bus", false)).toBe(true);
    expect(shouldInstallDebugBridge("?tower=1", false)).toBe(true);
  });

  it("carries debug and control flags when the session URL is rewritten", () => {
    const next = new URLSearchParams("mode=sandbox&district=d10&seed=1");
    carryDebugQuery(new URLSearchParams("debug=1&controls=1&perf=1&variant=2"), next);
    expect(next.get("debug")).toBe("1");
    expect(next.get("controls")).toBe("1");
    expect(next.get("perf")).toBe("1");
    expect(next.get("variant")).toBe("2");
    expect(next.get("mode")).toBe("sandbox");
  });
});

describe("typed debug bridge", () => {
  it("exposes a frozen versioned surface without a Game instance", () => {
    const bridge = createDebugBridge(host());
    expect(bridge.version).toBe(DEBUG_BRIDGE_VERSION);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(bridge.ready()).toBe(true);
    expect(bridge.snapshot().mode).toBe("play");
    expect("town" in bridge).toBe(false);
    expect("hud" in bridge).toBe(false);
    expect("renderer" in bridge).toBe(false);
    expect((bridge as unknown as { constructor: { name: string } }).constructor.name).not.toBe("Game");
  });

  it("returns pose snapshots instead of the live dozer object", () => {
    const pose = { x: 4, y: 8, heading: 1, bladeDown: true, vx: 3 };
    const bridge = createDebugBridge(host({
      dozerSnapshot: () => ({ ...pose }),
    }));
    const first = bridge.dozerSnapshot();
    first.x = 99;
    expect(bridge.dozerSnapshot()).toEqual(pose);
  });
});
