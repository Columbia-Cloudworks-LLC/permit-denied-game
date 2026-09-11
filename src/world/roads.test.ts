import { describe, expect, it } from "vitest";
import { createTown } from "./town";
import { convexOverlap } from "./parcels";
import {
  canTransitionBetweenSurfaces,
  findRoadRoute,
  linePoints,
  makeCurveCrossFixture,
  makeRaisedRoadFixture,
  meshQuadPolygon,
  nearestLane,
  pointOnRoad,
  projectPointToRoad,
  pt,
  publicStreetsReachable,
  RoadBuilder,
  roadSurfaceAt,
  terrainHeightAt,
  validateRoadNetwork,
  type RoadMeshQuad,
  type RoadNetwork,
} from "./roads";

const DRIVE_PAVE = 0x5a5248;

function orientedContains(q: RoadMeshQuad, x: number, y: number): boolean {
  const fx = Math.cos(q.heading);
  const fy = Math.sin(q.heading);
  const dx = x - q.x;
  const dy = y - q.y;
  const along = dx * fx + dy * fy;
  const across = -dx * fy + dy * fx;
  return Math.abs(along) <= q.w * 0.5 + 1e-4 && Math.abs(across) <= q.d * 0.5 + 1e-4;
}

function drivewayStreet(opts: { step: number; angle?: number; reversed?: boolean }): {
  net: RoadNetwork;
  join: { id: string; x: number; y: number };
  streetHalf: number;
} {
  const angle = opts.angle ?? Math.PI / 2;
  const streetHalf = 2.1;
  const b = new RoadBuilder();
  const w = b.node(-20, 0);
  const e = b.node(20, 0);
  b.segment(w, e, linePoints(pt(w), pt(e)), { roadClass: "rural", width: 4.2 });
  const join = b.joinAt(0, 0, 0, 0);
  const arrival = b.node(Math.cos(angle) * 8, Math.sin(angle) * 8, 0);
  const a = opts.reversed ? arrival : join;
  const c = opts.reversed ? join : arrival;
  b.segment(a, c, linePoints(pt(a), pt(c), opts.step), { roadClass: "driveway", width: 2.05, shoulder: 0.12 });
  return { net: b.finish({ normalize: false }), join, streetHalf };
}

function driveQuads(net: RoadNetwork): RoadMeshQuad[] {
  return net.mesh.filter((q) => q.kind === "pavement" && q.color === DRIVE_PAVE);
}

function polyEdgeSamples(poly: readonly { x: number; y: number }[], step = 0.25): { x: number; y: number }[] {
  const out = [...poly];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    for (let t = step; t < 1; t += step) {
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function streetClearance(net: RoadNetwork, streetHalf: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const q of driveQuads(net)) {
    for (const p of polyEdgeSamples(meshQuadPolygon(q))) {
      const d = Math.abs(p.y) - streetHalf;
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  }
  return { min, max };
}

function drivewayMinAlongStreet(net: RoadNetwork): number {
  let minY = Infinity;
  for (const q of driveQuads(net)) {
    for (const p of meshQuadPolygon(q)) minY = Math.min(minY, p.y);
  }
  return minY;
}

function assertDrivewaySeam(net: RoadNetwork, streetHalf: number): number {
  const quads = driveQuads(net);
  expect(quads.length).toBeGreaterThan(0);
  const { min } = streetClearance(net, streetHalf);
  expect(min, `driveway overlaps street interior by ${(-min).toFixed(3)}`).toBeGreaterThanOrEqual(-0.025);
  expect(min, `driveway stops ${min.toFixed(3)} short of the street edge`).toBeLessThanOrEqual(0.12);
  return min;
}

function insetPoly(poly: readonly { x: number; y: number }[], pad: number): { x: number; y: number }[] {
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  return poly.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const s = Math.max(0, d - pad) / d;
    return { x: cx + dx * s, y: cy + dy * s };
  });
}

