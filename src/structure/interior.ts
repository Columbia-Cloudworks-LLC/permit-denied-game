import { FLOOR_Z } from "../game/constants";
import { independentFloors, roomAt } from "./construction";
import { roofCoverage } from "./roof";
import { getAsset } from "../world/catalog";
import { contentFinish } from "../world/contents";
import { debrisKind, type ParticlePool } from "../fx/particles";
import type {
  Building,
  Cell,
  FixtureKind,
  FloorFinish,
  InteriorFixture,
  Material,
  RoomKind,
  WorldEvent,
} from "./types";
import { cellPresent } from "./types";

export function hasFurnishedInterior(building: Building): boolean {
  return !!building.construction?.rooms.length;
}

export function interiorRoomAt(building: Building, gx: number, gy: number, floor = 0): RoomKind {
  return roomAt(building, gx, gy, floor)?.kind ?? "living";
}
export type FixtureFinish = "wood" | "ceramic" | "metal";
export function fixtureCatalog(kind: FixtureKind) {
  return { ...getAsset(`interior-${kind}`), finish: contentFinish(kind) };
}
function interiorFloorFinish(building: Building, gx: number, gy: number, floor = 0): FloorFinish {
  return roomAt(building, gx, gy, floor)?.finish ?? "plank";
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
      const cell = building.grid[floor]?.[gx]?.[gy];
      if (independentFloors(building) ? building.floorTiles?.some(t => t.floor === floor && t.gx === gx && t.gy === gy) : cell && cell.state !== "gone") out.push({ gx, gy });
    }
  }
  if (out.length === 0) {
    out.push({
      gx: Math.max(0, Math.min(building.w - 1, gx0)),
      gy: Math.max(0, Math.min(building.d - 1, gy0)),
    });
  }
  return out;
}

function makeFixture(
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
): InteriorFixture {
  const def = fixtureCatalog(kind);
  return {
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
    heading: 0,
    material: def.material,
    hp: def.hp,
    maxHp: def.hp,
    broken: false,
  };
}

export function generateInteriors(building: Building): InteriorFixture[] {
  const fixtures: InteriorFixture[] = [];
  const bw = building.w * building.cellSize, bd = building.d * building.cellSize;
  for (const room of building.construction?.rooms ?? []) {
    if (room.floor >= building.floors) continue;
    for (const slot of room.contents) {
      const x = building.x + (room.x + slot.x * room.w) * bw;
      const y = building.y + (room.y + slot.y * room.d) * bd;
      const w = slot.w * room.w * bw, d = slot.d * room.d * bd;
      // Invalid/overlapping recipes fail closed instead of putting blockers outside the lot.
      if (w <= 0 || d <= 0 || x < building.x || y < building.y || x + w > building.x + bw + 1e-6 || y + d > building.y + bd + 1e-6) continue;
      if (fixtures.some(f => f.floor === room.floor && f.x < x + w && f.x + f.w > x && f.y < y + d && f.y + f.d > y)) continue;
      fixtures.push(makeFixture(building, fixtures.length + 1, slot.kind, room.kind, room.floor, x, y, w, d, slot.h));
    }
  }
  if (building.construction?.partitions) {
    const rooms = building.construction.rooms.filter(r => r.floor < building.floors);
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!, b = rooms[j]!;
      if (a.floor !== b.floor) continue;
      const vertical = Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6;
      const horizontal = Math.abs(a.y + a.d - b.y) < 1e-6 || Math.abs(b.y + b.d - a.y) < 1e-6;
      if (!vertical && !horizontal) continue;
      const start = vertical ? Math.max(a.y, b.y) * bd : Math.max(a.x, b.x) * bw;
      const end = vertical ? Math.min(a.y + a.d, b.y + b.d) * bd : Math.min(a.x + a.w, b.x + b.w) * bw;
      if (end - start < 1.1) continue;
      const plane = vertical ? Math.max(a.x, b.x) * bw : Math.max(a.y, b.y) * bd;
      const mid = (start + end) / 2, doorHalf = .48;
      for (const [lo, hi] of [[start + .12, mid - doorHalf], [mid + doorHalf, end - .12]]) {
        if (hi! - lo! < .15) continue;
        const x = building.x + (vertical ? plane - .05 : lo!);
        const y = building.y + (vertical ? lo! : plane - .05);
        fixtures.push(makeFixture(building, fixtures.length + 1, "partition", a.kind, a.floor, x, y,
          vertical ? .1 : hi! - lo!, vertical ? hi! - lo! : .1, FLOOR_Z * .8));
      }
    }
  }
  return fixtures;
}

export function fixtureWorldBox(fixture: InteriorFixture): { x: number; y: number; w: number; d: number } {
  return { x: fixture.x, y: fixture.y, w: fixture.w, d: fixture.d };
}

