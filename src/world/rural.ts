import { aabbOverlap, len } from "../game/math";
import { Rng } from "../game/rng";
import { DISTRICT_COUNTS, type DistrictId } from "../game/session";
import type { Building, GroundPatch, Lot, Prop } from "../structure/types";
import { getAsset, spawnAsset } from "./catalog";
import { buildingOccupy, dressLot, fillWorldGround } from "./dressing";
import {
  PARCEL,
  allocateFrontage,
  attachDriveway,
  expandStreets,
  placeBuildingInLot,
  type NhoodDebug,
  type NhoodReject,
} from "./parcels";
import {
  curvePoints,
  derivedRoadBoxes,
  emptyTerrain,
  linePoints,
  offsetPoint,
  pointOnRoad,
  polylineLength,
  pt,
  RoadBuilder,
  samplePolyline,
  type RoadNetwork,
  type RoadNode,
  type RoadSegment,
  type TerrainField,
} from "./roads";
import type { Town } from "./town";

export interface LayoutIssue {
  code: string;
  detail: string;
}

export type TopologyFamily = "county" | "crossroads" | "tjunction" | "curve-farm" | "loop" | "frontage";

export interface RuralLayout {
  buildings: Building[];
  props: Prop[];
  lots: Lot[];
  ground: GroundPatch[];
  network: RoadNetwork;
  terrain: TerrainField;
  roads: Town["roads"];
  spawnX: number;
  spawnY: number;
  spawnHeading: number;
  roadSpawnX: number;
  roadSpawnY: number;
  roadSpawnHeading: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  district: DistrictId;
  seed: number;
  topology: TopologyFamily;
  diagnostic: { ok: boolean; issues: LayoutIssue[] };
  nhood: NhoodDebug;
}

export function pickTopology(rng: Rng, count: number): TopologyFamily {
  const families: TopologyFamily[] = ["county", "crossroads", "tjunction", "curve-farm", "loop", "frontage"];
  void count;
  return rng.pick(families);
}

