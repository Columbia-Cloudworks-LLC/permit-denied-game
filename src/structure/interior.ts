import { hitObject, objectFragments } from '../sim/objectBehavior';
import { FLOOR_Z } from "../game/constants";
import { roomAt, sharedRoomEdge } from "./construction";
import { roofCoverage } from "./roof";
import { getAsset } from "../world/catalog";
import { contentFinish } from "../world/contents";
import { debrisKind, type ParticlePool } from "../fx/particles";
import type {
  Building,
  FixtureKind,
  FloorFinish,
  InteriorFixture,
  Material,
  RoomKind,
  WorldEvent,
} from "./types";
import { cellPresent } from "./types";

export function interiorRoomAt(building: Building, gx: number, gy: number, floor = 0): RoomKind {
  const room = roomAt(building, gx, gy, floor);
  if (!room) throw new Error(`No room at ${floor}:${gx},${gy}`);
  return room.kind;
}
export type FixtureFinish = "wood" | "ceramic" | "metal";
export function fixtureCatalog(kind: FixtureKind) {
  return { ...getAsset(`interior-${kind}`), finish: contentFinish(kind) };
}
function interiorFloorFinish(building: Building, gx: number, gy: number, floor = 0): FloorFinish {
  const room = roomAt(building, gx, gy, floor);
  if (!room) throw new Error(`No room at ${floor}:${gx},${gy}`);
  return room.finish;
}

function cellsCovered(
  building: Building,
  x: number,
  y: number,
  w: number,
  d: number,
  floor: number,
): { gx: number; gy: number }[] {
  const cs = building.cellSize;
  const gx0 = Math.max(0, Math.floor((x - building.x) / cs));
  const gy0 = Math.max(0, Math.floor((y - building.y) / cs));
  const gx1 = Math.min(building.w - 1, Math.floor((x + w - 0.02 - building.x) / cs));
  const gy1 = Math.min(building.d - 1, Math.floor((y + d - 0.02 - building.y) / cs));
  const out: { gx: number; gy: number }[] = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      if (building.floorTiles.some(t => t.floor === floor && t.gx === gx && t.gy === gy)) out.push({ gx, gy });
    }
  }
  if (out.length === 0) throw new Error("Object has no supporting floor");
  return out;
}

export function makeFixture(
  building: Building,
  id: number,
  kind: FixtureKind,
  room: RoomKind,
  floor: number,
  x: number,
  y: number,
  w: number,
  d: number,
  h: number,
  roomId = building.layout.rooms.find(r => r.floor === floor && r.kind === room)?.id,
  placementId = `fixture-${id}`,
  rotation = 0,
): InteriorFixture {
  const def = fixtureCatalog(kind);
  if (!roomId) throw new Error("Object must reference an existing room");
  return {
    roomId, placementId,
    pose: { lean: 0, leanX: 0, leanY: 0, crush: 0, roll: 0 },
    id,
    kind,
    room,
    floor,
    support: cellsCovered(building, x, y, w, d, floor),
    x,
    y,
    w,
    d,
    h,
    heading: rotation * Math.PI / 180,
    material: def.material,
    hp: def.hp,
    maxHp: def.hp,
    broken: false,
  };
}

