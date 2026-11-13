import { FLOOR_Z } from "../game/constants";
import { depthKey } from "../world/iso";
import { roofCoverage } from "../structure/roof";
import { rooftopCells } from "../structure/rooftop";
import type { Building, Cell, FacadeTheme, Material, RoofSection } from "../structure/types";

export type WallVisual = "intact" | "cracked" | "broken-edge";

export interface WallSpan {
  kind: "wall";
  dir: "south" | "east";
  floor: number;
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
  material: Material;
  facadeMaterial: Material;
  theme: FacadeTheme;
  visual: WallVisual;
  depth: number;
}

export interface BuildingSurfaces {
  walls: WallSpan[];
  footprint: { x: number; y: number; w: number; d: number };
  geometryCount: number;
}

const cache = new WeakMap<Building, { sig: string; surfaces: BuildingSurfaces }>();

function cellLive(cell: Cell | undefined): boolean {
  return !!cell && cell.state !== "gone" && cell.state !== "falling";
}

function neighbor(b: Building, gx: number, gy: number, floor: number): Cell | undefined {
  if (gx < 0 || gy < 0 || gx >= b.w || gy >= b.d) return undefined;
  return b.grid[floor]?.[gx]?.[gy];
}

function spanDepth(b: Building, gx0: number, gy0: number, gx1: number, gy1: number, floor: number): number {
  const cs = b.cellSize;
  const cx = b.x + ((gx0 + gx1 + 1) * 0.5) * cs;
  const cy = b.y + ((gy0 + gy1 + 1) * 0.5) * cs;
  return depthKey(cx, cy, floor * FLOOR_Z);
}

/**
 * Front-plane depth of the south/east wall cells a roof panel sits on: walls on the panel's own
 * floor within one cell of what it covers. A panel's eave and overhang reach over those faces, so
 * it must sort after them. Walls of a tower rising through a lower roof are not eave walls: the
 * lower panels keep their own depth there, behind the tower faces in front of them.
 */
export function eaveWallFaceDepth(b: Building, floor: number, coverage: readonly { gx: number; gy: number }[]): number {
  const cs = b.cellSize;
  const z = floor * FLOOR_Z;
  let max = -Infinity;
  for (const span of getBuildingSurfaces(b).walls) {
    if (span.floor !== floor) continue;
    if (span.dir === "south") {
      if (!coverageAlong(coverage, "x", span.gx0, span.gx1, span.gy0)) continue;
      const y = b.y + (span.gy0 + 1) * cs;
      for (let gx = span.gx0; gx <= span.gx1; gx++) max = Math.max(max, depthKey(b.x + (gx + 0.5) * cs, y, z));
      continue;
    }
    if (!coverageAlong(coverage, "y", span.gy0, span.gy1, span.gx0)) continue;
    const x = b.x + (span.gx0 + 1) * cs;
    for (let gy = span.gy0; gy <= span.gy1; gy++) max = Math.max(max, depthKey(x, b.y + (gy + 0.5) * cs, z));
  }
  return max;
}

/** Whether any covered cell lies within one cell of a wall run from `a0` to `a1` on line `at`. */
function coverageAlong(coverage: readonly { gx: number; gy: number }[], axis: "x" | "y", a0: number, a1: number, at: number): boolean {
  return coverage.some((c) => axis === "x"
    ? c.gx >= a0 - 1 && c.gx <= a1 + 1 && Math.abs(c.gy - at) <= 1
    : c.gy >= a0 - 1 && c.gy <= a1 + 1 && Math.abs(c.gx - at) <= 1);
}

function footprintBox(b: Building): { x: number; y: number; w: number; d: number } {
  const cs = b.cellSize;
  let minGx = b.w;
  let minGy = b.d;
  let maxGx = -1;
  let maxGy = -1;
  for (const cell of b.cells) {
    if (!cellLive(cell)) continue;
    minGx = Math.min(minGx, cell.gx);
    minGy = Math.min(minGy, cell.gy);
    maxGx = Math.max(maxGx, cell.gx);
    maxGy = Math.max(maxGy, cell.gy);
  }
  if (maxGx < 0) return { x: b.x, y: b.y, w: b.w * cs, d: b.d * cs };
  return {
    x: b.x + minGx * cs,
    y: b.y + minGy * cs,
    w: (maxGx - minGx + 1) * cs,
    d: (maxGy - minGy + 1) * cs,
  };
}