export function generateRuralLayout(
  id: Exclude<DistrictId, "classic">,
  seed: number,
  topologyOverride?: TopologyFamily,
): RuralLayout {
  const count = DISTRICT_COUNTS[id];
  const rng = new Rng(seed);
  const topology = topologyOverride ?? pickTopology(rng, count);
  const b = new RoadBuilder();
  const originX = 4;
  const originY = 4;
  const issues: LayoutIssue[] = [];
  const rejected: NhoodReject[] = [];

  buildSkeleton(b, topology, count, originX, originY, rng);
  b.normalizeJunctions();

  for (let pass = 0; pass <= PARCEL.maxExpand; pass++) {
    const slots = estimateSlots(b.segments, b.nodes);
    if (slots >= count * 1.7) break;
    if (!expandStreets(b, rng, pass)) {
      if (slots >= count) break;
      continue;
    }
    b.normalizeJunctions();
  }

  const clusterRng = new Rng(seed ^ 0x51a11);
  const developed = selectStreetCluster(b.segments, b.nodes, Math.ceil(count * 1.7) + 6, clusterRng);
  const alloc = allocateFrontage(developed, b.nodes, count * 3, new Rng(seed ^ 0x51a11), [], b.segments);
  const pool = selectLotCluster(alloc.lots, count * 2, new Rng(seed ^ 0xc1a55));
  rejected.push(...alloc.rejected);

  const buildings: Building[] = [];
  const kept: Lot[] = [];
  const corridors: { x: number; y: number }[][] = [];
  const publicSegs = () => b.segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");

  for (const lot of pool) {
    if (kept.length >= count) break;
    lot.zone = zoneForIndex(kept.length, count, lot.frontage.segmentId, b.segments);
    lot.identity = identityForIndex(kept.length, count, lot.frontage.segmentId, b.segments, rng);
    const building = placeBuildingInLot(lot, rng, buildings, publicSegs(), corridors);
    if (!building) {
      rejected.push({ kind: "building", reason: "no-fit", points: lot.boundary });
      continue;
    }
    const drive = attachDriveway(b, lot, building, [...kept, ...pool]);
    if (!drive || drive.reject) {
      rejected.push(drive?.reject ?? { kind: "driveway", reason: "failed", points: lot.boundary });
      continue;
    }
    buildings.push(building);
    kept.push(lot);
    corridors.push(drive.corridor);
  }

  if (kept.length < count) {
    const extraSegs = selectStreetCluster(b.segments, b.nodes, Math.ceil(count * 2.1), new Rng(seed ^ 0x222));
    const extra = allocateFrontage(extraSegs, b.nodes, count * 3, new Rng(seed ^ 0x222), kept, b.segments);
    rejected.push(...extra.rejected);
    for (const lot of extra.lots) {
      if (kept.length >= count) break;
      if (kept.some((k) => k.id === lot.id)) continue;
      lot.zone = zoneForIndex(kept.length, count, lot.frontage.segmentId, b.segments);
      lot.identity = identityForIndex(kept.length, count, lot.frontage.segmentId, b.segments, rng);
      const building = placeBuildingInLot(lot, rng, buildings, publicSegs(), corridors);
      if (!building) {
        rejected.push({ kind: "building", reason: "no-fit", points: lot.boundary });
        continue;
      }
      const drive = attachDriveway(b, lot, building, [...kept, ...extra.lots]);
      if (!drive || drive.reject) {
        rejected.push(drive?.reject ?? { kind: "driveway", reason: "failed", points: lot.boundary });
        continue;
      }
      buildings.push(building);
      kept.push(lot);
      corridors.push(drive.corridor);
    }
  }

  if (kept.length < count) {
    issues.push({
      code: "capacity",
      detail: `placed ${kept.length} of ${count} after bounded expansion (${rejected.length} rejected)`,
    });
  }

  b.dropAccessesForLots(new Set(kept.map((l) => l.id)));
  const network = b.finish({ normalize: false });
  for (const lot of kept) {
    const acc = network.accesses.find((a) => a.id === lot.accessId || a.lotId === lot.id);
    if (acc) {
      lot.accessId = acc.id;
      lot.frontage.segmentId = acc.segmentId;
    }
  }

  const occBoxes = buildings.flatMap(buildingOccupy);
  const props: Prop[] = [];
  const ground: GroundPatch[] = [];
  const perLot = count >= 80 ? 6 : 7;
  for (let i = 0; i < kept.length; i++) {
    const lot = kept[i]!;
    const dressed = dressLot(lot, buildings[i], rng, { boxes: occBoxes }, perLot, corridors);
    props.push(...dressed.props);
    ground.push(...dressed.patches);
    for (const p of dressed.props) occBoxes.push({ x: p.x, y: p.y, w: p.w, d: p.d });
  }

  placeRoadside(network, kept, buildings, props, rng, count, corridors);
  for (let i = props.length - 1; i >= 0; i--) {
    const p = props[i]!;
    const def = getAsset(p.assetId);
    if (def.roadsideOk) continue;
    if (propTouchesPavement(network, p)) props.splice(i, 1);
  }

  let minX = originX - 2;
  let minY = originY - 2;
  let maxX = originX + 20;
  let maxY = originY + 20;
  for (const n of network.nodes) {
    minX = Math.min(minX, n.x - 6);
    minY = Math.min(minY, n.y - 6);
    maxX = Math.max(maxX, n.x + 6);
    maxY = Math.max(maxY, n.y + 6);
  }
  for (const lot of kept) {
    minX = Math.min(minX, lot.x - 1);
    minY = Math.min(minY, lot.y - 1);
    maxX = Math.max(maxX, lot.x + lot.w + 1);
    maxY = Math.max(maxY, lot.y + lot.d + 1);
  }

  const terrain = emptyTerrain(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
  applyTerrain(terrain, topology, minX, maxX);
  ground.unshift(...fillWorldGround(minX - 1, minY - 1, maxX + 1, maxY + 1, seed));

  const roads = derivedRoadBoxes(network);
  const spawn = pickSpawn(network, buildings, props, 0);
  const roadSpawn = pickSpawn(network, buildings, props, 1, spawn);

  return {
    buildings,
    props,
    lots: kept,
    ground,
    network,
    terrain,
    roads,
    spawnX: spawn.x,
    spawnY: spawn.y,
    spawnHeading: spawn.heading,
    roadSpawnX: roadSpawn.x,
    roadSpawnY: roadSpawn.y,
    roadSpawnHeading: roadSpawn.heading,
    minX,
    minY,
    maxX,
    maxY,
    district: id,
    seed,
    topology,
    diagnostic: { ok: issues.length === 0 && kept.length === count, issues },
    nhood: { rejected },
  };
}

function addTopologyFlavor(b: RoadBuilder, topology: TopologyFamily, ox: number, oy: number, rng: Rng): void {
  const host = b.segments.find((s) => s.roadClass === "rural") ?? b.segments[0];
  if (!host) return;
  if (topology === "loop") {
    const p = samplePolyline(host.points, 0.35);
    const j = b.joinAt(p.x, p.y, p.elev, host.layer);
    const r = 14;
    const ring = [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + 0.2;
      return b.node(j.x + 16 + Math.cos(a) * r, j.y + Math.sin(a) * r, p.elev);
    });
    for (let i = 0; i < ring.length; i++) {
      b.segment(ring[i]!, ring[(i + 1) % ring.length]!, linePoints(pt(ring[i]!), pt(ring[(i + 1) % ring.length]!)), {
        roadClass: "residential",
      });
    }
    b.segment(j, ring[0]!, linePoints(pt(j), pt(ring[0]!)), { roadClass: "residential" });
    b.segment(ring[0]!, ring[2]!, linePoints(pt(ring[0]!), pt(ring[2]!)), { roadClass: "residential" });
  } else if (topology === "curve-farm") {
    const p = samplePolyline(host.points, 0.6);
    const j = b.joinAt(p.x, p.y, p.elev, host.layer);
    const end = b.node(p.x + 22, p.y + 18, p.elev + 0.3);
    b.segment(j, end, curvePoints(pt(j), { x: p.x + 8, y: p.y + 16, elev: p.elev + 0.15 }, pt(end)), { roadClass: "rural" });
  } else if (topology === "tjunction" || topology === "frontage") {
    const p = samplePolyline(host.points, 0.45);
    const j = b.joinAt(p.x, p.y, p.elev, host.layer);
    const dead = b.node(p.x + rng.range(10, 16), p.y + (topology === "tjunction" ? 20 : -14), p.elev);
    b.segment(j, dead, linePoints(pt(j), pt(dead)), { roadClass: topology === "frontage" ? "service" : "residential" });
  }
  void ox;
  void oy;
}

