import { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import { gableEndCaps, gableWallVerts, shedWallVerts } from "../structure/roof";
import type { Building, Cell } from "../structure/types";
import type { BreachGroup, TopSpan, WallSpan } from "./buildingSurfaces";
import { southFacadeCells } from "./buildingSurfaces";
import { hasFurnishedInterior } from "../structure/interior";
import { drawFaceWindow, drawIsoBox, drawShadow, drawTopCap, drawWorldPoly, shade } from "./drawIso";
import { drawRanchThickBrokenWall } from "./interiorDraw";
import { brokenEdgeColor, interiorColor, topFaceColor, wallFaceColor } from "./lighting";
import { matColors, PAL } from "./palette";

const STORY_H = FLOOR_Z;

function floorZ0(cell: Cell): number {
  return cell.floor * FLOOR_Z - cell.sag * 0.55 - cell.fallT * 1.6;
}

export function drawWallSpan(g: Graphics, b: Building, span: WallSpan, alpha: number): void {
  const cs = b.cellSize;
  const z0 = span.floor * FLOOR_Z;
  const z1 = z0 + STORY_H;
  const mat = span.dir === "south" && span.floor === 0 ? span.facadeMaterial : span.material;
  const color = wallFaceColor(mat, span.dir, span.visual !== "intact");
  const inset = span.visual === "broken-edge" ? 0.06 : 0;

  if (span.dir === "south") {
    const x0 = b.x + span.gx0 * cs;
    const y1 = b.y + (span.gy0 + 1) * cs - inset;
    const w = (span.gx1 - span.gx0 + 1) * cs;
    if (!drawPitchedWall(g, b, span, color, alpha, z0, x0, x0 + w, y1)) {
      drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z1, 0, 1, 0, 1, color, alpha);
    }
    if (span.floor === 0) {
      drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z1, 0, 1, 0, 0.1, PAL.foundation, alpha * 0.65);
    }
    if (span.visual === "cracked") {
      const mid = x0 + w * 0.48;
      drawFaceWindow(g, mid - 0.02, y1, mid + 0.02, y1, z0, z1, 0, 1, 0.2, 0.85, PAL.crack, alpha * 0.55);
    }
    if (span.visual === "broken-edge") {
      drawRanchThickBrokenWall(g, b, "south", x0, y1, w, z0, mat, alpha);
    }
    if (span.floor === 0) drawSouthFacadeDecor(g, b, span, alpha);
    return;
  }

  const x1 = b.x + (span.gx0 + 1) * cs - inset;
  const y0 = b.y + span.gy0 * cs;
  const d = (span.gy1 - span.gy0 + 1) * cs;
  if (!drawPitchedWall(g, b, span, color, alpha, z0, y0, y0 + d, x1)) {
    drawFaceWindow(g, x1, y0, x1, y0 + d, z0, z1, 0, 1, 0, 1, color, alpha);
  }
  if (span.floor === 0) {
    drawFaceWindow(g, x1, y0, x1, y0 + d, z0, z1, 0, 1, 0, 0.1, PAL.foundation, alpha * 0.5);
  }
  if (span.visual === "broken-edge") {
    drawRanchThickBrokenWall(g, b, "east", x1, y0, d, z0, mat, alpha);
  }
  drawEastWindows(g, b, span, alpha, z0, z1);
}

function drawPitchedWall(
  g: Graphics,
  b: Building,
  span: WallSpan,
  color: number,
  alpha: number,
  z0: number,
  along0: number,
  along1: number,
  plane: number,
): boolean {
  if (span.floor !== b.floors - 1) return false;
  const cap = gableEndCaps(b).find((c) => c.face === span.dir);
  if (cap) {
    drawWorldPoly(g, gableWallVerts(cap, along0, along1, plane, z0), color, alpha);
    return true;
  }
  const shed = shedWallVerts(b, span.dir, along0, along1, plane, z0);
  if (!shed) return false;
  drawWorldPoly(g, shed, color, alpha);
  return true;
}