export function generateInteriors(building: Building): InteriorFixture[] {
  const fixtures: InteriorFixture[] = [];
  const bw = building.w * building.cellSize, bd = building.d * building.cellSize;
  for (const room of building.layout.rooms) {
    for (const slot of room.contents) {
      const x = building.x + (room.x + slot.x * room.w) * bw;
      const y = building.y + (room.y + slot.y * room.d) * bd;
      const w = slot.w * room.w * bw, d = slot.d * room.d * bd;
      fixtures.push(makeFixture(building, fixtures.length + 1, slot.kind, room.kind, room.floor, x, y, w, d, slot.h, room.id, slot.id, slot.rotation));
    }
  }
  if (building.layout.partitions) {
    const rooms = building.layout.rooms.filter(r => r.floor < building.floors);
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!, b = rooms[j]!;
      const edge = sharedRoomEdge(a, b);
      if (!edge) continue;
      const { vertical } = edge;
      const start = edge.start * (vertical ? bd : bw), end = edge.end * (vertical ? bd : bw);
      const plane = edge.plane * (vertical ? bw : bd);
      const door = building.layout.connections?.find(c => c.a === a.id && c.b === b.id || c.a === b.id && c.b === a.id);
      const mid = start + (end - start) * (door?.at ?? .5), doorHalf = (end - start) * (door?.width ?? 0) / 2;
      const segments = door ? [[start, mid - doorHalf], [mid + doorHalf, end]] : [[start, end]];
      for (const [lo, hi] of segments) {
        if (hi! - lo! < .01) continue;
        const x = building.x + (vertical ? plane - .05 : lo!);
        const y = building.y + (vertical ? lo! : plane - .05);
        fixtures.push(makeFixture(building, fixtures.length + 1, "partition", a.kind, a.floor, x, y,
          vertical ? .1 : hi! - lo!, vertical ? hi! - lo! : .1, FLOOR_Z * .8, a.id, `partition-${a.id}-${b.id}-${lo}`));
      }
    }
  }
  return fixtures;
}

export function fixtureWorldBox(fixture: InteriorFixture): { x: number; y: number; w: number; d: number } {
  return { x: fixture.x, y: fixture.y, w: fixture.w, d: fixture.d };
}

export interface InteriorFloorSpan {
  floor: number;
  gx0: number;
  gx1: number;
  gy0: number;
  gy1: number;
  finish: FloorFinish;
}

/** Envelope cells are the original walls/columns. Interior voids start gone and are not openings. */
function envelopeOpen(building: Building, gx: number, gy: number, floor: number): boolean {
  const cell = building.grid[floor]?.[gx]?.[gy];
  return !!cell && Object.values(cell.exterior).some(Boolean) && (cell.state === "breached" || !cellPresent(cell) || cell.cladding?.hp === 0);
}

function markIndependentFloorTiles(
  building: Building,
  floor: number,
  marks: (FloorFinish | null)[],
  reveal: boolean,
): void {
  const w = building.w;
  const tiles = (building.floorTiles).filter((t) => t.floor === floor && t.state === "intact");
  const finishAt = (gx: number, gy: number) => interiorFloorFinish(building, gx, gy, floor);
  if (reveal) {
    for (const tile of tiles) marks[tile.gy * w + tile.gx] = finishAt(tile.gx, tile.gy);
    return;
  }
  const have = new Set(tiles.map((t) => `${t.gx},${t.gy}`));
  const stack: { gx: number; gy: number }[] = [];
  for (const tile of tiles) {
    if (!envelopeOpen(building, tile.gx, tile.gy, floor)) continue;
    marks[tile.gy * w + tile.gx] = finishAt(tile.gx, tile.gy);
    stack.push(tile);
  }
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  while (stack.length) {
    const cur = stack.pop()!;
    for (const [dx, dy] of dirs) {
      const gx = cur.gx + dx;
      const gy = cur.gy + dy;
      if (!have.has(`${gx},${gy}`) || marks[gy * w + gx]) continue;
      marks[gy * w + gx] = finishAt(gx, gy);
      stack.push({ gx, gy });
    }
  }
  for (const tile of tiles) {
    if (marks[tile.gy * w + tile.gx] || building.floorTiles.some(t => t.floor > floor && t.gx === tile.gx && t.gy === tile.gy && t.state !== 'gone') || roofCoversCell(building, tile.gx, tile.gy, floor)) continue;
    marks[tile.gy * w + tile.gx] = finishAt(tile.gx, tile.gy);
  }
}

function floorMarkFinish(marks: (FloorFinish | null)[], w: number, gx: number, gy: number): FloorFinish | null {
  return marks[gy * w + gx] ?? null;
}

function interiorFloorMarks(building: Building, floor: number, reveal = false): (FloorFinish | null)[] {
  const marks: (FloorFinish | null)[] = new Array(building.w * building.d).fill(null);
  markIndependentFloorTiles(building, floor, marks, reveal);
  return marks;
}

function markedRowMatches(
  marks: (FloorFinish | null)[],
  w: number,
  gx0: number,
  gx1: number,
  gy: number,
  finish: FloorFinish,
  used: boolean[],
): boolean {
  for (let gx = gx0; gx <= gx1; gx++) {
    if (used[gy * w + gx]) return false;
    if (floorMarkFinish(marks, w, gx, gy) !== finish) return false;
  }
  return true;
}