function gridDims(count: number): { ew: number; ns: number } {
  const minSlots = count <= 12 ? count * 2.2 : count <= 36 ? count * 2.0 : count * 2.15;
  const target = count <= 12 ? count * 2.6 : count * 2.3;
  let best = { ew: 2, ns: 2 };
  let bestScore = Infinity;
  for (let ew = 2; ew <= 7; ew++) {
    for (let ns = 2; ns <= 7; ns++) {
      const segs = ew * ns + (ns + 1) * (ew - 1);
      const slots = segs * 6;
      if (slots < minSlots) continue;
      const score = Math.abs(slots - target) + Math.abs(ew - ns) * 3 + ew * ns * 0.15;
      if (score < bestScore) {
        best = { ew, ns };
        bestScore = score;
      }
    }
  }
  return best;
}

function selectStreetCluster(
  segments: readonly RoadSegment[],
  nodes: readonly RoadNode[],
  needSlots: number,
  rng: Rng,
): RoadSegment[] {
  const publicSegs = segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  if (!publicSegs.length) return [];
  const byId = new Map(publicSegs.map((s) => [s.id, s]));
  const start = publicSegs[rng.int(0, publicSegs.length - 1)]!;
  const selected = new Set<string>([start.id]);
  const selectedList = () => publicSegs.filter((s) => selected.has(s.id));

  const neighborsOf = (id: string): RoadSegment[] => {
    const seg = byId.get(id);
    if (!seg) return [];
    const out: RoadSegment[] = [];
    for (const nid of [seg.startId, seg.endId]) {
      const node = nodes.find((n) => n.id === nid);
      if (!node) continue;
      for (const sid of node.segmentIds) {
        if (selected.has(sid)) continue;
        const other = byId.get(sid);
        if (other) out.push(other);
      }
    }
    return out;
  };

  while (estimateSlots(selectedList(), nodes) < needSlots) {
    const frontier: RoadSegment[] = [];
    for (const id of selected) frontier.push(...neighborsOf(id));
    if (!frontier.length) {
      const leftover = publicSegs.find((s) => !selected.has(s.id));
      if (!leftover) break;
      selected.add(leftover.id);
      continue;
    }
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const s of selectedList()) {
      const a = s.points[0]!;
      const b = s.points[s.points.length - 1]!;
      cx += a.x + b.x;
      cy += a.y + b.y;
      n += 2;
    }
    cx /= Math.max(1, n);
    cy /= Math.max(1, n);
    let best = frontier[0]!;
    let bestD = Infinity;
    for (const s of frontier) {
      const mid = samplePolyline(s.points, 0.5);
      const d = (mid.x - cx) * (mid.x - cx) + (mid.y - cy) * (mid.y - cy);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    selected.add(best.id);
  }
  return selectedList();
}

