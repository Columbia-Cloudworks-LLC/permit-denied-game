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
  return building.archetypeId === "ranch";
}

export function ranchRoomAt(building: Building, gx: number, _gy: number): RoomKind {
  if (gx <= 1) return "kitchen";
  if (gx >= building.w - 1) return "bathroom";
  return "living";
}

export type FixtureFinish = "wood" | "ceramic" | "metal";

interface FixtureCatalogEntry {
  material: Material;
  hp: number;
  cash: number;
  finish: FixtureFinish;
}

/** Immutable per-kind stats. Placement and support stay on the building instance. */
const FIXTURE_CATALOG: Record<FixtureKind, FixtureCatalogEntry> = {
  cabinet: { material: "wood", hp: 10, cash: 6, finish: "wood" },
  counter: { material: "wood", hp: 14, cash: 6, finish: "wood" },
  toilet: { material: "concrete", hp: 8, cash: 6, finish: "ceramic" },
  sofa: { material: "wood", hp: 12, cash: 6, finish: "wood" },
  table: { material: "wood", hp: 8, cash: 6, finish: "wood" },
  radiator: { material: "metal", hp: 16, cash: 10, finish: "metal" },
};

export function fixtureCatalog(kind: FixtureKind): FixtureCatalogEntry {
  return FIXTURE_CATALOG[kind];
}

function ranchFloorFinish(building: Building, gx: number, gy: number): FloorFinish {
  const room = ranchRoomAt(building, gx, gy);
  switch (room) {
    case "kitchen":
      return "linoleum";
    case "bathroom":
      return "tile";
    case "living":
      return "plank";
    default: {
      const _never: never = room;
      return _never;
    }
  }
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
      if (cell && cell.state !== "gone") out.push({ gx, gy });
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
  if (!hasFurnishedInterior(building)) return [];
  const cs = building.cellSize;
  const x = building.x;
  const y = building.y;
  const fixtures: InteriorFixture[] = [];
  let id = 1;

  fixtures.push(
    makeFixture(building, id++, "counter", "kitchen", 0, x + 0.08, y + 0.07, cs * 2 - 0.16, 0.34, 0.4),
  );
  fixtures.push(
    makeFixture(building, id++, "cabinet", "kitchen", 0, x + 0.07, y + cs * 0.95, 0.3, cs * 0.85, 0.82),
  );
  fixtures.push(
    makeFixture(building, id++, "table", "kitchen", 0, x + cs * 1.18, y + cs * 1.12, 0.52, 0.48, 0.36),
  );

  fixtures.push(
    makeFixture(building, id++, "sofa", "living", 0, x + cs * 2.08, y + 0.08, cs * 1.78, 0.4, 0.38),
  );
  fixtures.push(
    makeFixture(building, id++, "table", "living", 0, x + cs * 2.42, y + cs * 1.18, 0.68, 0.46, 0.22),
  );
  fixtures.push(
    makeFixture(building, id++, "radiator", "living", 0, x + cs * 3.28, y + cs * 2.78, 0.52, 0.16, 0.3),
  );

  fixtures.push(
    makeFixture(building, id++, "toilet", "bathroom", 0, x + cs * 4.32, y + 0.14, 0.36, 0.4, 0.4),
  );
  fixtures.push(
    makeFixture(building, id++, "cabinet", "bathroom", 0, x + cs * 4.72, y + cs * 1.05, 0.28, 0.48, 0.68),
  );

  return fixtures;
}

export function fixtureWorldBox(fixture: InteriorFixture): { x: number; y: number; w: number; d: number } {
  return { x: fixture.x, y: fixture.y, w: fixture.w, d: fixture.d };
}

export function cellHasFloor(cell: Cell | undefined): boolean {
  return !!cell && (cellPresent(cell) || cell.state === "breached");
}

export interface RanchFloorSpan {
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
  return ranchFloorFinish(building, gx, gy);
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
      marks[idx] = ranchFloorFinish(building, gx, gy);
    }
  }
}

