import { independentFloors } from "../structure/construction";
import { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import {
  fixtureCatalog,
  fixtureExposed,
  fixtureSupported,
  hasFurnishedInterior,
  interiorFloorCoverage,
  type FixtureFinish,
  type InteriorFloorSpan,
} from "../structure/interior";
import { neighborRoofBayOpen, roofFrameBeams } from "../structure/roof";
import type { Building, Cell, InteriorFixture, RoofSection } from "../structure/types";
import { cellPresent, cellWorldBox } from "../structure/types";
import { depthKey } from "../world/iso";
import { drawFaceWindow, drawIsoBox, drawShadow, drawSlopedQuad, drawTopCap, shade } from "./drawIso";
import { brokenEdgeColor, floorFinishColor, plasterColor, topFaceColor, wallFaceColor } from "./lighting";
import { PAL } from "./palette";

const WALL_THICK = 0.16;
const FLOOR_H = 0.18;
/** Overlap into the south/east neighbor so iso seams do not open a gutter. */
const FLOOR_SEAM = 0.03;

function neighbor(b: Building, gx: number, gy: number, floor: number): Cell | undefined {
  if (gx < 0 || gy < 0 || gx >= b.w || gy >= b.d) return undefined;
  return b.grid[floor]?.[gx]?.[gy];
}

function jag(gx: number, gy: number, k: number): number {
  return (((gx * 13 + gy * 7 + k * 5) % 7) - 3) * 0.018;
}

/** Framing is drawn behind covering, so it only reads at openings or undersides. */
export function roofShowsFrame(b: Building, roof: RoofSection): boolean {
  if (!b.construction?.bays) return false;
  if (roof.state === "gone") return false;
  if (roof.state === "sagging" || roof.state === "falling") return true;
  return neighborRoofBayOpen(b, roof, -1) || neighborRoofBayOpen(b, roof, 1);
}

function floorOpen(
  b: Building,
  gx: number,
  gy: number,
  floor: number,
  hasFloor: (gx: number, gy: number, floor: number) => boolean,
): boolean {
  if (gx < 0 || gy < 0 || gx >= b.w || gy >= b.d) return true;
  return !hasFloor(gx, gy, floor);
}

function drawBrokenFloorEdge(
  g: Graphics,
  b: Building,
  gx: number,
  gy: number,
  floor: number,
  edge: number,
  alpha: number,
  hasFloor: (gx: number, gy: number, floor: number) => boolean,
): void {
  const cs = b.cellSize;
  const x = b.x + gx * cs;
  const y = b.y + gy * cs;
  const z0 = floor * FLOOR_Z;
  const z1 = z0 + FLOOR_H;
  if (floorOpen(b, gx, gy + 1, floor, hasFloor)) {
    drawFaceWindow(g, x, y + cs, x + cs, y + cs, z0, z1, 0, 1, 0, 1, edge, alpha);
    const j = jag(gx, gy, 1);
    drawIsoBox(g, x + 0.06, y + cs - 0.07 + j, cs * 0.88, 0.1, z0, FLOOR_H + 0.04, edge, PAL.plankDark, edge, alpha);
  }
  if (floorOpen(b, gx + 1, gy, floor, hasFloor)) {
    drawFaceWindow(g, x + cs, y, x + cs, y + cs, z0, z1, 0, 1, 0, 1, shade(edge, 1.08), alpha);
    const j = jag(gx, gy, 2);
    drawIsoBox(g, x + cs - 0.07 + j, y + 0.06, 0.1, cs * 0.86, z0, FLOOR_H + 0.04, edge, PAL.plankDark, edge, alpha);
  }
  if (floorOpen(b, gx - 1, gy, floor, hasFloor) || floorOpen(b, gx, gy - 1, floor, hasFloor)) {
    drawIsoBox(g, x + 0.03, y + 0.03, 0.16, 0.16, z0, 0.03, PAL.plasterShadow, PAL.plasterShadow, PAL.plasterShadow, alpha * 0.4);
  }
}

function drawInteriorFloorSpan(
  g: Graphics,
  b: Building,
  span: InteriorFloorSpan,
  alpha: number,
  hasFloor: (gx: number, gy: number, floor: number) => boolean,
): void {
  const cs = b.cellSize;
  const x = b.x + span.gx0 * cs;
  const y = b.y + span.gy0 * cs;
  const w = (span.gx1 - span.gx0 + 1) * cs;
  const d = (span.gy1 - span.gy0 + 1) * cs;
  const z0 = span.floor * FLOOR_Z;
  const top = floorFinishColor(span.finish);
  const edge = floorFinishColor(span.finish, true);
  drawTopCap(g, x, y, w + FLOOR_SEAM, d + FLOOR_SEAM, z0 + FLOOR_H, top, alpha);
  for (let gy = span.gy0; gy <= span.gy1; gy++) {
    for (let gx = span.gx0; gx <= span.gx1; gx++) {
      drawBrokenFloorEdge(g, b, gx, gy, span.floor, edge, alpha, hasFloor);
    }
  }
}

/** Farthest-from-camera corner so the slab paints before objects standing on it. */
function interiorFloorPainterDepth(b: Building, span: InteriorFloorSpan): number {
  const cs = b.cellSize;
  const x0 = b.x + span.gx0 * cs;
  const y0 = b.y + span.gy0 * cs;
  const x1 = x0 + (span.gx1 - span.gx0 + 1) * cs + FLOOR_SEAM;
  const y1 = y0 + (span.gy1 - span.gy0 + 1) * cs + FLOOR_SEAM;
  const z = span.floor * FLOOR_Z + FLOOR_H;
  let best = Infinity;
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as const) {
    const d = depthKey(x, y, z);
    if (d < best) best = d;
  }
  return best;
}

