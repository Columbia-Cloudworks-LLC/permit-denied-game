import { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import {
  fixtureCatalog,
  fixtureExposed,
  fixtureSupported,
  hasFurnishedInterior,
  ranchFloorCoverage,
  type FixtureFinish,
  type RanchFloorSpan,
} from "../structure/interior";
import { neighborRoofBayOpen, ranchRafterBeams } from "../structure/roof";
import type { Building, Cell, InteriorFixture, RoofSection } from "../structure/types";
import { cellPresent } from "../structure/types";
import { depthKey } from "../world/iso";
import { drawFaceWindow, drawIsoBox, drawShadow, drawSlopedQuad, drawTopCap, shade } from "./drawIso";
import { brokenEdgeColor, floorFinishColor, plasterColor, topFaceColor, wallFaceColor } from "./lighting";
import { PAL } from "./palette";

const WALL_THICK = 0.16;
const FLOOR_H = 0.11;
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
export function ranchRoofShowsRafters(b: Building, roof: RoofSection): boolean {
  if (!hasFurnishedInterior(b)) return false;
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

function drawRanchFloorSpan(
  g: Graphics,
  b: Building,
  span: RanchFloorSpan,
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
function ranchFloorPainterDepth(b: Building, span: RanchFloorSpan): number {
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

function drawRanchWallStub(
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

export function drawRanchThickBrokenWall(
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
  const x = fixture.x;
  const y = fixture.y;
  const w = fixture.w;
  const d = fixture.d;
  const h = fixture.h;
  drawShadow(g, x, y, w, d, 0.18 * alpha);
  switch (fixture.kind) {
    case "cabinet": {
      drawIsoBox(g, x, y, w, d, z0, h, PAL.woodTop, PAL.woodDark, PAL.wood, alpha);
      drawIsoBox(g, x + w * 0.12, y + d * 0.15, w * 0.76, d * 0.2, z0 + h * 0.12, h * 0.7, PAL.wood, PAL.woodDark, PAL.woodDark, alpha);
      return;
    }
    case "counter": {
      drawIsoBox(g, x, y, w, d, z0, h * 0.72, PAL.wood, PAL.woodDark, PAL.wood, alpha);
      drawIsoBox(g, x - 0.02, y - 0.02, w + 0.04, d + 0.04, z0 + h * 0.7, h * 0.28, PAL.plank, PAL.plankDark, PAL.plank, alpha);
      return;
    }
    case "toilet": {
      drawIsoBox(g, x + w * 0.12, y, w * 0.76, d * 0.38, z0 + h * 0.28, h * 0.7, PAL.ceramic, PAL.ceramicDark, PAL.ceramic, alpha);
      drawIsoBox(g, x + w * 0.08, y + d * 0.28, w * 0.84, d * 0.7, z0, h * 0.42, PAL.ceramic, PAL.ceramicDark, PAL.ceramic, alpha);
      return;
    }
    case "sofa": {
      drawIsoBox(g, x, y, w, d, z0, h * 0.45, PAL.sofa, PAL.sofaDark, PAL.sofa, alpha);
      drawIsoBox(g, x, y, w, d * 0.32, z0 + h * 0.4, h * 0.58, PAL.sofa, PAL.sofaDark, shade(PAL.sofa, 1.08), alpha);
      drawIsoBox(g, x + w * 0.06, y + d * 0.36, w * 0.4, d * 0.5, z0 + h * 0.42, h * 0.22, shade(PAL.sofa, 1.1), PAL.sofaDark, PAL.sofa, alpha);
      drawIsoBox(g, x + w * 0.52, y + d * 0.36, w * 0.4, d * 0.5, z0 + h * 0.42, h * 0.22, shade(PAL.sofa, 1.1), PAL.sofaDark, PAL.sofa, alpha);
      return;
    }
    case "table": {
      const topH = Math.min(0.08, h * 0.28);
      drawIsoBox(g, x + w * 0.08, y + d * 0.08, w * 0.18, d * 0.18, z0, h - topH, PAL.woodDark, PAL.woodDark, PAL.wood, alpha);
      drawIsoBox(g, x + w * 0.74, y + d * 0.08, w * 0.18, d * 0.18, z0, h - topH, PAL.woodDark, PAL.woodDark, PAL.wood, alpha);
      drawIsoBox(g, x + w * 0.08, y + d * 0.74, w * 0.18, d * 0.18, z0, h - topH, PAL.woodDark, PAL.woodDark, PAL.wood, alpha);
      drawIsoBox(g, x + w * 0.74, y + d * 0.74, w * 0.18, d * 0.18, z0, h - topH, PAL.woodDark, PAL.woodDark, PAL.wood, alpha);
      drawIsoBox(g, x, y, w, d, z0 + h - topH, topH, PAL.plank, PAL.plankDark, PAL.woodTop, alpha);
      return;
    }
    case "radiator": {
      drawIsoBox(g, x, y, w, d, z0, h, PAL.metalTop, PAL.metalDark, PAL.metal, alpha);
      for (let i = 0; i < 3; i++) {
        drawIsoBox(g, x + 0.04 + i * (w * 0.3), y - 0.02, w * 0.18, d + 0.04, z0 + 0.04, h * 0.82, PAL.metal, PAL.metalDark, PAL.metalTop, alpha);
      }
      return;
    }
    default: {
      const _never: never = fixture.kind;
      return _never;
    }
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

function drawRanchFixture(g: Graphics, b: Building, fixture: InteriorFixture, alpha: number): void {
  if (!fixtureExposed(b, fixture) && !(fixture.broken && fixtureSupported(b, fixture))) return;
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

export function drawRanchRafters(g: Graphics, _b: Building, roof: RoofSection, alpha: number): void {
  const beams = ranchRafterBeams(roof);
  if (beams.length === 0) return;
  const top = PAL.woodTop;
  const side = PAL.woodDark;
  for (const beam of beams) {
    const half = beam.kind === "plate" ? 0.055 : 0.045;
    drawSlopedBeam(g, beam.a, beam.b, half, top, side, alpha);
  }
}

type RanchInteriorKind = "floor" | "stub" | "fixture";

export function ranchInteriorCmds(
  b: Building,
  fade: number,
): { depth: number; kind: RanchInteriorKind; run: (g: Graphics) => void }[] {
  if (!hasFurnishedInterior(b)) return [];
  const cmds: { depth: number; kind: RanchInteriorKind; run: (g: Graphics) => void }[] = [];
  const interiorFade = Math.max(fade, 0.78);
  const coverage = ranchFloorCoverage(b);
  for (const span of coverage.spans) {
    cmds.push({
      kind: "floor",
      depth: ranchFloorPainterDepth(b, span),
      run: (g) => drawRanchFloorSpan(g, b, span, interiorFade, coverage.hasFloor),
    });
    for (let gy = span.gy0; gy <= span.gy1; gy++) {
      for (let gx = span.gx0; gx <= span.gx1; gx++) {
        for (const dir of wallStubDirs(b, gx, gy, span.floor)) {
          cmds.push({
            kind: "stub",
            depth: wallStubDepth(b, gx, gy, span.floor, dir),
            run: (g) => drawRanchWallStub(g, b, gx, gy, span.floor, dir, interiorFade),
          });
        }
      }
    }
  }
  for (const fixture of b.fixtures) {
    if (!fixtureExposed(b, fixture) && !(fixture.broken && fixtureSupported(b, fixture))) continue;
    if (fixture.broken && !fixtureSupported(b, fixture)) continue;
    cmds.push({
      kind: "fixture",
      depth: fixtureDepth(fixture),
      run: (g) => drawRanchFixture(g, b, fixture, interiorFade),
    });
  }
  return cmds;
}