interface WallRun {
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
  material: Material;
  facadeMaterial: Material;
  visual: WallVisual;
}

function wallKey(
  dir: "south" | "east",
  floor: number,
  material: Material,
  facadeMaterial: Material,
  theme: FacadeTheme,
  visual: WallVisual,
): string {
  return `${dir}:${floor}:${material}:${facadeMaterial}:${theme}:${visual}`;
}

function southExposed(_b: Building, cell: Cell): { exposed: boolean; visual: WallVisual | null } {
  if (!cellLive(cell) || cell.state === "breached" || cell.cladding?.hp === 0) return { exposed: false, visual: null };
  return { exposed: cell.exterior.south, visual: cell.state === "cracked" ? "cracked" : "intact" };
}

function eastExposed(_b: Building, cell: Cell): { exposed: boolean; visual: WallVisual | null } {
  if (!cellLive(cell) || cell.state === "breached" || cell.cladding?.hp === 0) return { exposed: false, visual: null };
  return { exposed: cell.exterior.east, visual: cell.state === "cracked" ? "cracked" : "intact" };
}

function flushWallRun(b: Building, dir: "south" | "east", floor: number, run: WallRun | null, out: WallSpan[]): void {
  if (!run) return;
  out.push({
    kind: "wall",
    dir,
    floor,
    ...run,
    theme: b.theme,
    depth: spanDepth(b, run.gx0, run.gy0, run.gx1, run.gy1, floor),
  });
}

function mergeSouthWalls(b: Building, floor: number, out: WallSpan[]): void {
  for (let gy = 0; gy < b.d; gy++) {
    let run: WallRun | null = null;
    let runKey = "";
    for (let gx = 0; gx < b.w; gx++) {
      const cell = neighbor(b, gx, gy, floor)!;
      const { exposed, visual } = southExposed(b, cell);
      if (!exposed || !visual) {
        flushWallRun(b, "south", floor, run, out);
        run = null;
        continue;
      }
      const key = wallKey("south", floor, cell.material, cell.facadeMaterial, b.theme, visual);
      if (run && key === runKey && gx === run.gx1 + 1) {
        run.gx1 = gx;
        continue;
      }
      flushWallRun(b, "south", floor, run, out);
      run = {
        gx0: gx,
        gy0: gy,
        gx1: gx,
        gy1: gy,
        material: cell.material,
        facadeMaterial: cell.facadeMaterial,
        visual,
      };
      runKey = key;
    }
    flushWallRun(b, "south", floor, run, out);
  }
}

function mergeEastWalls(b: Building, floor: number, out: WallSpan[]): void {
  for (let gx = 0; gx < b.w; gx++) {
    let run: WallRun | null = null;
    let runKey = "";
    for (let gy = 0; gy < b.d; gy++) {
      const cell = neighbor(b, gx, gy, floor)!;
      const { exposed, visual } = eastExposed(b, cell);
      if (!exposed || !visual) {
        flushWallRun(b, "east", floor, run, out);
        run = null;
        continue;
      }
      const key = wallKey("east", floor, cell.material, cell.facadeMaterial, b.theme, visual);
      if (run && key === runKey && gy === run.gy1 + 1) {
        run.gy1 = gy;
        continue;
      }
      flushWallRun(b, "east", floor, run, out);
      run = {
        gx0: gx,
        gy0: gy,
        gx1: gx,
        gy1: gy,
        material: cell.material,
        facadeMaterial: cell.facadeMaterial,
        visual,
      };
      runKey = key;
    }
    flushWallRun(b, "east", floor, run, out);
  }
}

export function extractBuildingSurfaces(b: Building): BuildingSurfaces {
  const walls: WallSpan[] = [];
  for (let floor = 0; floor < b.floors; floor++) {
    mergeSouthWalls(b, floor, walls);
    mergeEastWalls(b, floor, walls);
  }
  return {
    walls,
    footprint: footprintBox(b),
    geometryCount: walls.length,
  };
}

export function buildingSurfaceSignature(b: Building): string {
  return String(b.visualRevision);
}