type WallStubDir = "north" | "south" | "east" | "west";

function wallStubDepth(b: Building, gx: number, gy: number, floor: number, dir: WallStubDir): number {
  const cs = b.cellSize;
  const x = b.x + gx * cs;
  const y = b.y + gy * cs;
  const z = floor * FLOOR_Z + FLOOR_Z * 0.45;
  switch (dir) {
    case "north":
      return depthKey(x + cs * 0.5, y + WALL_THICK * 0.5, z);
    case "south":
      return depthKey(x + cs * 0.5, y + cs - WALL_THICK * 0.5, z);
    case "west":
      return depthKey(x + WALL_THICK * 0.5, y + cs * 0.5, z);
    case "east":
      return depthKey(x + cs - WALL_THICK * 0.5, y + cs * 0.5, z);
    default: {
      const _never: never = dir;
      return _never;
    }
  }
}

function drawInteriorWallStub(
  g: Graphics,
  b: Building,
  gx: number,
  gy: number,
  floor: number,
  dir: WallStubDir,
  alpha: number,
): void {
  const cell = neighbor(b, gx, gy, floor);
  if (!cell || cell.state !== "breached") return;
  const cs = b.cellSize;
  const x = b.x + gx * cs;
  const y = b.y + gy * cs;
  const z0 = floor * FLOOR_Z;
  const h = FLOOR_Z * 0.9;
  const plaster = plasterColor();
  const shadow = plasterColor(true);
  switch (dir) {
    case "north": {
      const north = neighbor(b, gx, gy - 1, floor);
      if (!north || !cellPresent(north)) return;
      drawIsoBox(g, x + 0.04, y, cs - 0.08, WALL_THICK, z0, h, plaster, shadow, wallFaceColor(north.material, "south", true), alpha);
      drawIsoBox(g, x + 0.04, y, cs - 0.08, 0.05, z0, 0.1, shadow, shadow, shadow, alpha * 0.5);
      return;
    }
    case "west": {
      const west = neighbor(b, gx - 1, gy, floor);
      if (!west || !cellPresent(west)) return;
      drawIsoBox(g, x, y + 0.04, WALL_THICK, cs - 0.08, z0, h, plaster, wallFaceColor(west.material, "east", true), shadow, alpha);
      drawIsoBox(g, x, y + 0.04, 0.05, cs - 0.08, z0, 0.1, shadow, shadow, shadow, alpha * 0.45);
      return;
    }
    case "south": {
      const south = neighbor(b, gx, gy + 1, floor);
      if (!south || !cellPresent(south)) return;
      const mat = south.material;
      drawIsoBox(
        g,
        x + 0.03,
        y + cs - WALL_THICK,
        cs - 0.06,
        WALL_THICK,
        z0,
        h * 0.92,
        topFaceColor(mat, true),
        wallFaceColor(mat, "south", true),
        brokenEdgeColor(mat),
        alpha,
      );
      return;
    }
    case "east": {
      const east = neighbor(b, gx + 1, gy, floor);
      if (!east || !cellPresent(east)) return;
      const mat = east.material;
      drawIsoBox(
        g,
        x + cs - WALL_THICK,
        y + 0.03,
        WALL_THICK,
        cs - 0.06,
        z0,
        h * 0.92,
        topFaceColor(mat, true),
        brokenEdgeColor(mat),
        wallFaceColor(mat, "east", true),
        alpha,
      );
      return;
    }
    default: {
      const _never: never = dir;
      return _never;
    }
  }
}