export function cellHasFloor(cell: Cell | undefined): boolean {
  return !!cell && (cellPresent(cell) || cell.state === "breached");
}

export interface InteriorFloorSpan {
  floor: number;
  gx0: number;
  gx1: number;
  gy0: number;
  gy1: number;
  finish: FloorFinish;
}

/** In-building neighbor is missing or no longer a solid wall/floor. Exterior edges do not count. */
export function inBuildingNeighborOpen(
  building: Building,
  gx: number,
  gy: number,
  floor: number,
): boolean {
  if (gx < 0 || gy < 0 || gx >= building.w || gy >= building.d) return false;
  const cell = building.grid[floor]?.[gx]?.[gy];
  return !cell || !cellPresent(cell);
}

function exposedFinish(building: Building, gx: number, gy: number, floor: number): FloorFinish | null {
  if (!cellInteriorExposed(building, gx, gy, floor)) return null;
  return interiorFloorFinish(building, gx, gy, floor);
}

/** Envelope cells are the original walls/columns. Interior voids start gone and are not openings. */
function envelopeOpen(building: Building, gx: number, gy: number, floor: number): boolean {
  if (gx !== 0 && gy !== 0 && gx !== building.w - 1 && gy !== building.d - 1) return false;
  const cell = building.grid[floor]?.[gx]?.[gy];
  return !cell || cell.state === "breached" || !cellPresent(cell);
}

function markIndependentFloorTiles(
  building: Building,
  floor: number,
  marks: (FloorFinish | null)[],
  reveal: boolean,
): void {
  const w = building.w;
  const tiles = (building.floorTiles ?? []).filter((t) => t.floor === floor && t.state === "intact");
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
  if (floor !== building.floors - 1) return;
  for (const tile of tiles) {
    if (marks[tile.gy * w + tile.gx] || roofCoversCell(building, tile.gx, tile.gy)) continue;
    marks[tile.gy * w + tile.gx] = finishAt(tile.gx, tile.gy);
  }
}

function floorMarkFinish(marks: (FloorFinish | null)[], w: number, gx: number, gy: number): FloorFinish | null {
  return marks[gy * w + gx] ?? null;
}

function southFacadeOpen(building: Building, gx: number, floor: number): boolean {
  return inBuildingNeighborOpen(building, gx, building.d - 1, floor);
}

/** Hole columns filled south-to-north so the slab meets surviving wing walls. */
function fillOpeningCorridor(building: Building, floor: number, marks: (FloorFinish | null)[]): void {
  const w = building.w;
  for (let gx = 0; gx < w; gx++) {
    if (!southFacadeOpen(building, gx, floor)) continue;
    for (let gy = building.d - 1; gy >= 0; gy--) {
      const idx = gy * w + gx;
      const cell = building.grid[floor]?.[gx]?.[gy];
      if (cell && cellPresent(cell) && !inBuildingNeighborOpen(building, gx, gy + 1, floor) && gy < building.d - 1) {
        break;
      }
      marks[idx] = interiorFloorFinish(building, gx, gy, floor);
    }
  }
}

/** Exposed floors plus the south-opening corridor, so a hole is not a grass ring. */
function interiorFloorMarks(building: Building, floor: number, reveal = false): (FloorFinish | null)[] {
  const w = building.w;
  const marks: (FloorFinish | null)[] = new Array(w * building.d).fill(null);
  if (independentFloors(building)) {
    markIndependentFloorTiles(building, floor, marks, reveal);
    return marks;
  }
  const stack: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < building.d; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const finish = reveal && cellHasFloor(building.grid[floor]?.[gx]?.[gy]) ? interiorFloorFinish(building, gx, gy, floor) : exposedFinish(building, gx, gy, floor);
      if (!finish) continue;
      marks[gy * w + gx] = finish;
      stack.push({ gx, gy });
    }
  }
  fillOpeningCorridor(building, floor, marks);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  while (stack.length) {
    const cur = stack.pop()!;
    const finish = marks[cur.gy * w + cur.gx]!;
    for (const [dx, dy] of dirs) {
      const gx = cur.gx + dx;
      const gy = cur.gy + dy;
      if (gx < 0 || gy < 0 || gx >= w || gy >= building.d) continue;
      const idx = gy * w + gx;
      if (marks[idx]) continue;
      const cell = building.grid[floor]?.[gx]?.[gy];
      if (!cell || (cell.state !== "gone" && cell.state !== "falling")) continue;
      if (interiorFloorFinish(building, gx, gy, floor) !== finish) continue;
      marks[idx] = finish;
      stack.push({ gx, gy });
    }
  }
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
  const parts: string[] = [`${building.w}:${building.d}:${building.floors}`];
  for (const tile of building.floorTiles ?? []) parts.push(`f${tile.floor}:${tile.gx}:${tile.gy}:${tile.state}`);
  for (const cell of building.cells) {
    parts.push(`${cell.gx},${cell.gy},${cell.floor},${cell.state},${cell.cladding?.hp ?? -1}`);
  }
  for (const roof of building.roofs) {
    parts.push(`r${roof.id}:${roof.state}`);
  }
  return parts.join("|");
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

