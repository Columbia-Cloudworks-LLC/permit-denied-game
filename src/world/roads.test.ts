import { describe, expect, it } from "vitest";
import { createTown } from "./town";
import {
  canTransitionBetweenSurfaces,
  findRoadRoute,
  makeCurveCrossFixture,
  makeRaisedRoadFixture,
  nearestLane,
  pointOnRoad,
  projectPointToRoad,
  roadSurfaceAt,
  terrainHeightAt,
  validateRoadNetwork,
} from "./roads";

describe("road network", () => {
  it("validates unique ids and connected lanes", () => {
    const net = makeCurveCrossFixture();
    const report = validateRoadNetwork(net);
    expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reproduces generated topology for the same seed", () => {
    const a = createTown({ district: "d10", seed: 0x51a11 });
    const b = createTown({ district: "d10", seed: 0x51a11 });
    const sig = (t: typeof a) =>
      t.network.segments.map((s) => `${s.id}:${s.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("/")}`).join("|");
    expect(sig(a)).toBe(sig(b));
    expect(a.network.nodes.length).toBe(b.network.nodes.length);
  });

  it("answers surface and projection queries without scanning every step by brute force", () => {
    const town = createTown({ district: "d10", seed: 4 });
    const n = town.network.nodes[1] ?? town.network.nodes[0]!;
    const hit = roadSurfaceAt(town.network, n.x, n.y);
    expect(hit.on).toBe(true);
    const proj = projectPointToRoad(town.network, n.x + 0.4, n.y + 0.2);
    expect(proj.segmentId).toBeTruthy();
    expect(pointOnRoad(town.network, town.spawnX, town.spawnY)).toBe(true);
    expect(nearestLane(town.network, town.spawnX, town.spawnY)).toBeTruthy();
  });

  it("keeps overlapping layers separate unless a ramp joins them", () => {
    const { network, terrain } = makeRaisedRoadFixture();
    const ground = roadSurfaceAt(network, 8, 0, 0);
    const deck = roadSurfaceAt(network, 8, 8, 1);
    expect(ground.on).toBe(true);
    expect(deck.on).toBe(true);
    expect(deck.elev).toBeGreaterThan(ground.elev + 0.8);
    expect(canTransitionBetweenSurfaces(network, 0, 1, 8, 0)).toBe(false);
    expect(canTransitionBetweenSurfaces(network, 1, 1, 8, 8)).toBe(true);
    expect(terrainHeightAt(terrain, 8, 8)).toBe(0);
  });

  it("finds a lane route through a curve and intersection", () => {
    const net = makeCurveCrossFixture();
    const start = net.lanes.find((l) => l.dir === 1 && net.segments.find((s) => s.id === l.segmentId)?.startId === "w")!;
    const dest = net.lanes.find((l) => l.dir === 1 && net.segments.find((s) => s.id === l.segmentId)?.endId === "s")!;
    const path = findRoadRoute(net, start.id, dest.id);
    expect(path).toBeTruthy();
    expect(path!.length).toBeGreaterThanOrEqual(2);
  });
});
