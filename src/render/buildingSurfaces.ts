import { FLOOR_Z } from "../game/constants";
import { depthKey } from "../world/iso";
import type { Building, Cell, FacadeTheme, Material } from "../structure/types";

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

export function releaseBuildingSurfaces(b: Building): void { cache.delete(b); }

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
