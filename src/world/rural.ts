import { CELL } from "../game/constants";
import { aabbOverlap, len } from "../game/math";
import { Rng } from "../game/rng";
import { DISTRICT_COUNTS, type DistrictId } from "../game/session";
import { createBuildingFromArchetype } from "../structure/building";
import type { Building, GroundPatch, Lot, LotIdentity, LotZone, Prop } from "../structure/types";
import { lotZoneFor, pickArchetype } from "./archetypes";
import { getAsset, spawnAsset } from "./catalog";
import { buildingOccupy, dressLot, fillWorldGround, pickTemplate } from "./dressing";
import {
  curvePoints,
  derivedRoadBoxes,
  emptyTerrain,
  linePoints,
  offsetPoint,
  pt,
  RoadBuilder,
  pointOnRoad,
  samplePolyline,
  type RoadNetwork,
  type RoadSegment,
  type TerrainField,
} from "./roads";
import type { Town } from "./town";

export type TopologyFamily = "county" | "crossroads" | "tjunction" | "curve-farm" | "loop" | "frontage";

const LOT_FRONT = 11.4;
const LOT_DEPTH = 10.2;

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
}

export function pickTopology(rng: Rng, count: number): TopologyFamily {
  const families: TopologyFamily[] =
    count >= 80
      ? ["county", "crossroads", "frontage", "curve-farm"]
      : ["county", "crossroads", "tjunction", "curve-farm", "loop", "frontage"];
  return rng.pick(families);
}

export function generateRuralLayout(id: Exclude<DistrictId, "classic">, seed: number): RuralLayout {
  const count = DISTRICT_COUNTS[id];
  const rng = new Rng(seed);
  const topology = pickTopology(rng, count);
  const b = new RoadBuilder();
  const originX = 4;
  const originY = 4;

  buildSkeleton(b, topology, count, originX, originY, rng);
  const network = b.finish();

  const lots = placeLots(network, Math.ceil(count * 1.45) + 6, rng);
  const buildings: Building[] = [];
  const kept: Lot[] = [];
  for (let i = 0; i < lots.length && kept.length < count; i++) {
    const lot = lots[i]!;
    const zone = lot.zone;
    const archetype = pickArchetype(zone, rng);
    const bw = archetype.w * CELL;
    const bd = archetype.d * CELL;
    const inset = 1.15;
    const fx = Math.cos(lot.heading);
    const fy = Math.sin(lot.heading);
    const along = Math.abs(fx) * lot.w + Math.abs(fy) * lot.d;
    const rear = along * 0.2;
    const cx = lot.x + lot.w * 0.5 + fx * rear;
    const cy = lot.y + lot.d * 0.5 + fy * rear;
    let x = cx - bw * 0.5;
    let y = cy - bd * 0.5;
    x = Math.max(lot.x + inset, Math.min(x, lot.x + lot.w - bw - inset));
    y = Math.max(lot.y + inset, Math.min(y, lot.y + lot.d - bd - inset));
    if (pointOnRoad(network, x + bw * 0.5, y + bd * 0.5)) {
      x += fx * 1.8;
      y += fy * 1.8;
    }
    if (pointOnRoad(network, x + bw * 0.5, y + bd * 0.5)) continue;
    if (buildings.some((o) => aabbOverlap(x - 0.4, y - 0.4, bw + 0.8, bd + 0.8, o.x, o.y, o.w * o.cellSize, o.d * o.cellSize))) {
      continue;
    }
    const building = createBuildingFromArchetype(archetype.id, `LOT ${kept.length + 1} ${archetype.label}`, x, y);
    buildings.push(building);
    kept.push(lot);
  }

  const occBoxes = buildings.flatMap(buildingOccupy);
  const props: Prop[] = [];
  const ground: GroundPatch[] = [];
  const lotsKept = kept;
  const perLot = count >= 80 ? 6 : count >= 25 ? 7 : 7;
  for (let i = 0; i < lotsKept.length; i++) {
    const lot = lotsKept[i]!;
    const dressed = dressLot(lot, buildings[i], rng, { boxes: occBoxes }, perLot);
    props.push(...dressed.props);
    ground.push(...dressed.patches);
    for (const p of dressed.props) occBoxes.push({ x: p.x, y: p.y, w: p.w, d: p.d });
  }

  placeRoadside(network, lotsKept, buildings, props, rng, count);
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
  for (const lot of lotsKept) {
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
    lots: lotsKept,
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
  };
}