function selectLotCluster(lots: readonly Lot[], want: number, rng: Rng): Lot[] {
  if (lots.length <= want) return [...lots];
  const origin = lots[rng.int(0, lots.length - 1)]!;
  const picked: Lot[] = [origin];
  const remaining = lots.filter((l) => l.id !== origin.id);
  while (picked.length < want && remaining.length) {
    const cx = picked.reduce((s, l) => s + l.x + l.w * 0.5, 0) / picked.length;
    const cy = picked.reduce((s, l) => s + l.y + l.d * 0.5, 0) / picked.length;
    let bi = 0;
    let best = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const l = remaining[i]!;
      let score = (l.x + l.w * 0.5 - cx) ** 2 + (l.y + l.d * 0.5 - cy) ** 2;
      if (picked.some((p) => p.frontage.segmentId === l.frontage.segmentId)) score *= 0.4;
      if (score < best) {
        best = score;
        bi = i;
      }
    }
    picked.push(remaining.splice(bi, 1)[0]!);
  }
  return picked;
}

function buildBlockGrid(b: RoadBuilder, count: number, ox: number, oy: number, rng: Rng): void {
  const { ew, ns } = gridDims(count);
  const blockW = 40;
  const blockD = 36;
  const rows: ReturnType<RoadBuilder["node"]>[][] = [];
  for (let r = 0; r < ew; r++) {
    const y = oy + 12 + r * blockD + rng.range(-0.3, 0.3);
    const row = [];
    for (let c = 0; c <= ns; c++) {
      row.push(b.node(ox + 2 + c * blockW, y, r * 0.02));
    }
    for (let c = 0; c < ns; c++) {
      b.segment(row[c]!, row[c + 1]!, linePoints(pt(row[c]!), pt(row[c + 1]!)), {
        roadClass: r === 0 ? "rural" : "residential",
      });
    }
    rows.push(row);
  }
  for (let c = 0; c <= ns; c++) {
    for (let r = 0; r < ew - 1; r++) {
      b.segment(rows[r]![c]!, rows[r + 1]![c]!, linePoints(pt(rows[r]![c]!), pt(rows[r + 1]![c]!)), {
        roadClass: c === 0 || c === ns ? "rural" : "residential",
      });
    }
  }
  const dead = rows[0]![0]!;
  const spur = b.node(dead.x - 18, dead.y + rng.range(-1, 1), dead.elev);
  b.segment(dead, spur, linePoints(pt(dead), pt(spur)), { roadClass: "service" });
}