function interiorFloorSignature(building: Building): string {
  return String(building.visualRevision);
}

function coverIndex(building: Building, gx: number, gy: number, floor: number): number {
  return floor * building.w * building.d + gy * building.w + gx;
}

function collectInteriorFloorSpans(building: Building, reveal = false): InteriorFloorSpan[] {
  const spans: InteriorFloorSpan[] = [];
  for (let floor = 0; floor < building.floors; floor++) {
    const marks = interiorFloorMarks(building, floor, reveal);
    const used = new Array(building.w * building.d).fill(false);
    for (let gy = 0; gy < building.d; gy++) {
      for (let gx = 0; gx < building.w; gx++) {
        const idx = gy * building.w + gx;
        if (used[idx]) continue;
        const finish = marks[idx];
        if (!finish) continue;
        let gx1 = gx;
        while (gx1 + 1 < building.w && !used[gy * building.w + gx1 + 1] && marks[gy * building.w + gx1 + 1] === finish) {
          gx1++;
        }
        let gy1 = gy;
        while (gy1 + 1 < building.d && markedRowMatches(marks, building.w, gx, gx1, gy1 + 1, finish, used)) {
          gy1++;
        }
        for (let yy = gy; yy <= gy1; yy++) {
          for (let xx = gx; xx <= gx1; xx++) used[yy * building.w + xx] = true;
        }
        spans.push({ floor, gx0: gx, gx1, gy0: gy, gy1, finish });
      }
    }
  }
  return spans;
}

interface InteriorFloorCache {
  sig: string;
  spans: InteriorFloorSpan[];
  cover: Uint8Array;
}

const interiorFloorCache = new WeakMap<Building, InteriorFloorCache>();
const inspectionFloorCache = new WeakMap<Building, InteriorFloorCache>();

export function releaseInteriorCache(building: Building): void {
  interiorFloorCache.delete(building);
  inspectionFloorCache.delete(building);
}

export interface InteriorFloorCoverage {
  spans: InteriorFloorSpan[];
  hasFloor: (gx: number, gy: number, floor: number) => boolean;
}

export function interiorFloorCoverage(building: Building, reveal = false): InteriorFloorCoverage {
  const sig = interiorFloorSignature(building);
  const cache = reveal ? inspectionFloorCache : interiorFloorCache;
  let entry = cache.get(building);
  if (!entry || entry.sig !== sig) {
    const spans = collectInteriorFloorSpans(building, reveal);
    const cover = new Uint8Array(building.floors * building.w * building.d);
    for (const span of spans) {
      for (let gy = span.gy0; gy <= span.gy1; gy++) {
        for (let gx = span.gx0; gx <= span.gx1; gx++) {
          cover[coverIndex(building, gx, gy, span.floor)] = 1;
        }
      }
    }
    entry = { sig, spans, cover };
    cache.set(building, entry);
  }
  return {
    spans: entry.spans,
    hasFloor: (gx, gy, floor) => {
      if (gx < 0 || gy < 0 || floor < 0 || gx >= building.w || gy >= building.d || floor >= building.floors) {
        return false;
      }
      return entry.cover[coverIndex(building, gx, gy, floor)] === 1;
    },
  };
}

/** Adjacent exposed cells of the same finish become one rectangle so floors share an edge. */
export function cellDrawsInteriorFloor(building: Building, gx: number, gy: number, floor: number): boolean {
  return interiorFloorCoverage(building).hasFloor(gx, gy, floor);
}

export function interiorFloorSpans(building: Building): InteriorFloorSpan[] {
  return interiorFloorCoverage(building).spans;
}

export function fixtureSupported(building: Building, fixture: InteriorFixture): boolean {
  return fixture.support.some(s => building.floorTiles.some(t => t.floor === fixture.floor && t.gx === s.gx && t.gy === s.gy && t.state === "intact"));
}