function assertShoulderOpening(net: RoadNetwork): void {
  const drives = driveQuads(net).map((q) => insetPoly(meshQuadPolygon(q), 0.06));
  expect(drives.length).toBeGreaterThan(0);
  for (const q of net.mesh.filter((m) => m.kind === "shoulder")) {
    const shoulder = meshQuadPolygon(q);
    for (const drive of drives) {
      expect(convexOverlap(shoulder, drive)).toBe(false);
    }
  }
}

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

  it("centers intersection pavement on the node", () => {
    const net = makeCurveCrossFixture();
    const cross = net.nodes.find((n) => n.id === "c")!;
    const caps = net.mesh.filter(
      (q) =>
        q.kind === "pavement" &&
        Math.hypot(q.x - cross.x, q.y - cross.y) < 0.05 &&
        Math.abs(q.heading) < 0.01 &&
        Math.abs(q.w - q.d) < 0.01 &&
        q.w > 2,
    );
    expect(caps.length).toBeGreaterThan(0);
    expect(caps[0]!.x).toBeCloseTo(cross.x, 5);
    expect(caps[0]!.y).toBeCloseTo(cross.y, 5);
  });

  it("keeps shoulders off a crossing interior", () => {
    const b = new RoadBuilder();
    const w = b.node(0, 10, 0, "w");
    const e = b.node(20, 10, 0, "e");
    const n = b.node(10, 20, 0, "n");
    const s = b.node(10, 0, 0, "s");
    b.segment(w, e, linePoints(pt(w), pt(e)), { roadClass: "rural" });
    b.segment(n, s, linePoints(pt(n), pt(s)), { roadClass: "residential" });
    const net = b.finish();
    const cross = net.nodes.find((node) => node.segmentIds.length >= 4)!;
    for (const q of net.mesh.filter((m) => m.kind === "shoulder")) {
      expect(orientedContains(q, cross.x, cross.y)).toBe(false);
    }
  });

  it("keeps a T-junction exterior shoulder continuous", () => {
    const b = new RoadBuilder();
    const w = b.node(0, 0, 0, "w");
    const e = b.node(24, 0, 0, "e");
    b.segment(w, e, linePoints(pt(w), pt(e)), { roadClass: "rural" });
    const j = b.joinAt(12, 0, 0, 0);
    const stem = b.node(12, 14, 0, "n");
    b.segment(j, stem, linePoints(pt(j), pt(stem)), { roadClass: "residential" });
    const net = b.finish();
    const far = net.mesh.filter((q) => q.kind === "shoulder" && q.y < -0.4);
    expect(
      far.some((q) => {
        const xs = meshQuadPolygon(q).map((p) => p.x);
        return Math.min(...xs) < 12 && Math.max(...xs) > 12;
      }),
    ).toBe(true);
  });

  it("terminates driveway mesh at the public pavement edge", () => {
    const { net, join, streetHalf } = drivewayStreet({ step: 2.4 });
    const drive = net.segments.find((s) => s.roadClass === "driveway")!;
    expect(drive.startId === join.id || drive.endId === join.id).toBe(true);
    assertDrivewaySeam(net, streetHalf);
  });

  it("consumes a driveway pavement cut across short sampled edges", () => {
    const { net, streetHalf } = drivewayStreet({ step: 1.2 });
    const minY = drivewayMinAlongStreet(net);
    expect(minY, `driveway pavement reaches Y=${minY.toFixed(6)}; street edge is Y=${streetHalf}`).toBeGreaterThanOrEqual(
      streetHalf - 0.02,
    );
    expect(minY).toBeLessThanOrEqual(streetHalf + 0.08);
    expect(minY).toBeCloseTo(streetHalf, 1);
  });

  it("matches driveway seams for 0.5 / 1.2 / 2.4 sampling", () => {
    const edges: number[] = [];
    for (const step of [0.5, 1.2, 2.4]) {
      const { net, streetHalf } = drivewayStreet({ step });
      const seam = assertDrivewaySeam(net, streetHalf);
      edges.push(seam);
    }
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThan(0.08);
  });

  it("clips an angled driveway against the host pavement, not half-width along the path", () => {
    const { net, streetHalf } = drivewayStreet({ step: 1.2, angle: Math.PI / 4 });
    assertDrivewaySeam(net, streetHalf);
    assertShoulderOpening(net);
  });

  it("trims a driveway that meets the street at its end node", () => {
    const { net, streetHalf } = drivewayStreet({ step: 0.5, reversed: true });
    assertDrivewaySeam(net, streetHalf);
  });

  it("opens the host shoulder at a driveway without a pavement gap", () => {
    const { net, streetHalf } = drivewayStreet({ step: 1.2 });
    assertDrivewaySeam(net, streetHalf);
    assertShoulderOpening(net);
  });

  it("carries junction cuts across short sampled street pieces", () => {
    const b = new RoadBuilder();
    const w = b.node(-16, 0);
    const e = b.node(16, 0);
    b.segment(w, e, linePoints(pt(w), pt(e), 0.5), { roadClass: "rural", width: 4.2 });
    const j = b.joinAt(0, 0, 0, 0);
    const stem = b.node(0, 10);
    b.segment(j, stem, linePoints(pt(j), pt(stem), 0.5), { roadClass: "residential", width: 3.4 });
    const net = b.finish();
    const stemPavement = net.mesh.filter(
      (q) => q.kind === "pavement" && q.color === 0x3e3c3a && Math.abs(q.x) < 2.2,
    );
    expect(stemPavement.length).toBeGreaterThan(0);
    for (const q of stemPavement) {
      for (const p of meshQuadPolygon(q)) {
        if (Math.abs(p.x) > 1.9) continue;
        expect(p.y).toBeGreaterThan(2.1 - 0.12);
      }
    }
    const far = net.mesh.filter((q) => q.kind === "shoulder" && q.y < -0.4);
    expect(
      far.some((q) => {
        const xs = meshQuadPolygon(q).map((p) => p.x);
        return Math.min(...xs) < 0 && Math.max(...xs) > 0;
      }),
    ).toBe(true);
  });

  it("does not join different layers that only overlap in X/Y", () => {
    const { network } = makeRaisedRoadFixture();
    expect(canTransitionBetweenSurfaces(network, 0, 1, 8, 0)).toBe(false);
    const groundIds = new Set(network.segments.filter((s) => s.layer === 0).flatMap((s) => [s.startId, s.endId]));
    const deck = network.nodes.filter((n) => n.id.startsWith("d"));
    expect(deck.every((n) => !groundIds.has(n.id) || n.id.startsWith("r"))).toBe(true);
  });
});