function estimateSlots(segments: readonly RoadSegment[], nodes: readonly { id: string; segmentIds: string[] }[]): number {
  const publicSegs = segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  const publicIds = new Set(publicSegs.map((s) => s.id));
  let n = 0;
  for (const seg of publicSegs) {
    const path = polylineLength(seg.points);
    const start = (nodes.find((x) => x.id === seg.startId)?.segmentIds.filter((id) => publicIds.has(id)).length ?? 1) >= 3 ? 3.6 : 1.4;
    const end = (nodes.find((x) => x.id === seg.endId)?.segmentIds.filter((id) => publicIds.has(id)).length ?? 1) >= 3 ? 3.6 : 1.4;
    n += Math.max(0, Math.floor((path - start - end) / 9)) * 2;
  }
  return n;
}

function zoneForIndex(i: number, count: number, segmentId: string, segs: readonly RoadSegment[]): Lot["zone"] {
  const seg = segs.find((s) => s.id === segmentId);
  const roadClass = seg?.roadClass ?? "residential";
  if (roadClass === "service" || roadClass === "commercial") return i % 3 === 0 ? "industrial" : "commercial";
  if (i === 0) return "commercial";
  if (i >= count - 2) return "industrial";
  return i % 6 === 0 ? "commercial" : "residential";
}

function identityForIndex(
  i: number,
  count: number,
  segmentId: string,
  segs: readonly RoadSegment[],
  rng: Rng,
): Lot["identity"] {
  const seg = segs.find((s) => s.id === segmentId);
  const roadClass = seg?.roadClass ?? "residential";
  if (roadClass === "service") return rng.chance(0.5) ? "utility" : "contractor";
  if (i === 0 || (roadClass === "rural" && i % 11 === 0)) return "shop";
  if (i % 9 === 3) return "service";
  if (i % 5 === 2 || (roadClass === "rural" && i % 4 === 1)) return "farm";
  if (i === count - 1) return "utility";
  return "residence";
}

