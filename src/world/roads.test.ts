import { describe, expect, it } from "vitest";
import { createTown } from "./town";
import {
  canTransitionBetweenSurfaces,
  findRoadRoute,
  linePoints,
  makeCurveCrossFixture,
  makeRaisedRoadFixture,
  nearestLane,
  pointOnRoad,
  projectPointToRoad,
  pt,
  publicStreetsReachable,
  RoadBuilder,
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

  it("splits a parent segment when joining at an interior point", () => {
    const b = new RoadBuilder();
    const a = b.node(0, 0, 0, "a");
    const c = b.node(20, 0, 0, "c");
    b.segment(a, c, linePoints(pt(a), pt(c)), { roadClass: "rural" });
    const mid = b.joinAt(10, 0, 0, 0);
    const spur = b.node(10, 8, 0, "spur");
    b.segment(mid, spur, linePoints(pt(mid), pt(spur)), { roadClass: "residential" });
    const net = b.finish();
    expect(net.segments.length).toBeGreaterThanOrEqual(3);
    expect(mid.segmentIds.length).toBeGreaterThanOrEqual(3);
    expect(publicStreetsReachable(net, 1, 0)).toBe(true);
    const from = net.lanes.find((l) => l.dir === 1 && net.segments.find((s) => s.id === l.segmentId)?.startId === "a")!;
    const to = net.lanes.find((l) => l.dir === 1 && net.segments.find((s) => s.id === l.segmentId)?.endId === "spur")!;
    expect(findRoadRoute(net, from.id, to.id)).toBeTruthy();
  });

  it("turns a same-layer crossing into a shared graph node", () => {
    const b = new RoadBuilder();
    const w = b.node(0, 8, 0, "w");
    const e = b.node(20, 8, 0, "e");
    const n = b.node(10, 18, 0, "n");
    const s = b.node(10, 0, 0, "s");
    b.segment(w, e, linePoints(pt(w), pt(e)), { roadClass: "rural" });
    b.segment(n, s, linePoints(pt(n), pt(s)), { roadClass: "residential" });
    const net = b.finish();
    const cross = net.nodes.find((node) => node.segmentIds.length >= 4);
    expect(cross).toBeTruthy();
    expect(net.segments.length).toBeGreaterThanOrEqual(4);
  });

  it("does not join different layers that only overlap in X/Y", () => {
    const { network } = makeRaisedRoadFixture();
    expect(canTransitionBetweenSurfaces(network, 0, 1, 8, 0)).toBe(false);
    const groundIds = new Set(network.segments.filter((s) => s.layer === 0).flatMap((s) => [s.startId, s.endId]));
    const deck = network.nodes.filter((n) => n.id.startsWith("d"));
    expect(deck.every((n) => !groundIds.has(n.id) || n.id.startsWith("r"))).toBe(true);
  });
});