function wallStubDirs(b: Building, gx: number, gy: number, floor: number): WallStubDir[] {
  const cell = neighbor(b, gx, gy, floor);
  if (!cell || cell.state !== "breached") return [];
  const dirs: WallStubDir[] = [];
  const north = neighbor(b, gx, gy - 1, floor);
  const west = neighbor(b, gx - 1, gy, floor);
  const south = neighbor(b, gx, gy + 1, floor);
  const east = neighbor(b, gx + 1, gy, floor);
  if (north && cellPresent(north)) dirs.push("north");
  if (west && cellPresent(west)) dirs.push("west");
  if (south && cellPresent(south)) dirs.push("south");
  if (east && cellPresent(east)) dirs.push("east");
  return dirs;
}

export function drawThickBrokenWall(
  g: Graphics,
  b: Building,
  dir: "south" | "east",
  x0: number,
  y0: number,
  along: number,
  z0: number,
  mat: Cell["material"],
  alpha: number,
): void {
  if (!hasFurnishedInterior(b)) return;
  const h = FLOOR_Z * 0.88;
  if (dir === "south") {
    drawIsoBox(
      g,
      x0,
      y0 - WALL_THICK,
      along,
      WALL_THICK,
      z0,
      h,
      topFaceColor(mat, true),
      wallFaceColor(mat, "south", true),
      brokenEdgeColor(mat),
      alpha,
    );
    return;
  }
  drawIsoBox(
    g,
    x0 - WALL_THICK,
    y0,
    WALL_THICK,
    along,
    z0,
    h,
    topFaceColor(mat, true),
    brokenEdgeColor(mat),
    wallFaceColor(mat, "east", true),
    alpha,
  );
}

function drawFixtureSolid(
  g: Graphics,
  fixture: InteriorFixture,
  z0: number,
  alpha: number,
): void {
  const def = fixtureCatalog(fixture.kind);
  for (const box of def.boxes) {
    drawIsoBox(g,
      fixture.x + (box.along + .5 - box.len / 2) * fixture.w,
      fixture.y + (box.across + .5 - box.wid / 2) * fixture.d,
      box.len * fixture.w, box.wid * fixture.d, z0 + box.z * fixture.h, box.h * fixture.h,
      box.top, box.left, box.right, alpha);
  }
}

function finishColors(finish: FixtureFinish): { top: number; dark: number; side: number } {
  switch (finish) {
    case "wood":
      return { top: PAL.woodTop, dark: PAL.woodDark, side: PAL.wood };
    case "ceramic":
      return { top: PAL.ceramic, dark: PAL.ceramicDark, side: PAL.ceramic };
    case "metal":
      return { top: PAL.metalTop, dark: PAL.metalDark, side: PAL.metal };
    default: {
      const _never: never = finish;
      return _never;
    }
  }
}

function drawBrokenFixture(g: Graphics, fixture: InteriorFixture, z0: number, alpha: number): void {
  const finish = fixtureCatalog(fixture.kind).finish;
  const c = finishColors(finish);
  const x = fixture.x;
  const y = fixture.y;
  const w = fixture.w;
  const d = fixture.d;
  drawShadow(g, x, y, w, d, 0.12 * alpha);
  switch (finish) {
    case "ceramic": {
      drawIsoBox(g, x + w * 0.1, y + d * 0.12, w * 0.62, d * 0.48, z0, Math.max(0.07, fixture.h * 0.22), c.top, c.dark, c.side, alpha);
      drawIsoBox(g, x + w * 0.48, y + d * 0.38, w * 0.32, d * 0.28, z0, 0.09, shade(c.top, 0.92), c.dark, c.side, alpha);
      return;
    }
    case "metal": {
      drawIsoBox(g, x + 0.02, y + 0.02, w * 0.78, d * 0.7, z0, Math.max(0.05, fixture.h * 0.16), c.top, c.dark, c.side, alpha);
      drawIsoBox(g, x + w * 0.18, y - 0.01, w * 0.22, d + 0.04, z0 + 0.02, fixture.h * 0.42, c.side, c.dark, c.top, alpha);
      drawIsoBox(g, x + w * 0.5, y + 0.01, w * 0.2, d * 0.85, z0 + 0.01, fixture.h * 0.34, c.top, c.dark, c.side, alpha);
      return;
    }
    case "wood": {
      drawIsoBox(
        g,
        x + 0.04,
        y + 0.04,
        w * 0.7,
        d * 0.55,
        z0,
        Math.max(0.06, fixture.h * 0.18),
        shade(c.top, 0.75),
        c.dark,
        c.side,
        alpha,
      );
      drawIsoBox(g, x + w * 0.45, y + d * 0.2, w * 0.28, d * 0.22, z0, 0.08, c.dark, c.dark, PAL.plankDark, alpha);
      return;
    }
    default: {
      const _never: never = finish;
      return _never;
    }
  }
}