function buildSkeleton(
  b: RoadBuilder,
  topology: TopologyFamily,
  count: number,
  ox: number,
  oy: number,
  rng: Rng,
): RoadSegment[] {
  const pairPitch = 14.2 * 2 + 9.5;
  const collectors = Math.max(2, Math.ceil(count / 14));
  const slotsPerSide = Math.ceil(count / (collectors * 2)) + 4;
  const spineLen = Math.max(80, slotsPerSide * 12.8 + 18);
  const branch = Math.max(pairPitch * 0.6, 20 + count * 0.14);

  if (count >= 8) {
    buildBlockGrid(b, count, ox, oy, rng);
    addTopologyFlavor(b, topology, ox, oy, rng);
    return b.segments.filter((s) => s.roadClass !== "driveway");
  }

  if (topology === "county") {
    const spines: RoadSegment[] = [];
    for (let r = 0; r < collectors; r++) {
      const y = oy + 16 + r * pairPitch + rng.range(-1.0, 1.0);
      const elev = r * 0.08;
      const a = b.node(ox, y, elev);
      const m = b.node(ox + spineLen * 0.5, y + rng.range(-1.6, 1.6), elev + 0.1);
      const c = b.node(ox + spineLen, y + rng.range(-1.0, 1.0), elev + 0.2);
      b.segment(a, m, linePoints(pt(a), pt(m)), { roadClass: "rural" });
      spines.push(b.segment(m, c, linePoints(pt(m), pt(c)), { roadClass: "rural" }));
    }
    const crosses = Math.max(1, collectors + (count >= 30 ? 2 : 0));
    const main = b.segments[0]!;
    for (let i = 0; i < crosses; i++) {
      const t = 0.16 + (i / Math.max(1, crosses)) * 0.68 + rng.range(-0.015, 0.015);
      const p = samplePolyline(main.points, Math.min(0.9, t));
      const at = b.joinAt(p.x, p.y, p.elev, 0);
      const n0 = b.node(p.x, oy + 4, p.elev);
      const n1 = b.node(p.x + rng.range(-0.8, 0.8), oy + 16 + (collectors - 1) * pairPitch + branch * 0.4, p.elev);
      b.segment(n0, at, linePoints(pt(n0), pt(at)), { roadClass: "residential" });
      b.segment(at, n1, linePoints(pt(at), pt(n1)), { roadClass: "residential" });
    }
  } else if (topology === "crossroads") {
    const cx = ox + spineLen * 0.42;
    const cy = oy + branch * 0.55;
    const c = b.node(cx, cy, 0.1);
    const w = b.node(ox, cy + rng.range(-1, 1), 0);
    const e = b.node(ox + spineLen, cy + rng.range(-1, 1), 0.25);
    const n = b.node(cx + rng.range(-1, 1), oy + branch * 1.15, 0.15);
    const s = b.node(cx + rng.range(-1, 1), oy, 0);
    b.segment(w, c, linePoints(pt(w), pt(c)), { roadClass: "rural" });
    b.segment(c, e, linePoints(pt(c), pt(e)), { roadClass: "rural" });
    b.segment(n, c, linePoints(pt(n), pt(c)), { roadClass: "residential" });
    b.segment(c, s, linePoints(pt(c), pt(s)), { roadClass: "residential" });
    if (count >= 24) {
      const svc = b.node(cx + 8, cy + 7, 0.1);
      b.segment(c, svc, linePoints(pt(c), pt(svc)), { roadClass: "service" });
    }
    if (count >= 16) {
      const mid = samplePolyline(b.segments[0]!.points, 0.55);
      const j = b.joinAt(mid.x, mid.y, mid.elev, 0);
      const spur = b.node(mid.x, mid.y + branch * 0.35, mid.elev);
      b.segment(j, spur, linePoints(pt(j), pt(spur)), { roadClass: "residential" });
    }
  } else if (topology === "tjunction") {
    const c = b.node(ox + spineLen * 0.4, oy + 16, 0.1);
    const w = b.node(ox, oy + 16, 0);
    const e = b.node(ox + spineLen, oy + 16, 0.2);
    const n = b.node(ox + spineLen * 0.4, oy + 16 + branch, 0.15);
    b.segment(w, c, linePoints(pt(w), pt(c)), { roadClass: "rural" });
    b.segment(c, e, linePoints(pt(c), pt(e)), { roadClass: "rural" });
    b.segment(c, n, linePoints(pt(c), pt(n)), { roadClass: "residential" });
    const stem = samplePolyline(b.segments[2]!.points, 0.58);
    const j = b.joinAt(stem.x, stem.y, stem.elev, 0);
    const dead = b.node(stem.x + branch * 0.42, stem.y + rng.range(-1.2, 1.2), stem.elev);
    b.segment(j, dead, linePoints(pt(j), pt(dead)), { roadClass: "residential" });
  } else if (topology === "curve-farm") {
    const a = b.node(ox, oy + 10, 0);
    const ctrl = { x: ox + spineLen * 0.45, y: oy + 10 + branch * 0.55, elev: 0.4 };
    const c = b.node(ox + spineLen, oy + 12 + rng.range(-2, 4), 0.7);
    const mid = b.node(ctrl.x, ctrl.y, ctrl.elev);
    b.segment(a, mid, curvePoints(pt(a), ctrl, pt(mid)), { roadClass: "rural" });
    b.segment(mid, c, curvePoints(pt(mid), { x: (ctrl.x + c.x) * 0.5, y: ctrl.y - 4, elev: 0.55 }, pt(c)), {
      roadClass: "rural",
    });
    const spur = b.node(ctrl.x + 6, ctrl.y + branch * 0.35, 0.4);
    b.segment(mid, spur, linePoints(pt(mid), pt(spur)), { roadClass: "service" });
    if (count >= 20) {
      const p = samplePolyline(b.segments[0]!.points, 0.48);
      const j = b.joinAt(p.x, p.y, p.elev, 0);
      const local = b.node(p.x - 4, p.y + 16, p.elev);
      b.segment(j, local, linePoints(pt(j), pt(local)), { roadClass: "residential" });
    }
  } else if (topology === "loop") {
    const r = Math.max(18, 14 + count * 0.28);
    const cx = ox + r + 8;
    const cy = oy + r + 8;
    const nodes = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      return b.node(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.05);
    });
    for (let i = 0; i < nodes.length; i++) {
      b.segment(nodes[i]!, nodes[(i + 1) % nodes.length]!, linePoints(pt(nodes[i]!), pt(nodes[(i + 1) % nodes.length]!)), {
        roadClass: "residential",
      });
    }
    const stem = b.node(cx + r + 16, cy, 0);
    b.segment(nodes[0]!, stem, linePoints(pt(nodes[0]!), pt(stem)), { roadClass: "rural" });
    b.segment(nodes[2]!, nodes[5]!, linePoints(pt(nodes[2]!), pt(nodes[5]!)), { roadClass: "residential" });
  } else {
    const a = b.node(ox, oy + 20, 0);
    const c = b.node(ox + spineLen, oy + 20, 0.15);
    b.segment(a, c, linePoints(pt(a), pt(c)), { roadClass: "rural" });
    const s0 = b.node(ox + 6, oy + 12, 0);
    const s1 = b.node(ox + spineLen - 6, oy + 12, 0.1);
    b.segment(s0, s1, linePoints(pt(s0), pt(s1)), { roadClass: "service" });
    const links = count >= 20 ? 3 : 2;
    for (let i = 0; i < links; i++) {
      const t = 0.2 + (i / Math.max(1, links - 1)) * 0.6;
      const p = samplePolyline(b.segments[0]!.points, t);
      const q = samplePolyline(b.segments[1]!.points, t);
      const n0 = b.joinAt(p.x, p.y, p.elev, 0);
      const n1 = b.joinAt(q.x, q.y, q.elev, 0);
      b.segment(n0, n1, linePoints(pt(n0), pt(n1)), { roadClass: "residential" });
    }
  }
  if (count >= 24) {
    const extras = Math.ceil(count / 10);
    for (let i = 0; i < extras; i++) {
      const host = b.segments.filter((s) => s.roadClass !== "driveway")[i % Math.max(1, b.segments.length)]!;
      const t = 0.28 + (i * 0.19) % 0.5;
      const p = samplePolyline(host.points, t);
      const j = b.joinAt(p.x, p.y, p.elev, host.layer);
      const heading = p.heading + (i % 2 === 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      const reach = 28 + count * 0.08;
      const end = b.node(j.x + Math.cos(heading) * reach, j.y + Math.sin(heading) * reach, p.elev, undefined, host.layer);
      b.segment(j, end, linePoints(pt(j), pt(end)), { roadClass: "residential", layer: host.layer });
    }
  }
  return b.segments.filter((s) => s.roadClass !== "driveway");
}