function roofCoversCell(building: Building, gx: number, gy: number, floor: number): boolean {
  return building.roofs.some(
    (roof) =>
      roof.floor >= floor && roof.state !== "gone" &&
      roof.state !== "falling" &&
      roofCoverage(roof).some((s) => s.gx === gx && s.gy === gy) &&
      roof.support.every((s) => {
        const cell = building.grid[roof.floor]?.[s.gx]?.[s.gy];
        return cell && cellPresent(cell);
      }),
  );
}

export function fixtureExposed(building: Building, fixture: InteriorFixture): boolean {
  if (fixture.broken && !fixtureSupported(building, fixture)) return false;
  const coverage = interiorFloorCoverage(building);
  return fixture.support.some(s => coverage.hasFloor(s.gx, s.gy, fixture.floor));
}

/** Intact furnishings still block the blade. Broken remnants do not. */
export function fixtureSolid(building: Building, fixture: InteriorFixture, coverage?: InteriorFloorCoverage): boolean {
  if (fixture.floor !== 0 || fixture.broken) return false;
  const floors = coverage ?? interiorFloorCoverage(building);
  return fixture.support.some(s => floors.hasFloor(s.gx, s.gy, fixture.floor));
}

export interface FixtureFrag {
  pileMass?: number;
  elev: number;
  mass: number;
  shape: import("./types").DebrisShape;
  layer: import("./types").DebrisLayer;
  x: number;
  y: number;
  w: number;
  d: number;
  material: Material;
  vx: number;
  vy: number;
}

function breakFixture(
  building: Building,
  fixture: InteriorFixture,
  particles: ParticlePool,
  events: WorldEvent[],
  nx = 0,
  ny = 1,
): { cash: number; frags: FixtureFrag[] } {
  if (fixture.broken) return { cash: 0, frags: [] };
  fixture.broken = true;
  building.visualRevision++;
  fixture.hp = 0;
  building.collisionDirty = true;
  building.structureDirty = true;
  const cx = fixture.x + fixture.w * 0.5;
  const cy = fixture.y + fixture.d * 0.5;
  const cash = fixtureCatalog(fixture.kind).cash;
  particles.burst(debrisKind(fixture.material), cx, cy, fixture.floor * FLOOR_Z + 0.45, 0.55);
  events.push({ kind: "snap", x: cx, y: cy, z: 0.5, mag: 0.35, material: fixture.material, cash });
  const def = fixtureCatalog(fixture.kind);
  const frags: FixtureFrag[] = objectFragments(def, { ...fixture, elev: fixture.floor * FLOOR_Z + .15 }, nx, ny);
  return { cash, frags };

}

export function applyFixtureDamage(
  building: Building,
  fixture: InteriorFixture,
  amount: number,
  nx: number,
  ny: number,
  particles: ParticlePool,
  events: WorldEvent[],
): { cash: number; frags: FixtureFrag[] } {
  if (amount <= 0 || fixture.broken) return { cash: 0, frags: [] };
  building.visualRevision++;
  hitObject(fixture, fixtureCatalog(fixture.kind), amount, nx, ny);
  if (fixture.hp > 0) return { cash: 0, frags: [] };
  return breakFixture(building, fixture, particles, events, nx, ny);
}

export function stepInteriors(
  building: Building,
  particles: ParticlePool,
  events: WorldEvent[],
): { cash: number; frags: FixtureFrag[] } {
  let cash = 0;
  const frags: FixtureFrag[] = [];
  if (building.fixtures.length === 0) return { cash, frags };
  for (const fixture of building.fixtures) {
    if (fixture.broken) {
      if (!fixtureSupported(building, fixture)) {
        fixture.hp = 0;
      }
      continue;
    }
    const roofImpact = building.roofs.some(r => r.floor >= fixture.floor && r.state === "gone" && roofCoverage(r).some(c => fixture.support.some(s => s.gx === c.gx && s.gy === c.gy)));
    const floorImpact = building.floorTiles.some(t => t.floor === fixture.floor + 1 && t.state === "gone" && fixture.support.some(s => s.gx === t.gx && s.gy === t.gy));
    if (fixtureSupported(building, fixture) && !roofImpact && !floorImpact) continue;
    const out = breakFixture(building, fixture, particles, events, 0.2, 0.4);
    cash += out.cash;
    frags.push(...out.frags);
  }
  return { cash, frags };
}