function drawInteriorFixture(g: Graphics, b: Building, fixture: InteriorFixture, alpha: number, reveal = false): void {
  if (!reveal && !fixtureExposed(b, fixture) && !(fixture.broken && fixtureSupported(b, fixture))) return;
  if (fixture.broken && !fixtureSupported(b, fixture)) return;
  const z0 = fixture.floor * FLOOR_Z + FLOOR_H;
  if (fixture.broken) {
    drawBrokenFixture(g, fixture, z0, alpha);
    return;
  }
  drawFixtureSolid(g, fixture, z0, alpha);
}

function fixtureDepth(fixture: InteriorFixture): number {
  return depthKey(fixture.x + fixture.w * 0.5, fixture.y + fixture.d * 0.5, fixture.floor * FLOOR_Z + fixture.h * 0.45);
}

function drawSlopedBeam(
  g: Graphics,
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  halfW: number,
  top: number,
  side: number,
  alpha: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * halfW;
  const py = (dx / len) * halfW;
  const thick = 0.09;
  const topQuad = [
    { x: a.x + px, y: a.y + py, z: a.z },
    { x: a.x - px, y: a.y - py, z: a.z },
    { x: b.x - px, y: b.y - py, z: b.z },
    { x: b.x + px, y: b.y + py, z: b.z },
  ];
  const under = topQuad.map((v) => ({ x: v.x, y: v.y, z: v.z - thick }));
  drawSlopedQuad(g, under, side, side, alpha * 0.9);
  drawSlopedQuad(g, [topQuad[0]!, topQuad[3]!, under[3]!, under[0]!], side, side, alpha);
  drawSlopedQuad(g, [topQuad[1]!, topQuad[2]!, under[2]!, under[1]!], side, side, alpha);
  drawSlopedQuad(g, topQuad, top, side, alpha);
}

export function drawRoofFrame(g: Graphics, _b: Building, roof: RoofSection, alpha: number): void {
  const beams = roofFrameBeams(roof);
  if (beams.length === 0) return;
  const top = PAL.woodTop;
  const side = PAL.woodDark;
  for (const beam of beams) {
    const half = beam.kind === "plate" ? 0.055 : 0.045;
    drawSlopedBeam(g, beam.a, beam.b, half, top, side, alpha);
  }
}

type InteriorDrawKind = "floor" | "stub" | "fixture" | "partition";