function placeRoadside(
  network: RoadNetwork,
  lots: Lot[],
  buildings: Building[],
  props: Prop[],
  rng: Rng,
  count: number,
  corridors: readonly { x: number; y: number }[][],
): void {
  const occ = [...buildings.flatMap(buildingOccupy), ...lots.map((l) => ({ x: l.x, y: l.y, w: l.w, d: l.d }))];
  for (const p of props) occ.push({ x: p.x, y: p.y, w: p.w, d: p.d });
  const ids = ["stop-sign", "power-pole", "fire-hydrant", "guardrail", "traffic-barrel", "billboard", "light"];
  let placed = 0;
  const cap = Math.min(count + 8, 4 + Math.floor(count * 0.35));
  for (const seg of network.segments) {
    if (seg.roadClass === "driveway") continue;
    const path = Math.max(8, polylineLength(seg.points));
    const n = path > 30 ? 2 : 1;
    for (let i = 0; i < n && placed < cap; i++) {
      const t = 0.18 + i * 0.38 + rng.range(0, 0.08);
      const p = samplePolyline(seg.points, Math.min(0.86, t));
      const side = i % 2 === 0 ? 1 : -1;
      const pos = offsetPoint(p.x, p.y, p.heading, (seg.width * 0.5 + 0.55) * side);
      const id = rng.pick(ids);
      const asset = spawnAsset(id, pos.x - 0.15, pos.y - 0.15, p.heading + (side > 0 ? 0 : Math.PI), rng.int(0, 2));
      if (occ.some((box) => aabbOverlap(asset.x, asset.y, asset.w, asset.d, box.x, box.y, box.w, box.d))) continue;
      if (corridors.some((poly) => pointNearPoly(asset.x + asset.w * 0.5, asset.y + asset.d * 0.5, poly))) continue;
      props.push(asset);
      occ.push({ x: asset.x, y: asset.y, w: asset.w, d: asset.d });
      placed++;
    }
  }
}

