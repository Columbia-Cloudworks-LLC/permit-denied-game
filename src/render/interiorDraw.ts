import { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import {
  cellDrawsRanchFloor,
  fixtureExposed,
  fixtureSupported,
  hasFurnishedInterior,
  ranchFloorSpans,
  type RanchFloorSpan,
} from "../structure/interior";
import { displacedRoofVerts } from "../structure/roof";
import type { Building, Cell, InteriorFixture, RoofSection } from "../structure/types";
import { cellPresent } from "../structure/types";
import { depthKey } from "../world/iso";
import { drawFaceWindow, drawIsoBox, drawShadow, drawTopCap, shade } from "./drawIso";
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

function columnSouthOpen(b: Building, gx: number): boolean {
  const top = b.floors - 1;
  const cell = b.grid[top]?.[gx]?.[b.d - 1];
  return !cell || !cellPresent(cell);
}

export function ranchRoofCutaway(b: Building, roof: RoofSection): boolean {
  if (!hasFurnishedInterior(b)) return false;
  if (roof.state === "gone") return false;
  if (roof.state === "falling") return false;
  const top = b.floors - 1;
  return roof.support.some((s) => {
    const cell = b.grid[top]?.[s.gx]?.[s.gy];
    if (!cell || !cellPresent(cell)) return true;
    return columnSouthOpen(b, s.gx);
  });
}

function floorOpen(b: Building, gx: number, gy: number, floor: number): boolean {
  if (gx < 0 || gy < 0 || gx >= b.w || gy >= b.d) return true;
  return !cellDrawsRanchFloor(b, gx, gy, floor);
}

function drawBrokenFloorEdge(
  g: Graphics,
  b: Building,
  gx: number,
  gy: number,
  floor: number,
  edge: number,
  alpha: number,
): void {
  const cs = b.cellSize;
  const x = b.x + gx * cs;
  const y = b.y + gy * cs;
  const z0 = floor * FLOOR_Z;
  const z1 = z0 + FLOOR_H;
  if (floorOpen(b, gx, gy + 1, floor)) {
    drawFaceWindow(g, x, y + cs, x + cs, y + cs, z0, z1, 0, 1, 0, 1, edge, alpha);
    const j = jag(gx, gy, 1);
    drawIsoBox(g, x + 0.06, y + cs - 0.07 + j, cs * 0.88, 0.1, z0, FLOOR_H + 0.04, edge, PAL.plankDark, edge, alpha);
  }
  if (floorOpen(b, gx + 1, gy, floor)) {
    drawFaceWindow(g, x + cs, y, x + cs, y + cs, z0, z1, 0, 1, 0, 1, shade(edge, 1.08), alpha);
    const j = jag(gx, gy, 2);
    drawIsoBox(g, x + cs - 0.07 + j, y + 0.06, 0.1, cs * 0.86, z0, FLOOR_H + 0.04, edge, PAL.plankDark, edge, alpha);
  }
  if (floorOpen(b, gx - 1, gy, floor) || floorOpen(b, gx, gy - 1, floor)) {
    drawIsoBox(g, x + 0.03, y + 0.03, 0.16, 0.16, z0, 0.03, PAL.plasterShadow, PAL.plasterShadow, PAL.plasterShadow, alpha * 0.4);
  }
}

function drawRanchFloorSpan(g: Graphics, b: Building, span: RanchFloorSpan, alpha: number): void {
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
      drawBrokenFloorEdge(g, b, gx, gy, span.floor, edge, alpha);
    }
  }
}

