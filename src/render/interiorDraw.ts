import { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import {
  fixtureCatalog,
  fixtureExposed,
  interiorFloorCoverage,
  type InteriorFloorSpan,
} from "../structure/interior";
import { industrialRoofOpen, neighborRoofBayOpen, roofFrameBeams } from "../structure/roof";
import type { Building, Cell, InteriorFixture, RoofSection } from "../structure/types";
import { cellPresent, cellWorldBox } from "../structure/types";
import { depthKey, roofPainterDepth } from "../world/iso";
import { drawFaceWindow, drawIsoBox, drawOrientedIsoBox, drawSlopedQuad, drawTopCap, shade } from "./drawIso";
import { brokenEdgeColor, floorFinishColor, topFaceColor, wallFaceColor } from "./lighting";
import { PAL } from "./palette";

const WALL_THICK = 0.16;
const FLOOR_H = 0.18;
/** Overlap into the south/east neighbor so iso seams do not open a gutter. */
const FLOOR_SEAM = 0.03;

function jag(gx: number, gy: number, k: number): number {
  return (((gx * 13 + gy * 7 + k * 5) % 7) - 3) * 0.018;
}

/** Framing is drawn behind covering, so it only reads at openings or undersides. */
export function roofShowsFrame(b: Building, roof: RoofSection): boolean {
  if (roof.state === "gone") return false;
  if (roof.state === "sagging" || roof.state === "falling") return true;
  if (roof.bay) return industrialRoofOpen(b, roof);
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

export function drawThickBrokenWall(
  g: Graphics,
  _b: Building,
  dir: "south" | "east",
  x0: number,
  y0: number,
  along: number,
  z0: number,
  mat: Cell["material"],
  alpha: number,
): void {
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
  const swapped = Math.abs(Math.sin(fixture.heading)) > .5;
  const w = swapped ? fixture.d : fixture.w, d = swapped ? fixture.w : fixture.d;
  const cos = Math.cos(fixture.heading), sin = Math.sin(fixture.heading);
  for (const box of def.boxes) {
    drawOrientedIsoBox(g,
      fixture.x + fixture.w / 2 + cos * box.along * w - sin * box.across * d,
      fixture.y + fixture.d / 2 + sin * box.along * w + cos * box.across * d,
      fixture.heading, box.len * w, box.wid * d, z0 + box.z * fixture.h, box.h * fixture.h * (1 - fixture.pose.crush * .4),
      box.top, box.left, box.right, alpha);
  }
}

function drawInteriorFixture(g: Graphics, b: Building, fixture: InteriorFixture, alpha: number, reveal = false): void {
  if (fixture.broken || (!reveal && !fixtureExposed(b, fixture))) return;
  const z0 = fixture.floor * FLOOR_Z + FLOOR_H;

  drawFixtureSolid(g, fixture, z0, alpha);
}

function fixtureDepth(fixture: InteriorFixture): number {
  return depthKey(fixture.x + fixture.w * 0.5, fixture.y + fixture.d * 0.5, fixture.floor * FLOOR_Z + fixture.h * 0.45);
}

/** Long racks/partitions can sort ahead of a small panel above their rear end. */
export function roofInteriorPainterDepth(b: Building, roof: RoofSection, verts: RoofSection["verts"]): number {
  let depth = roofPainterDepth(verts);
  if (!roof.bay || roof.state === "falling") return depth;
  const x0 = Math.min(...verts.map(v => v.x)), x1 = Math.max(...verts.map(v => v.x));
  const y0 = Math.min(...verts.map(v => v.y)), y1 = Math.max(...verts.map(v => v.y));
  for (const fixture of b.fixtures) {
    if (fixture.broken || fixture.floor > roof.floor) continue;
    if (fixture.x < x1 && fixture.x + fixture.w > x0 && fixture.y < y1 && fixture.y + fixture.d > y0) {
      depth = Math.max(depth, fixtureDepth(fixture) + 1);
    }
  }
  return depth;
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
  const top = roof.bay ? PAL.roofMetal : PAL.woodTop;
  const side = roof.bay ? PAL.metalDark : PAL.woodDark;
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
  const cmds: { depth: number; kind: InteriorDrawKind; run: (g: Graphics) => void }[] = [];
  const interiorFade = fade;
  const localFade = (key: string, x: number, y: number, w: number, d: number, z: number, top: number) =>
    interiorFade * (options.fadeBox?.(key, x, y, w, d, z, top) ?? 1);
  const maxFloor = options.maxFloor ?? Infinity;
  const coverage = interiorFloorCoverage(b, options.reveal);
  {
    for (const tile of b.floorTiles) {
      if (tile.state !== "falling" || tile.floor > maxFloor) continue;
      const cs = b.cellSize, x = b.x + tile.gx * cs, y = b.y + tile.gy * cs;
      const z = tile.floor * FLOOR_Z * (1 - tile.fallT);
      const mat = b.construction.floor;
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
      if (!cell.exterior.north && !cell.exterior.west) continue;
      const cs = b.cellSize, x = b.x + cell.gx * cs, y = b.y + cell.gy * cs;
      const alpha = localFade(`stub:${cell.floor}:${cell.gx}:${cell.gy}`, x, y,
        cell.exterior.north ? cs : WALL_THICK, cell.exterior.north ? WALL_THICK : cs,
        cell.floor * FLOOR_Z, (cell.floor + 1) * FLOOR_Z);
      cmds.push({ kind: "stub", depth: depthKey(x + (cell.exterior.north ? cs / 2 : WALL_THICK / 2),
        y + (cell.exterior.north ? WALL_THICK / 2 : cs / 2), cell.floor * FLOOR_Z), run: g => {
        const north = cell.exterior.north;
        const mat = b.construction.structure;
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
  }
  for (const fixture of b.fixtures) {
    if (fixture.broken || fixture.floor > maxFloor) continue;
    const exposed = fixture.support.some(s => coverage.hasFloor(s.gx, s.gy, fixture.floor));
    if (!options.reveal && !exposed) continue;
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
