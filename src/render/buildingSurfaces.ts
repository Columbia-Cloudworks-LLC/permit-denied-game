import { FLOOR_Z } from "../game/constants";
import { hasFurnishedInterior, inBuildingNeighborOpen } from "../structure/interior";
import { depthKey } from "../world/iso";
import type { Building, Cell, FacadeTheme, Material } from "../structure/types";
import { cellPresent } from "../structure/types";

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

export interface TopSpan {
  kind: "top";
  floor: number;
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
  material: Material;
  visual: "intact" | "cracked";
  depth: number;
}

export interface BreachGroup {
  kind: "breach";
  floor: number;
  cells: { gx: number; gy: number }[];
  material: Material;
  depth: number;
}

export interface BuildingSurfaces {
  walls: WallSpan[];
  tops: TopSpan[];
  breaches: BreachGroup[];
  footprint: { x: number; y: number; w: number; d: number };
  geometryCount: number;
}

export interface SurfaceStats {
  wallSpans: number;
  topSpans: number;
  breachGroups: number;
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

function roofCovers(b: Building, gx: number, gy: number, floor: number): boolean {
  if (floor !== b.floors - 1) return false;
  return b.roofs.some(
    (roof) => roof.state !== "gone" && roof.support.some((s) => s.gx === gx && s.gy === gy),
  );
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

function southExposed(b: Building, cell: Cell): { exposed: boolean; visual: WallVisual | null } {
  if (!cellLive(cell) || cell.state === "breached") return { exposed: false, visual: null };
  const southN = neighbor(b, cell.gx, cell.gy + 1, cell.floor);
  const exposed = !southN || !cellPresent(southN);
  if (!exposed) return { exposed: false, visual: null };
  if (hasFurnishedInterior(b) && inBuildingNeighborOpen(b, cell.gx, cell.gy + 1, cell.floor)) {
    return { exposed: false, visual: null };
  }
  const visual: WallVisual =
    southN && southN.state === "breached" ? "broken-edge" : cell.state === "cracked" ? "cracked" : "intact";
  return { exposed: true, visual };
}

function eastExposed(b: Building, cell: Cell): { exposed: boolean; visual: WallVisual | null } {
  if (!cellLive(cell) || cell.state === "breached") return { exposed: false, visual: null };
  const eastN = neighbor(b, cell.gx + 1, cell.gy, cell.floor);
  const selfOpen =
    hasFurnishedInterior(b) && inBuildingNeighborOpen(b, cell.gx, cell.gy + 1, cell.floor);
  const openingNeighbor =
    hasFurnishedInterior(b) &&
    !!eastN &&
    (inBuildingNeighborOpen(b, eastN.gx, eastN.gy + 1, cell.floor) || !cellPresent(eastN));
  const exposed = !eastN || !cellPresent(eastN) || (openingNeighbor && !selfOpen);
  if (!exposed) return { exposed: false, visual: null };
  const visual: WallVisual =
    eastN && (eastN.state === "breached" || openingNeighbor)
      ? "broken-edge"
      : cell.state === "cracked"
        ? "cracked"
        : "intact";
  return { exposed: true, visual };
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

function mergeTopCaps(b: Building, floor: number, out: TopSpan[]): void {
  if (b.archetypeId === "ranch") return;
  for (let gy = 0; gy < b.d; gy++) {
    let runGx0 = -1;
    let runMat: Material = "wood";
    let runVisual: "intact" | "cracked" = "intact";
    for (let gx = 0; gx <= b.w; gx++) {
      const cell = gx < b.w ? neighbor(b, gx, gy, floor) : undefined;
      const above = gx < b.w ? neighbor(b, gx, gy, floor + 1) : undefined;
      const open =
        cell &&
        cellLive(cell) &&
        cell.state !== "breached" &&
        (!above || !cellPresent(above)) &&
        !roofCovers(b, gx, gy, floor);
      const visual = cell && cellLive(cell) && cell.state !== "breached"
        ? cell.state === "cracked" ? "cracked" : "intact"
        : null;

      if (open && visual) {
        const key = `${cell!.material}:${visual}`;
        const prevKey = `${runMat}:${runVisual}`;
        if (runGx0 >= 0 && (key !== prevKey || gx !== (out[out.length - 1]?.gx1 ?? runGx0) + 1)) {
          out.push({
            kind: "top",
            floor,
            gx0: runGx0,
            gy0: gy,
            gx1: gx - 1,
            gy1: gy,
            material: runMat,
            visual: runVisual,
            depth: spanDepth(b, runGx0, gy, gx - 1, gy, floor),
          });
          runGx0 = -1;
        }
        if (runGx0 < 0) {
          runGx0 = gx;
          runMat = cell!.material;
          runVisual = visual;
        }
      } else if (runGx0 >= 0) {
        out.push({
          kind: "top",
          floor,
          gx0: runGx0,
          gy0: gy,
          gx1: gx - 1,
          gy1: gy,
          material: runMat,
          visual: runVisual,
          depth: spanDepth(b, runGx0, gy, gx - 1, gy, floor),
        });
        runGx0 = -1;
      }
    }
    if (runGx0 >= 0) {
      out.push({
        kind: "top",
        floor,
        gx0: runGx0,
        gy0: gy,
        gx1: b.w - 1,
        gy1: gy,
        material: runMat,
        visual: runVisual,
        depth: spanDepth(b, runGx0, gy, b.w - 1, gy, floor),
      });
    }
  }
}

function breachComponents(b: Building): BreachGroup[] {
  const groups: BreachGroup[] = [];
  const seen = new Set<string>();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  for (const seed of b.cells) {
    if (seed.state !== "breached") continue;
    const sk = `${seed.floor}:${seed.gx}:${seed.gy}`;
    if (seen.has(sk)) continue;
    const comp: { gx: number; gy: number }[] = [];
    const stack = [{ gx: seed.gx, gy: seed.gy, floor: seed.floor }];
    let material = seed.material;
    while (stack.length) {
      const cur = stack.pop()!;
      const ck = `${cur.floor}:${cur.gx}:${cur.gy}`;
      if (seen.has(ck)) continue;
      const c = neighbor(b, cur.gx, cur.gy, cur.floor);
      if (!c || c.state !== "breached") continue;
      seen.add(ck);
      comp.push({ gx: cur.gx, gy: cur.gy });
      for (const [dx, dy] of dirs) stack.push({ gx: cur.gx + dx, gy: cur.gy + dy, floor: cur.floor });
    }
    if (comp.length === 0) continue;
    let minGx = comp[0]!.gx;
    let maxGx = comp[0]!.gx;
    let minGy = comp[0]!.gy;
    let maxGy = comp[0]!.gy;
    for (const p of comp) {
      minGx = Math.min(minGx, p.gx);
      maxGx = Math.max(maxGx, p.gx);
      minGy = Math.min(minGy, p.gy);
      maxGy = Math.max(maxGy, p.gy);
    }
    groups.push({
      kind: "breach",
      floor: seed.floor,
      cells: comp,
      material,
      depth: spanDepth(b, minGx, minGy, maxGx, maxGy, seed.floor),
    });
  }
  return groups;
}

export function extractBuildingSurfaces(b: Building): BuildingSurfaces {
  const walls: WallSpan[] = [];
  const tops: TopSpan[] = [];
  for (let floor = 0; floor < b.floors; floor++) {
    mergeSouthWalls(b, floor, walls);
    mergeEastWalls(b, floor, walls);
    mergeTopCaps(b, floor, tops);
  }
  const breaches = breachComponents(b);
  return {
    walls,
    tops,
    breaches,
    footprint: footprintBox(b),
    geometryCount: walls.length + tops.length + breaches.length,
  };
}

export function buildingSurfaceSignature(b: Building): string {
  const parts: string[] = [`${b.w}:${b.d}:${b.floors}:${b.theme}`];
  for (const cell of b.cells) {
    parts.push(
      `${cell.gx},${cell.gy},${cell.floor},${cell.state},${cell.material},${cell.facadeMaterial},${cell.sag.toFixed(3)},${cell.fallT.toFixed(3)}`,
    );
  }
  for (const roof of b.roofs) {
    parts.push(`r${roof.id}:${roof.state}:${roof.sag.toFixed(3)}:${roof.fallT.toFixed(3)}`);
  }
  return parts.join("|");
}

export function getBuildingSurfaces(b: Building): BuildingSurfaces {
  const sig = buildingSurfaceSignature(b);
  const hit = cache.get(b);
  if (hit && hit.sig === sig) return hit.surfaces;
  const surfaces = extractBuildingSurfaces(b);
  cache.set(b, { sig, surfaces });
  return surfaces;
}

export function aggregateSurfaceStats(buildings: Building[]): SurfaceStats {
  let wallSpans = 0;
  let topSpans = 0;
  let breachGroups = 0;
  let geometryCount = 0;
  for (const b of buildings) {
    const s = getBuildingSurfaces(b);
    wallSpans += s.walls.length;
    topSpans += s.tops.length;
    breachGroups += s.breaches.length;
    geometryCount += s.geometryCount;
  }
  return { wallSpans, topSpans, breachGroups, geometryCount };
}

export function southFacadeCells(b: Building, span: WallSpan): Cell[] {
  const out: Cell[] = [];
  for (let gx = span.gx0; gx <= span.gx1; gx++) {
    const c = neighbor(b, gx, span.gy0, span.floor);
    if (c) out.push(c);
  }
  return out;
}