function drawEastWindows(
  g: Graphics,
  b: Building,
  span: WallSpan,
  alpha: number,
  z0: number,
  z1: number,
): void {
  const cs = b.cellSize;
  const x1 = b.x + (span.gx0 + 1) * cs;
  for (let gy = span.gy0; gy <= span.gy1; gy++) {
    const cell = b.grid[span.floor]![span.gx0]![gy]!;
    if (!cell.windowE) continue;
    const y0 = b.y + gy * cs;
    const glass = cell.state === "cracked" ? PAL.glass : PAL.glassLit;
    drawFaceWindow(g, x1, y0, x1, y0 + cs, z0, z1, 0.28, 0.72, 0.28, 0.72, glass, alpha);
  }
}

function drawSouthFacadeDecor(g: Graphics, b: Building, span: WallSpan, alpha: number): void {
  const cs = b.cellSize;
  const z0 = span.floor * FLOOR_Z;
  const cells = southFacadeCells(b, span);
  const spanW = span.gx1 - span.gx0 + 1;
  const y1 = b.y + (span.gy0 + 1) * cs;

  for (const cell of cells) {
    const x0 = b.x + cell.gx * cs;
    const u0 = (cell.gx - span.gx0) / spanW;
    const u1 = (cell.gx - span.gx0 + 1) / spanW;

    if (cell.loadingS || (b.theme === "warehouse" && cell.loadingS)) {
      drawFramedBay(g, x0, y1, cs, z0, STORY_H, PAL.metalDark, PAL.frame, alpha, 0.04, 0.9);
      drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.12, 0.88, 0.08, 0.78, PAL.metal, alpha * 0.85);
      continue;
    }

    if (cell.doorS) {
      if (b.features.garage && cell.gx >= b.w - 2) {
        drawFramedBay(g, x0, y1, cs, z0, STORY_H, PAL.woodDark, PAL.frame, alpha, 0.05, 0.92);
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.1, 0.9, 0.1, 0.82, PAL.woodDark, alpha);
      } else if (b.theme === "storefront" || b.theme === "corner") {
        drawFramedBay(g, x0, y1, cs, z0, STORY_H, PAL.glass, PAL.frame, alpha, 0.08, 0.88);
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.12, 0.88, 0.05, 0.72, PAL.glassLit, alpha * 0.9);
      } else if (b.theme === "civic") {
        drawFramedBay(g, x0, y1, cs, z0, STORY_H, PAL.concreteDark, PAL.frame, alpha, 0.1, 0.85);
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.15, 0.85, 0.05, 0.7, PAL.concrete, alpha);
      } else {
        drawFramedBay(g, x0, y1, cs, z0, STORY_H, PAL.woodDark, PAL.frame, alpha, 0.28, 0.68);
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.32, 0.68, 0.02, 0.58, PAL.woodDark, alpha);
      }
      if (b.features.awning) {
        drawIsoBox(g, x0 - 0.04, y1 - cs * 0.28, cs + 0.08, 0.38, z0 + STORY_H * 0.62, 0.1, PAL.awning, PAL.brickDark, PAL.awning, alpha);
      }
      if (b.features.porch) {
        drawIsoBox(g, x0 + cs * 0.15, y1 - cs * 0.18, cs * 0.7, 0.55, 0, 0.12, PAL.woodTop, PAL.woodDark, PAL.wood, alpha);
      }
      continue;
    }

    if (cell.windowS || (b.theme === "colonial" && span.floor > 0)) {
      const glass = cell.state === "cracked" ? PAL.glass : PAL.glassLit;
      if (b.theme === "colonial") {
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.18, 0.46, 0.32, 0.7, glass, alpha);
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.54, 0.82, 0.32, 0.7, glass, alpha);
      } else if (b.theme === "storefront" || b.theme === "corner") {
        drawFramedBay(g, x0, y1, cs, z0, STORY_H, glass, PAL.frame, alpha, 0.06, 0.88);
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.1, 0.9, 0.2, 0.78, glass, alpha * 0.92);
      } else if (b.theme === "civic") {
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.2, 0.8, 0.25, 0.72, glass, alpha);
      } else {
        drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0.28, 0.72, 0.28, 0.72, glass, alpha);
      }
    }

    if (span.material === "brick" || b.theme === "colonial" || b.theme === "corner") {
      void u0;
      void u1;
      drawFaceWindow(g, x0, y1, x0 + cs, y1, z0, z0 + STORY_H, 0, 1, 0.46, 0.54, wallFaceColor(span.facadeMaterial, "south"), alpha * 0.22);
    }
  }
}