function buildSkeleton(
  b: RoadBuilder,
  topology: TopologyFamily,
  count: number,
  ox: number,
  oy: number,
  rng: Rng,
): RoadSegment[] {
  const pairPitch = LOT_DEPTH * 2 + 6.4;
  const collectors = Math.max(1, Math.ceil(count / 24));
  const slotsPerSide = Math.ceil(count / (collectors * 2)) + 2;
  const spineLen = Math.max(56, slotsPerSide * LOT_FRONT + 10);
  const branch = Math.max(pairPitch * 0.55, 18 + count * 0.12);

  if (topology === "county") {
    for (let r = 0; r < collectors; r++) {
      const y = oy + 14 + r * pairPitch + rng.range(-1.2, 1.2);
      const elev = r * 0.08;
      const a = b.node(ox, y, elev);
      const m = b.node(ox + spineLen * 0.5, y + rng.range(-2.2, 2.2), elev + 0.1);
      const c = b.node(ox + spineLen, y + rng.range(-1.4, 1.4), elev + 0.2);
      b.segment(a, c, linePoints(pt(a), pt(m)).concat(linePoints(pt(m), pt(c)).slice(1)), { roadClass: "rural" });
    }
    const crosses = Math.max(1, collectors + (count >= 30 ? 2 : 0));
    const main = b.segments[0]!;
    for (let i = 0; i < crosses; i++) {
      const t = 0.16 + (i / Math.max(1, crosses)) * 0.68 + rng.range(-0.02, 0.02);
      const p = samplePolyline(main.points, Math.min(0.9, t));
      const n0 = b.node(p.x, oy + 4, p.elev);
      const n1 = b.node(p.x + rng.range(-1, 1), oy + 14 + (collectors - 1) * pairPitch + branch * 0.35, p.elev);
      b.segment(n0, n1, linePoints(pt(n0), pt(n1)), { roadClass: "residential" });
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
  } else if (topology === "tjunction") {
    const c = b.node(ox + spineLen * 0.4, oy + 16, 0.1);
    const w = b.node(ox, oy + 16, 0);
    const e = b.node(ox + spineLen, oy + 16, 0.2);
    const n = b.node(ox + spineLen * 0.4, oy + 16 + branch, 0.15);
    b.segment(w, c, linePoints(pt(w), pt(c)), { roadClass: "rural" });
    b.segment(c, e, linePoints(pt(c), pt(e)), { roadClass: "rural" });
    b.segment(c, n, linePoints(pt(c), pt(n)), { roadClass: "residential" });
    if (count >= 20) {
      const mid = samplePolyline(b.segments[2]!.points, 0.55);
      const j = b.node(mid.x, mid.y, mid.elev);
      const side = b.node(mid.x + branch * 0.4, mid.y + rng.range(-2, 2), mid.elev);
      b.segment(j, side, linePoints(pt(j), pt(side)), { roadClass: "residential" });
    }
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
  } else if (topology === "loop") {
    const r = Math.max(16, 12 + count * 0.22);
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
    const stem = b.node(cx + r + 14, cy, 0);
    b.segment(nodes[0]!, stem, linePoints(pt(nodes[0]!), pt(stem)), { roadClass: "rural" });
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
      const n0 = b.node(p.x, p.y, p.elev);
      const n1 = b.node(q.x, q.y, q.elev);
      b.segment(n0, n1, linePoints(pt(n0), pt(n1)), { roadClass: "driveway", width: 2.2 });
    }
  }
  return b.segments.filter((s) => s.roadClass !== "driveway");
}