function pointNearPoly(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const c = poly[(i + 1) % poly.length]!;
    const abx = c.x - a.x;
    const aby = c.y - a.y;
    const t = clamp01(((x - a.x) * abx + (y - a.y) * aby) / (abx * abx + aby * aby + 1e-8));
    if (len(x - (a.x + abx * t), y - (a.y + aby * t)) < 1.1) return true;
  }
  return false;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function propTouchesPavement(network: RoadNetwork, p: Prop): boolean {
  return pointOnRoad(network, p.x + p.w * 0.5, p.y + p.d * 0.5);
}

function pickSpawn(
  network: RoadNetwork,
  buildings: Building[],
  props: Prop[],
  pick: number,
  avoid?: { x: number; y: number },
): { x: number; y: number; heading: number } {
  const segs = network.segments.filter((s) => s.roadClass === "rural" || s.roadClass === "residential");
  const pool = segs.length ? segs : network.segments.filter((s) => s.roadClass !== "driveway");
  const tries = [0.2, 0.35, 0.5, 0.65, 0.8];
  for (const seg of pool) {
    for (const t of tries) {
      const p = samplePolyline(seg.points, t);
      if (avoid && len(p.x - avoid.x, p.y - avoid.y) < 6) continue;
      if (clear(buildings, props, p.x, p.y)) {
        if (pick === 0) return { x: p.x, y: p.y, heading: p.heading };
        pick--;
      }
    }
  }
  const fallback = samplePolyline(pool[0]!.points, 0.4);
  return { x: fallback.x, y: fallback.y, heading: fallback.heading };
}

function clear(buildings: Building[], props: Prop[], x: number, y: number): boolean {
  const rad = 1.4;
  for (const b of buildings) {
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, b.x, b.y, b.w * b.cellSize, b.d * b.cellSize)) return false;
  }
  for (const p of props) {
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, p.x, p.y, p.w, p.d)) return false;
  }
  return true;
}

function applyTerrain(field: TerrainField, topology: TopologyFamily, minX: number, maxX: number): void {
  if (topology !== "curve-farm" && topology !== "county") return;
  const w = Math.max(1, maxX - minX);
  for (let iy = 0; iy < field.rows; iy++) {
    for (let ix = 0; ix < field.cols; ix++) {
      const x = field.ox + ix * field.cell;
      const t = (x - minX) / w;
      field.height[iy * field.cols + ix] = topology === "curve-farm" ? Math.sin(t * Math.PI) * 0.7 : t * 0.35;
    }
  }
}