function drawFramedBay(
  g: Graphics,
  x0: number,
  y1: number,
  w: number,
  z0: number,
  h: number,
  fill: number,
  frame: number,
  alpha: number,
  u0: number,
  u1: number,
): void {
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u0, u1, 0, 0.08, frame, alpha);
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u0, u1, 0.92, 1, frame, alpha);
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u0, u0 + 0.04, 0, 1, frame, alpha);
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u1 - 0.04, u1, 0, 1, frame, alpha);
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u0 + 0.04, u1 - 0.04, 0.08, 0.88, fill, alpha * 0.75);
}

export function drawTopSpan(g: Graphics, b: Building, span: TopSpan, alpha: number): void {
  const cs = b.cellSize;
  const x = b.x + span.gx0 * cs;
  const y = b.y + span.gy0 * cs;
  const w = (span.gx1 - span.gx0 + 1) * cs;
  const d = cs;
  const z = span.floor * FLOOR_Z + STORY_H;
  const color = topFaceColor(span.material, span.visual === "cracked");
  drawTopCap(g, x, y, w, d, z, color, alpha);
}

export function drawBreachGroup(g: Graphics, b: Building, group: BreachGroup, alpha: number): void {
  const cs = b.cellSize;
  const recess = 0.14;
  let minGx = group.cells[0]!.gx;
  let maxGx = group.cells[0]!.gx;
  let minGy = group.cells[0]!.gy;
  let maxGy = group.cells[0]!.gy;
  for (const p of group.cells) {
    minGx = Math.min(minGx, p.gx);
    maxGx = Math.max(maxGx, p.gx);
    minGy = Math.min(minGy, p.gy);
    maxGy = Math.max(maxGy, p.gy);
  }
  if (hasFurnishedInterior(b)) return;
  const x0 = b.x + minGx * cs + recess;
  const y0 = b.y + minGy * cs + recess;
  const w = (maxGx - minGx + 1) * cs - recess * 2;
  const d = (maxGy - minGy + 1) * cs - recess * 2;
  const z0 = group.floor * FLOOR_Z;
  const edge = brokenEdgeColor(group.material);
  const floor = shade(matColors(group.material).top, 0.62);
  drawIsoBox(g, x0, y0, w, d, z0, 0.12, floor, shade(floor, 0.78), shade(floor, 0.7), alpha);
  drawFaceWindow(g, x0, y0 + d, x0 + w, y0 + d, z0, z0 + STORY_H * 0.22, 0, 1, 0, 1, edge, alpha * 0.7);
  drawFaceWindow(g, x0 + w, y0, x0 + w, y0 + d, z0, z0 + STORY_H * 0.22, 0, 1, 0, 1, edge, alpha * 0.6);
  if (group.floor > 0) {
    drawFaceWindow(g, x0, y0 + d, x0 + w, y0 + d, z0, z0 + 0.18, 0, 1, 0, 1, PAL.concrete, alpha * 0.7);
  }
}

export function drawFallingCell(g: Graphics, b: Building, cell: Cell, alpha: number): void {
  const cs = b.cellSize;
  const x = b.x + cell.gx * cs + cell.fallDx * cell.fallT * 0.85;
  const y = b.y + cell.gy * cs + cell.fallDy * cell.fallT * 0.85;
  const z0 = floorZ0(cell);
  const h = STORY_H * 0.92;
  const mat = cell.material;
  const top = topFaceColor(mat, true);
  const left = wallFaceColor(mat, "south", true);
  const right = wallFaceColor(mat, "east", true);
  drawIsoBox(g, x + cs * 0.08, y + cs * 0.08, cs * 0.84, cs * 0.84, z0, h * 0.55, interiorColor(), interiorColor(), interiorColor(), alpha);
  drawIsoBox(g, x, y, cs * 0.22, cs, z0, h * 0.7, top, left, right, alpha);
  drawIsoBox(g, x + cs * 0.78, y, cs * 0.22, cs, z0, h * 0.65, top, left, right, alpha);
  drawIsoBox(g, x + 0.1, y + 0.1, cs * 0.5, cs * 0.4, z0 + h * 0.2, h * 0.25, top, left, right, alpha * 0.85);
}

export function drawBuildingFootprintShadow(
  g: Graphics,
  footprint: { x: number; y: number; w: number; d: number },
  alpha: number,
): void {
  drawShadow(g, footprint.x, footprint.y, footprint.w, footprint.d, 0.2 * alpha);
}