function placeLots(network: RoadNetwork, count: number, rng: Rng): Lot[] {
  const lots: Lot[] = [];
  const eligible = network.segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  const sides: Array<1 | -1> = [1, -1];
  let n = 0;
  for (const seg of eligible) {
    if (n >= count) break;
    let path = 0;
    for (let i = 0; i < seg.points.length - 1; i++) {
      path += len(seg.points[i + 1]!.x - seg.points[i]!.x, seg.points[i + 1]!.y - seg.points[i]!.y);
    }
    const slots = Math.max(1, Math.floor(path / LOT_FRONT));
    for (let i = 0; i < slots && n < count; i++) {
      const t = (i + 0.55) / (slots + 0.2);
      if (t < 0.1 || t > 0.92) continue;
      const p = samplePolyline(seg.points, t);
      const side = sides[(i + (seg.id.charCodeAt(1) ?? 0)) % 2]!;
      const across = (seg.width * 0.5 + seg.shoulder + LOT_DEPTH * 0.5 + 1.55) * side;
      const pos = offsetPoint(p.x, p.y, p.heading, across);
      const heading = p.heading + (side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      const box = lotFootprint(pos.x, pos.y, heading);
      const lot: Lot = {
        id: `lot${n}`,
        x: box.x,
        y: box.y,
        w: box.w,
        d: box.d,
        heading,
        zone: zoneForLot(n, count, seg.roadClass),
        identity: identityFor(n, count, seg.roadClass, rng),
        accessId: "",
        templateId: "",
      };
      if (lots.some((o) => aabbOverlap(lot.x, lot.y, lot.w, lot.d, o.x, o.y, o.w, o.d))) continue;
      if (overlapsRoadCenter(network, lot)) continue;
      const acc = network.accesses.find((a) => a.lotId === lot.id);
      if (!acc) {
        const access = {
          id: `aL${n}`,
          lotId: lot.id,
          segmentId: seg.id,
          laneId: seg.laneIds[0]!,
          t,
          x: p.x,
          y: p.y,
          kind: "driveway" as const,
        };
        network.accesses.push(access);
        lot.accessId = access.id;
      }
      lot.templateId = pickTemplate(lot.identity, rng).id;
      lots.push(lot);
      n++;
    }
  }
  let guard = 0;
  while (lots.length < count && eligible.length && guard < count * 12) {
    guard++;
    const seg = eligible[lots.length % eligible.length]!;
    const t = 0.12 + ((lots.length * 0.137) % 0.76);
    const row = 1 + Math.floor(guard / (eligible.length * 4));
    const p = samplePolyline(seg.points, t);
    const side: 1 | -1 = lots.length % 2 === 0 ? 1 : -1;
    const pos = offsetPoint(
      p.x,
      p.y,
      p.heading,
      (seg.width * 0.5 + seg.shoulder + LOT_DEPTH * (0.52 + row * 0.95) + 1.55) * side,
    );
    const heading = p.heading + (side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    const box = lotFootprint(pos.x + rng.range(-0.4, 0.4), pos.y + rng.range(-0.4, 0.4), heading);
    const lot: Lot = {
      id: `lot${lots.length}`,
      x: box.x,
      y: box.y,
      w: box.w,
      d: box.d,
      heading,
      zone: zoneForLot(lots.length, count, seg.roadClass),
      identity: identityFor(lots.length, count, seg.roadClass, rng),
      accessId: "",
      templateId: "",
    };
    if (lots.some((o) => aabbOverlap(lot.x + 0.2, lot.y + 0.2, lot.w - 0.4, lot.d - 0.4, o.x, o.y, o.w, o.d))) continue;
    const accessId = `aL${lots.length}`;
    network.accesses.push({
      id: accessId,
      lotId: lot.id,
      segmentId: seg.id,
      laneId: seg.laneIds[0]!,
      t,
      x: p.x,
      y: p.y,
      kind: "driveway",
    });
    lot.accessId = accessId;
    lot.templateId = pickTemplate(lot.identity, rng).id;
    lots.push(lot);
  }
  return lots.slice(0, count);
}

function lotFootprint(cx: number, cy: number, heading: number): { x: number; y: number; w: number; d: number } {
  const depthAlongX = Math.abs(Math.cos(heading)) > 0.5;
  const w = depthAlongX ? LOT_DEPTH : LOT_FRONT;
  const d = depthAlongX ? LOT_FRONT : LOT_DEPTH;
  return { x: cx - w * 0.5, y: cy - d * 0.5, w, d };
}

function overlapsRoadCenter(network: RoadNetwork, lot: Lot): boolean {
  const inset = 1.1;
  const box = { x: lot.x + inset, y: lot.y + inset, w: lot.w - inset * 2, d: lot.d - inset * 2 };
  for (const seg of network.segments) {
    if (seg.roadClass === "driveway") continue;
    for (let i = 0; i < seg.points.length - 1; i++) {
      const a = seg.points[i]!;
      const b = seg.points[i + 1]!;
      const mx = (a.x + b.x) * 0.5 - seg.width * 0.35;
      const my = (a.y + b.y) * 0.5 - seg.width * 0.35;
      if (aabbOverlap(box.x, box.y, box.w, box.d, mx, my, seg.width * 0.7, seg.width * 0.7)) return true;
    }
  }
  return false;
}

function zoneForLot(i: number, count: number, roadClass: RoadSegment["roadClass"]): LotZone {
  if (roadClass === "service" || roadClass === "commercial") return i % 3 === 0 ? "industrial" : "commercial";
  if (i === 0) return "commercial";
  if (i >= count - 2) return "industrial";
  return lotZoneFor(Math.floor(i / 4), i % 4, Math.ceil(count / 4), 4);
}

function identityFor(i: number, count: number, roadClass: RoadSegment["roadClass"], rng: Rng): LotIdentity {
  if (roadClass === "service") return rng.chance(0.5) ? "utility" : "contractor";
  if (i === 0 || (roadClass === "rural" && i % 11 === 0)) return "shop";
  if (i % 9 === 3) return "service";
  if (i % 5 === 2 || roadClass === "rural" && i % 4 === 1) return "farm";
  if (i === count - 1) return "utility";
  return "residence";
}

function placeRoadside(
  network: RoadNetwork,
  lots: Lot[],
  buildings: Building[],
  props: Prop[],
  rng: Rng,
  count: number,
): void {
  const occ = [...buildings.flatMap(buildingOccupy), ...lots.map((l) => ({ x: l.x, y: l.y, w: l.w, d: l.d }))];
  for (const p of props) occ.push({ x: p.x, y: p.y, w: p.w, d: p.d });
  const ids = ["stop-sign", "power-pole", "fire-hydrant", "guardrail", "traffic-barrel", "billboard", "light"];
  let placed = 0;
  const cap = Math.min(count + 8, 4 + Math.floor(count * 0.35));
  for (const seg of network.segments) {
    if (seg.roadClass === "driveway") continue;
    const path = Math.max(8, len(seg.points[seg.points.length - 1]!.x - seg.points[0]!.x, seg.points[seg.points.length - 1]!.y - seg.points[0]!.y));
    const n = path > 30 ? 2 : 1;
    for (let i = 0; i < n && placed < cap; i++) {
      const t = 0.18 + i * 0.38 + rng.range(0, 0.08);
      const p = samplePolyline(seg.points, Math.min(0.86, t));
      const side = i % 2 === 0 ? 1 : -1;
      const pos = offsetPoint(p.x, p.y, p.heading, (seg.width * 0.5 + 0.55) * side);
      const id = rng.pick(ids);
      const asset = spawnAsset(id, pos.x - 0.15, pos.y - 0.15, p.heading + (side > 0 ? 0 : Math.PI), rng.int(0, 2));
      if (occ.some((b) => aabbOverlap(asset.x, asset.y, asset.w, asset.d, b.x, b.y, b.w, b.d))) continue;
      props.push(asset);
      occ.push({ x: asset.x, y: asset.y, w: asset.w, d: asset.d });
      placed++;
    }
  }
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
  const pool = segs.length ? segs : network.segments;
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