function drawRanchWallStubs(g: Graphics, b: Building, gx: number, gy: number, floor: number, alpha: number): void {
  const cell = neighbor(b, gx, gy, floor);
  if (!cell || cell.state !== "breached") return;
  const cs = b.cellSize;
  const x = b.x + gx * cs;
  const y = b.y + gy * cs;
  const z0 = floor * FLOOR_Z;
  const h = FLOOR_Z * 0.9;
  const plaster = plasterColor();
  const shadow = plasterColor(true);
  const north = neighbor(b, gx, gy - 1, floor);
  const west = neighbor(b, gx - 1, gy, floor);
  if (north && cellPresent(north)) {
    drawIsoBox(g, x + 0.04, y, cs - 0.08, WALL_THICK, z0, h, plaster, shadow, wallFaceColor(north.material, "south", true), alpha);
    drawIsoBox(g, x + 0.04, y, cs - 0.08, 0.05, z0, 0.1, shadow, shadow, shadow, alpha * 0.5);
  }
  if (west && cellPresent(west)) {
    drawIsoBox(g, x, y + 0.04, WALL_THICK, cs - 0.08, z0, h, plaster, wallFaceColor(west.material, "east", true), shadow, alpha);
    drawIsoBox(g, x, y + 0.04, 0.05, cs - 0.08, z0, 0.1, shadow, shadow, shadow, alpha * 0.45);
  }
  const south = neighbor(b, gx, gy + 1, floor);
  const east = neighbor(b, gx + 1, gy, floor);
  if (south && cellPresent(south)) {
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
  }
  if (east && cellPresent(east)) {
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
  }
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

function drawRanchFixture(g: Graphics, b: Building, fixture: InteriorFixture, alpha: number): void {
  if (!fixtureExposed(b, fixture) && !(fixture.broken && fixtureSupported(b, fixture))) return;
  if (fixture.broken && !fixtureSupported(b, fixture)) return;
  const z0 = fixture.floor * FLOOR_Z + FLOOR_H;
  if (fixture.broken) {
    drawShadow(g, fixture.x, fixture.y, fixture.w, fixture.d, 0.12 * alpha);
    drawIsoBox(
      g,
      fixture.x + 0.04,
      fixture.y + 0.04,
      fixture.w * 0.7,
      fixture.d * 0.55,
      z0,
      Math.max(0.06, fixture.h * 0.18),
      shade(PAL.woodTop, 0.75),
      PAL.woodDark,
      PAL.wood,
      alpha,
    );
    drawIsoBox(
      g,
      fixture.x + fixture.w * 0.45,
      fixture.y + fixture.d * 0.2,
      fixture.w * 0.28,
      fixture.d * 0.22,
      z0,
      0.08,
      PAL.woodDark,
      PAL.woodDark,
      PAL.plankDark,
      alpha,
    );
    return;
  }
  drawFixtureSolid(g, fixture, z0, alpha);
}

function fixtureDepth(fixture: InteriorFixture): number {
  return depthKey(fixture.x + fixture.w * 0.5, fixture.y + fixture.d * 0.5, fixture.floor * FLOOR_Z + fixture.h * 0.45);
}

export function drawRanchRafters(g: Graphics, _b: Building, roof: RoofSection, alpha: number): void {
  const verts = displacedRoofVerts(roof);
  if (verts.length < 4) return;
  const a = verts[0]!;
  const c = verts[2]!;
  const midZ = (a.z + c.z) * 0.5 - 0.08;
  const beam = PAL.woodDark;
  const top = PAL.woodTop;
  const alongX = Math.abs(c.x - a.x) >= Math.abs(c.y - a.y);
  if (alongX) {
    const x0 = Math.min(a.x, c.x) + 0.08;
    const x1 = Math.max(a.x, c.x) - 0.08;
    const y = (a.y + c.y) * 0.5;
    const span = x1 - x0;
    for (let i = 0; i < 3; i++) {
      const t = 0.15 + i * 0.32;
      drawIsoBox(g, x0 + span * t, y - 0.05, 0.09, Math.abs(c.y - a.y) * 0.42, midZ - 0.12, 0.1, top, beam, beam, alpha);
    }
    drawIsoBox(g, x0, y - 0.04, span, 0.08, midZ - 0.02, 0.08, top, beam, beam, alpha);
    return;
  }
  const y0 = Math.min(a.y, c.y) + 0.08;
  const y1 = Math.max(a.y, c.y) - 0.08;
  const x = (a.x + c.x) * 0.5;
  const span = y1 - y0;
  for (let i = 0; i < 3; i++) {
    const t = 0.15 + i * 0.32;
    drawIsoBox(g, x - 0.05, y0 + span * t, Math.abs(c.x - a.x) * 0.42, 0.09, midZ - 0.12, 0.1, top, beam, beam, alpha);
  }
  drawIsoBox(g, x - 0.04, y0, 0.08, span, midZ - 0.02, 0.08, top, beam, beam, alpha);
}

export function ranchInteriorCmds(
  b: Building,
  fade: number,
): { depth: number; run: (g: Graphics) => void }[] {
  if (!hasFurnishedInterior(b)) return [];
  const cmds: { depth: number; run: (g: Graphics) => void }[] = [];
  const interiorFade = Math.max(fade, 0.78);
  const cs = b.cellSize;
  for (const span of ranchFloorSpans(b)) {
    const cx = b.x + (span.gx0 + span.gx1 + 1) * 0.5 * cs;
    const cy = b.y + (span.gy0 + span.gy1 + 1) * 0.5 * cs;
    cmds.push({
      depth: depthKey(cx, cy, span.floor * FLOOR_Z + 0.06),
      run: (g) => {
        drawRanchFloorSpan(g, b, span, interiorFade);
        for (let gy = span.gy0; gy <= span.gy1; gy++) {
          for (let gx = span.gx0; gx <= span.gx1; gx++) {
            drawRanchWallStubs(g, b, gx, gy, span.floor, interiorFade);
          }
        }
      },
    });
  }
  for (const fixture of b.fixtures) {
    if (!fixtureExposed(b, fixture) && !(fixture.broken && fixtureSupported(b, fixture))) continue;
    if (fixture.broken && !fixtureSupported(b, fixture)) continue;
    cmds.push({
      depth: fixtureDepth(fixture),
      run: (g) => drawRanchFixture(g, b, fixture, interiorFade),
    });
  }
  return cmds;
}