export function interiorCmds(
  b: Building,
  fade: number,
  options: { reveal?: boolean; maxFloor?: number;
    fadeBox?: (key: string, x: number, y: number, w: number, d: number, z: number, top: number) => number } = {},
): { depth: number; kind: InteriorDrawKind; run: (g: Graphics) => void }[] {
  if (!hasFurnishedInterior(b)) return [];
  const cmds: { depth: number; kind: InteriorDrawKind; run: (g: Graphics) => void }[] = [];
  const interiorFade = fade;
  const localFade = (key: string, x: number, y: number, w: number, d: number, z: number, top: number) =>
    interiorFade * (options.fadeBox?.(key, x, y, w, d, z, top) ?? 1);
  const maxFloor = options.maxFloor ?? Infinity;
  const coverage = interiorFloorCoverage(b, options.reveal);
  if (independentFloors(b)) {
    for (const tile of b.floorTiles ?? []) {
      if (tile.state !== "falling" || tile.floor > maxFloor) continue;
      const cs = b.cellSize, x = b.x + tile.gx * cs, y = b.y + tile.gy * cs;
      const z = tile.floor * FLOOR_Z * (1 - tile.fallT);
      const mat = b.construction!.floor;
      cmds.push({ kind: "floor", depth: depthKey(x + cs / 2, y + cs / 2, z), run: g =>
        drawIsoBox(g, x, y, cs, cs, z, FLOOR_H, topFaceColor(mat), wallFaceColor(mat, "south"), wallFaceColor(mat, "east"), fade) });
    }
    for (const cell of b.cells) {
      if (!cellPresent(cell) || cell.floor > maxFloor) continue;
      if (cell.cladding?.hp === 0) {
        const box = cellWorldBox(b, cell);
        const alpha = localFade(`column:${cell.floor}:${cell.gx}:${cell.gy}`, box.x, box.y, box.w, box.d,
          cell.floor * FLOOR_Z, (cell.floor + 1) * FLOOR_Z);
        cmds.push({ kind: "stub", depth: depthKey(box.x + box.w / 2, box.y + box.d / 2, cell.floor * FLOOR_Z), run: g =>
          drawIsoBox(g, box.x, box.y, box.w, box.d, cell.floor * FLOOR_Z, FLOOR_Z, PAL.metalTop, PAL.metalDark, PAL.metal, alpha) });
        continue;
      }
      if (cell.gy !== 0 && cell.gx !== 0) continue;
      const cs = b.cellSize, x = b.x + cell.gx * cs, y = b.y + cell.gy * cs;
      const alpha = localFade(`stub:${cell.floor}:${cell.gx}:${cell.gy}`, x, y,
        cell.gy === 0 ? cs : WALL_THICK, cell.gy === 0 ? WALL_THICK : cs,
        cell.floor * FLOOR_Z, (cell.floor + 1) * FLOOR_Z);
      cmds.push({ kind: "stub", depth: depthKey(x + (cell.gy === 0 ? cs / 2 : WALL_THICK / 2),
        y + (cell.gy === 0 ? WALL_THICK / 2 : cs / 2), cell.floor * FLOOR_Z), run: g => {
        const north = cell.gy === 0;
        const mat = b.construction!.structure;
        drawIsoBox(g, x, y, north ? cs : WALL_THICK, north ? WALL_THICK : cs, cell.floor * FLOOR_Z, FLOOR_Z,
          topFaceColor(mat), wallFaceColor(mat, "south"), wallFaceColor(mat, "east"), alpha);
      }});
    }
  }
  // Upper floors must sort locally: a room-sized polygon sorts behind near ground objects.
  const spans = coverage.spans.flatMap(span => span.floor === 0 ? [span] :
    Array.from({ length: span.gy1 - span.gy0 + 1 }, (_, iy) =>
      Array.from({ length: span.gx1 - span.gx0 + 1 }, (_, ix) => ({ ...span,
        gx0: span.gx0 + ix, gx1: span.gx0 + ix, gy0: span.gy0 + iy, gy1: span.gy0 + iy }))).flat());
  for (const span of spans) {
    if (span.floor > maxFloor) continue;
    const cs = b.cellSize;
    const alpha = localFade(`floor:${span.floor}:${span.gx0}:${span.gy0}`, b.x + span.gx0 * cs,
      b.y + span.gy0 * cs, (span.gx1 - span.gx0 + 1) * cs, (span.gy1 - span.gy0 + 1) * cs,
      span.floor * FLOOR_Z, span.floor * FLOOR_Z + FLOOR_H);
    cmds.push({
      kind: "floor",
      depth: interiorFloorPainterDepth(b, span),
      run: (g) => drawInteriorFloorSpan(g, b, span, alpha, coverage.hasFloor),
    });
    for (let gy = span.gy0; gy <= span.gy1; gy++) {
      for (let gx = span.gx0; gx <= span.gx1; gx++) {
        for (const dir of independentFloors(b) ? [] : wallStubDirs(b, gx, gy, span.floor)) {
          cmds.push({
            kind: "stub",
            depth: wallStubDepth(b, gx, gy, span.floor, dir),
            run: (g) => drawInteriorWallStub(g, b, gx, gy, span.floor, dir, interiorFade),
          });
        }
      }
    }
  }
  for (const fixture of b.fixtures) {
    if (fixture.floor > maxFloor) continue;
    const exposed = independentFloors(b)
      ? fixture.support.some(s => coverage.hasFloor(s.gx, s.gy, fixture.floor))
      : fixtureExposed(b, fixture);
    if (!options.reveal && !exposed && !(fixture.broken && fixtureSupported(b, fixture))) continue;
    if (fixture.broken && !fixtureSupported(b, fixture)) continue;
    const alpha = localFade(`fixture:${fixture.id}`, fixture.x, fixture.y, fixture.w, fixture.d,
      fixture.floor * FLOOR_Z, fixture.floor * FLOOR_Z + fixture.h);
    cmds.push({
      kind: fixture.kind === "partition" ? "partition" : "fixture",
      depth: fixtureDepth(fixture),
      run: (g) => drawInteriorFixture(g, b, fixture, alpha, true),
    });
  }
  return cmds;
}