export function releaseBuildingSurfaces(b: Building): void { cache.delete(b); deckCache.delete(b); }

export function getBuildingSurfaces(b: Building): BuildingSurfaces {
  const sig = buildingSurfaceSignature(b);
  const hit = cache.get(b);
  if (hit && hit.sig === sig) return hit.surfaces;
  const surfaces = extractBuildingSurfaces(b);
  cache.set(b, { sig, surfaces });
  return surfaces;
}

export function southFacadeCells(b: Building, span: WallSpan): Cell[] {
  const out: Cell[] = [];
  for (let gx = span.gx0; gx <= span.gx1; gx++) {
    const c = neighbor(b, gx, span.gy0, span.floor);
    if (c) out.push(c);
  }
  return out;
}

/** How one stretch of a merged deck's side meets what lies beyond it. */
export interface DeckEdgeRun {
  /** First and last cell along the side. */
  a: number;
  b: number;
  /** `parapet`: open roof edge. `wall`: a taller wing rises there. `breach`: the next panel is sagging away. */
  kind: "parapet" | "wall" | "breach";
}

/** A rectangle of intact, level flat-roof cells drawn as one continuous deck. */
export interface FlatDeck {
  floor: number;
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
  /** World extents; sides on an open roof edge keep the eave overhang. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z: number;
  material: Material;
  /** Only sides facing something other than another intact deck carry runs, so merged decks never show a seam. */
  edges: Record<"north" | "south" | "east" | "west", DeckEdgeRun[]>;
}

export interface FlatRoofPlan {
  decks: FlatDeck[];
  /** Live sections that still draw one by one: pitched, glazed, sagging, falling, or beside a breach. */
  loose: RoofSection[];
}

const deckCache = new WeakMap<Building, { sig: string; plan: FlatRoofPlan }>();
const cellKey = (floor: number, gx: number, gy: number): number => (floor * 128 + gx) * 128 + gy;
const DECK_SIDES = [["north", 0, -1], ["south", 0, 1], ["west", -1, 0], ["east", 1, 0]] as const;

/** Merged flat-roof decks for the building's current state, cached on its visual revision. */
export function flatRoofDecks(b: Building): FlatRoofPlan {
  const sig = buildingSurfaceSignature(b);
  const hit = deckCache.get(b);
  if (hit && hit.sig === sig) return hit.plan;
  const plan = mergeFlatRoofDecks(b);
  deckCache.set(b, { sig, plan });
  return plan;
}

/**
 * Merge contiguous intact flat-roof cells of one floor into deck rectangles. A section sagging,
 * falling, or next to a breach stays loose, so seams appear only along cracks and openings.
 * A deck never wraps around something tall standing on or beside it (a taller wing, rooftop
 * equipment): everything behind such a cell stays in its own rectangle, which keeps the
 * front-corner painter depth of every deck no later than the things it must paint under.
 */