/** Exposed floors plus the south-opening corridor, so a hole is not a grass ring. */
function ranchFloorMarks(building: Building, floor: number): (FloorFinish | null)[] {
  const w = building.w;
  const marks: (FloorFinish | null)[] = new Array(w * building.d).fill(null);
  const stack: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < building.d; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const finish = exposedFinish(building, gx, gy, floor);
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
      if (ranchFloorFinish(building, gx, gy) !== finish) continue;
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

function ranchFloorSignature(building: Building): string {
  const parts: string[] = [`${building.w}:${building.d}:${building.floors}`];
  for (const cell of building.cells) {
    parts.push(`${cell.gx},${cell.gy},${cell.floor},${cell.state}`);
  }
  for (const roof of building.roofs) {
    parts.push(`r${roof.id}:${roof.state}`);
  }
  return parts.join("|");
}

function coverIndex(building: Building, gx: number, gy: number, floor: number): number {
  return floor * building.w * building.d + gy * building.w + gx;
}

function collectRanchFloorSpans(building: Building): RanchFloorSpan[] {
  const spans: RanchFloorSpan[] = [];
  for (let floor = 0; floor < building.floors; floor++) {
    const marks = ranchFloorMarks(building, floor);
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

interface RanchFloorCache {
  sig: string;
  spans: RanchFloorSpan[];
  cover: Uint8Array;
}

const ranchFloorCache = new WeakMap<Building, RanchFloorCache>();

export interface RanchFloorCoverage {
  spans: RanchFloorSpan[];
  hasFloor: (gx: number, gy: number, floor: number) => boolean;
}

export function ranchFloorCoverage(building: Building): RanchFloorCoverage {
  if (!hasFurnishedInterior(building)) {
    return { spans: [], hasFloor: () => false };
  }
  const sig = ranchFloorSignature(building);
  let entry = ranchFloorCache.get(building);
  if (!entry || entry.sig !== sig) {
    const spans = collectRanchFloorSpans(building);
    const cover = new Uint8Array(building.floors * building.w * building.d);
    for (const span of spans) {
      for (let gy = span.gy0; gy <= span.gy1; gy++) {
        for (let gx = span.gx0; gx <= span.gx1; gx++) {
          cover[coverIndex(building, gx, gy, span.floor)] = 1;
        }
      }
    }
    entry = { sig, spans, cover };
    ranchFloorCache.set(building, entry);
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
export function cellDrawsRanchFloor(building: Building, gx: number, gy: number, floor: number): boolean {
  return ranchFloorCoverage(building).hasFloor(gx, gy, floor);
}

export function ranchFloorSpans(building: Building): RanchFloorSpan[] {
  return ranchFloorCoverage(building).spans;
}

export function fixtureSupported(building: Building, fixture: InteriorFixture): boolean {
  return fixture.support.some((s) => cellHasFloor(building.grid[fixture.floor]?.[s.gx]?.[s.gy]));
}

function roofCoversCell(building: Building, gx: number, gy: number): boolean {
  const top = building.floors - 1;
  return building.roofs.some(
    (roof) =>
      roof.state !== "gone" &&
      roof.state !== "falling" &&
      roof.support.some((s) => s.gx === gx && s.gy === gy) &&
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
  return fixture.support.some((s) => cellInteriorExposed(building, s.gx, s.gy, fixture.floor));
}

/** Intact furnishings still block the blade. Broken remnants do not. */
export function fixtureSolid(building: Building, fixture: InteriorFixture): boolean {
  return !fixture.broken && fixtureExposed(building, fixture);
}

export interface FixtureFrag {
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
  particles.burst(debrisKind(fixture.material), cx, cy, fixture.floor * 2.35 + 0.45, 0.55);
  events.push({ kind: "snap", x: cx, y: cy, z: 0.5, mag: 0.35, material: fixture.material, cash });
  const dir = Math.hypot(nx, ny) || 1;
  const fx = nx / dir;
  const fy = ny / dir;
  const frags: FixtureFrag[] = [
    {
      x: cx + fx * 0.12,
      y: cy + fy * 0.1,
      w: Math.max(0.16, fixture.w * 0.28),
      d: Math.max(0.12, fixture.d * 0.32),
      material: fixture.material,
      vx: fx * 1.4,
      vy: fy * 1.4,
    },
  ];
  if (fixture.kind === "sofa" || fixture.kind === "cabinet" || fixture.kind === "counter") {
    frags.push({
      x: cx - fx * 0.16,
      y: cy - fy * 0.08,
      w: 0.2,
      d: 0.14,
      material: fixture.material,
      vx: -fx * 0.9,
      vy: -fy * 0.7,
    });
  }
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
    if (fixtureSupported(building, fixture)) continue;
    const out = breakFixture(building, fixture, particles, events, 0.2, 0.4);
    cash += out.cash;
    frags.push(...out.frags);
  }
  return { cash, frags };
}