export interface InteriorFloorCoverage {
  spans: InteriorFloorSpan[];
  hasFloor: (gx: number, gy: number, floor: number) => boolean;
}

export function interiorFloorCoverage(building: Building, reveal = false): InteriorFloorCoverage {
  if (!hasFurnishedInterior(building)) {
    return { spans: [], hasFloor: () => false };
  }
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
  if (independentFloors(building)) return fixture.support.some(s => building.floorTiles?.some(t => t.floor === fixture.floor && t.gx === s.gx && t.gy === s.gy && t.state === "intact"));
  return fixture.support.some((s) => cellHasFloor(building.grid[fixture.floor]?.[s.gx]?.[s.gy]));
}

function roofCoversCell(building: Building, gx: number, gy: number): boolean {
  const top = building.floors - 1;
  return building.roofs.some(
    (roof) =>
      roof.state !== "gone" &&
      roof.state !== "falling" &&
      roofCoverage(roof).some((s) => s.gx === gx && s.gy === gy) &&
      roof.support.every((s) => {
        const cell = building.grid[top]?.[s.gx]?.[s.gy];
        return cell && cellPresent(cell);
      }),
  );
}

export function cellInteriorExposed(building: Building, gx: number, gy: number, floor: number): boolean {
  const cell = building.grid[floor]?.[gx]?.[gy];
  if (!cell || cell.state === "gone" || cell.state === "falling") return false;
  if (cell.state === "breached") return true;
  if (inBuildingNeighborOpen(building, gx, gy + 1, floor)) return true;
  if (floor === building.floors - 1 && !roofCoversCell(building, gx, gy)) return true;
  return false;
}

export function fixtureExposed(building: Building, fixture: InteriorFixture): boolean {
  if (fixture.broken && !fixtureSupported(building, fixture)) return false;
  if (independentFloors(building)) {
    return fixture.support.some((s) => interiorFloorCoverage(building).hasFloor(s.gx, s.gy, fixture.floor));
  }
  return fixture.support.some((s) => cellInteriorExposed(building, s.gx, s.gy, fixture.floor));
}

/** Intact furnishings still block the blade. Broken remnants do not. */
export function fixtureSolid(building: Building, fixture: InteriorFixture): boolean {
  return fixture.floor === 0 && !fixture.broken && fixtureExposed(building, fixture);
}

export interface FixtureFrag {
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
  fixture.hp = 0;
  building.collisionDirty = true;
  building.structureDirty = true;
  const cx = fixture.x + fixture.w * 0.5;
  const cy = fixture.y + fixture.d * 0.5;
  const cash = fixtureCatalog(fixture.kind).cash;
  particles.burst(debrisKind(fixture.material), cx, cy, fixture.floor * FLOOR_Z + 0.45, 0.55);
  events.push({ kind: "snap", x: cx, y: cy, z: 0.5, mag: 0.35, material: fixture.material, cash });
  const dir = Math.hypot(nx, ny) || 1;
  const fx = nx / dir;
  const fy = ny / dir;
  const def = fixtureCatalog(fixture.kind);
  const count = def.debris.fragments + def.debris.remnants;
  const frags: FixtureFrag[] = Array.from({ length: count }, (_, i) => ({
    x: cx + fx * (i - .5) * .16, y: cy + fy * (i - .5) * .16,
    w: Math.max(.12, fixture.w * (i === 0 ? def.debris.remnantScale : .22)),
    d: Math.max(.1, fixture.d * (i === 0 ? def.debris.remnantScale : .22)),
    material: fixture.material, vx: fx * (1 + i * .2), vy: fy * (1 + i * .2),
    elev: fixture.floor * FLOOR_Z + .15,
    mass: def.mass / count,
    shape: def.debris.shape,
    layer: i < def.debris.remnants ? "remnant" : "fragment",
  }));
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
  fixture.hp = Math.max(0, fixture.hp - amount);
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
    const roofImpact = independentFloors(building) && fixture.floor === building.floors - 1 && building.roofs.some(r => r.state === "gone" && roofCoverage(r).some(c => fixture.support.some(s => s.gx === c.gx && s.gy === c.gy)));
    const floorImpact = independentFloors(building) && building.floorTiles?.some(t => t.floor === fixture.floor + 1 && t.state === "gone" && fixture.support.some(s => s.gx === t.gx && s.gy === t.gy));
    if (fixtureSupported(building, fixture) && !roofImpact && !floorImpact) continue;
    const out = breakFixture(building, fixture, particles, events, 0.2, 0.4);
    cash += out.cash;
    frags.push(...out.frags);
  }
  return { cash, frags };
}