export function mergeFlatRoofDecks(b: Building): FlatRoofPlan {
  // An open canopy is all underside and columns: its panels keep drawing one by one.
  if (b.canopy) return { decks: [], loose: b.roofs.filter(r => r.state !== "gone") };
  const flat = new Map<number, RoofSection>();
  const open = new Set<number>();
  for (const roof of b.roofs) {
    if (roof.style !== "flat" || roof.material === "glass") continue;
    for (const c of roofCoverage(roof)) {
      if (roof.state === "gone" || roof.state === "falling") open.add(cellKey(roof.floor, c.gx, c.gy));
      else flat.set(cellKey(roof.floor, c.gx, c.gy), roof);
    }
  }
  const besideBreach = (roof: RoofSection) => roofCoverage(roof).some(c =>
    DECK_SIDES.some(([, dx, dy]) => open.has(cellKey(roof.floor, c.gx + dx, c.gy + dy))));
  const solid = new Set<RoofSection>();
  for (const roof of new Set(flat.values())) {
    if (roof.state === "intact" && roof.sag === 0 && !besideBreach(roof)) solid.add(roof);
  }
  const upper = new Set<number>();
  for (const t of b.floorTiles) upper.add(cellKey(t.floor, t.gx, t.gy));
  const tall = new Map<number, { gx: number; gy: number }[]>();
  const markTall = (floor: number, gx: number, gy: number) => {
    const list = tall.get(floor) ?? [];
    list.push({ gx, gy });
    tall.set(floor, list);
  };
  for (const t of b.floorTiles) if (t.floor > 0) markTall(t.floor - 1, t.gx, t.gy);
  for (const f of b.rooftop) if (f.state === "mounted") for (const c of rooftopCells(f)) markTall(f.floor, c.gx, c.gy);

  const decks: FlatDeck[] = [];
  const taken = new Set<number>();
  const free = (floor: number, gx: number, gy: number) => {
    const key = cellKey(floor, gx, gy), roof = flat.get(key);
    return !!roof && solid.has(roof) && !taken.has(key);
  };
  const clear = (floor: number, gx0: number, gy0: number, gx1: number, gy1: number) =>
    !(tall.get(floor) ?? []).some(t => gx0 <= t.gx && gy0 <= t.gy && (gx1 > t.gx || gy1 > t.gy));
  const floors = [...new Set([...solid].map(r => r.floor))].sort((a, c) => a - c);
  for (const floor of floors) {
    for (let gy = 0; gy < b.d; gy++) for (let gx = 0; gx < b.w; gx++) {
      if (!free(floor, gx, gy)) continue;
      let gx1 = gx, gy1 = gy;
      while (free(floor, gx1 + 1, gy) && clear(floor, gx, gy, gx1 + 1, gy)) gx1++;
      const rowFree = (y: number) => { for (let x = gx; x <= gx1; x++) if (!free(floor, x, y)) return false; return true; };
      while (rowFree(gy1 + 1) && clear(floor, gx, gy, gx1, gy1 + 1)) gy1++;
      for (let x = gx; x <= gx1; x++) for (let y = gy; y <= gy1; y++) taken.add(cellKey(floor, x, y));
      decks.push(deckRect(b, floor, gx, gy, gx1, gy1, flat, solid, upper));
    }
  }
  return { decks, loose: b.roofs.filter(r => r.state !== "gone" && !solid.has(r)) };
}

function deckRect(
  b: Building, floor: number, gx0: number, gy0: number, gx1: number, gy1: number,
  flat: ReadonlyMap<number, RoofSection>, solid: ReadonlySet<RoofSection>, upper: ReadonlySet<number>,
): FlatDeck {
  const cs = b.cellSize, corner = flat.get(cellKey(floor, gx0, gy0))!;
  const edges: FlatDeck["edges"] = { north: [], south: [], east: [], west: [] };
  const outer: Record<string, boolean> = {};
  for (const [side, dx, dy] of DECK_SIDES) {
    const alongX = dy !== 0, from = alongX ? gx0 : gy0, to = alongX ? gx1 : gy1;
    let allOpen = true;
    for (let i = from; i <= to; i++) {
      const nx = alongX ? i : (dx < 0 ? gx0 - 1 : gx1 + 1), ny = alongX ? (dy < 0 ? gy0 - 1 : gy1 + 1) : i;
      const next = flat.get(cellKey(floor, nx, ny));
      const kind = next ? (solid.has(next) || (next.state === "intact" && next.sag === 0) ? null : "breach" as const)
        : upper.has(cellKey(floor + 1, nx, ny)) ? "wall" as const : "parapet" as const;
      if (kind !== "parapet") allOpen = false;
      if (!kind) continue;
      const last = edges[side][edges[side].length - 1];
      if (last && last.kind === kind && last.b === i - 1) last.b = i;
      else edges[side].push({ a: i, b: i, kind });
    }
    outer[side] = allOpen;
  }
  // Same eave overhang as the tiles and bays this deck replaces.
  const oh = corner.bay ? 0.14 : 0.12;
  return {
    floor, gx0, gy0, gx1, gy1, edges, material: corner.material, z: corner.verts[0]!.z,
    x0: b.x + gx0 * cs - (outer.west ? oh : 0), x1: b.x + (gx1 + 1) * cs + (outer.east ? oh : 0),
    y0: b.y + gy0 * cs - (outer.north ? oh : 0), y1: b.y + (gy1 + 1) * cs + (outer.south ? oh : 0),
  };
}
