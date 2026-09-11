import { DOZER, FLOOR_Z } from "../game/constants";
import type { Building } from "../structure/types";
import { depthKey, type ScreenAabb, worldBoundsToScreen, worldToScreen } from "../world/iso";
import type { WallSpan } from "./buildingSurfaces";

export const WALL_OCCLUDE_ALPHA = 0.38;
/** World distance from the dozer to a camera-facing wall plane. */
export const WALL_OCCLUDE_NEAR = 2.55;
/** Extra reach past the wall segment so a blade or corner still counts. */
const WALL_OCCLUDE_ALONG_PAD = 0.9;
const PLANE_IN_FRONT = 0.16;
const SCREEN_PAD = 8;
const DOZER_Z1 = 1.48;

export interface OccludeDozer {
  x: number;
  y: number;
  heading: number;
}

function aabbOverlap(a: ScreenAabb, b: ScreenAabb, pad: number): boolean {
  return a.minX <= b.maxX + pad && a.maxX >= b.minX - pad && a.minY <= b.maxY + pad && a.maxY >= b.minY - pad;
}

function dozerScreenAabb(d: OccludeDozer): ScreenAabb {
  const fx = Math.cos(d.heading);
  const fy = Math.sin(d.heading);
  const hl = DOZER.length * 0.5;
  const hw = DOZER.width * 0.5;
  const pts: [number, number, number][] = [];
  for (const along of [-hl, hl]) {
    for (const across of [-hw, hw]) {
      pts.push([d.x + fx * along - fy * across, d.y + fy * along + fx * across, 0]);
      pts.push([d.x + fx * along - fy * across, d.y + fy * along + fx * across, DOZER_Z1]);
    }
  }
  const reach = DOZER.bladeReach;
  for (const across of [-DOZER.bladeHalf, DOZER.bladeHalf]) {
    pts.push([d.x + fx * reach - fy * across, d.y + fy * reach + fx * across, 0]);
    pts.push([d.x + fx * reach - fy * across, d.y + fy * reach + fx * across, 0.7]);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y, z] of pts) {
    const s = worldToScreen(x, y, z);
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Fade a single south/east cell face if it sits in front of the dozer and covers it. */
export function wallCellOcclusionFade(
  b: Building,
  dir: "south" | "east",
  gx: number,
  gy: number,
  floor: number,
  dozer: OccludeDozer,
): number {
  const cs = b.cellSize;
  const z0 = floor * FLOOR_Z;
  const z1 = z0 + FLOOR_Z;
  let planeDist: number;
  let alongHit: boolean;
  let aabb: ScreenAabb;
  if (dir === "south") {
    const x0 = b.x + gx * cs;
    const x1 = x0 + cs;
    const yPlane = b.y + (gy + 1) * cs;
    planeDist = yPlane - dozer.y;
    alongHit = dozer.x >= x0 - WALL_OCCLUDE_ALONG_PAD && dozer.x <= x1 + WALL_OCCLUDE_ALONG_PAD;
    aabb = worldBoundsToScreen(x0, yPlane - 0.04, cs, 0.08, z0, z1);
  } else {
    const xPlane = b.x + (gx + 1) * cs;
    const y0 = b.y + gy * cs;
    const y1 = y0 + cs;
    planeDist = xPlane - dozer.x;
    alongHit = dozer.y >= y0 - WALL_OCCLUDE_ALONG_PAD && dozer.y <= y1 + WALL_OCCLUDE_ALONG_PAD;
    aabb = worldBoundsToScreen(xPlane - 0.04, y0, 0.08, cs, z0, z1);
  }
  if (planeDist < PLANE_IN_FRONT || planeDist > WALL_OCCLUDE_NEAR) return 1;
  if (!alongHit) return 1;
  if (!aabbOverlap(aabb, dozerScreenAabb(dozer), SCREEN_PAD)) return 1;
  return WALL_OCCLUDE_ALPHA;
}

function sliceWallSpan(span: WallSpan, a: number, b: number, depth: number): WallSpan {
  if (span.dir === "south") return { ...span, gx0: a, gx1: b, depth };
  return { ...span, gy0: a, gy1: b, depth };
}

/** Consecutive same-fade cells so a merged facade only ghosts the blocking run. */
export function wallSpanFadeRuns(
  b: Building,
  span: WallSpan,
  dozer: OccludeDozer,
): { span: WallSpan; fade: number }[] {
  const cs = b.cellSize;
  const along0 = span.dir === "south" ? span.gx0 : span.gy0;
  const along1 = span.dir === "south" ? span.gx1 : span.gy1;
  const runs: { span: WallSpan; fade: number }[] = [];
  let run0 = along0;
  let runFade = wallCellOcclusionFade(
    b,
    span.dir,
    span.dir === "south" ? along0 : span.gx0,
    span.dir === "south" ? span.gy0 : along0,
    span.floor,
    dozer,
  );
  for (let i = along0 + 1; i <= along1 + 1; i++) {
    const fade =
      i <= along1
        ? wallCellOcclusionFade(
            b,
            span.dir,
            span.dir === "south" ? i : span.gx0,
            span.dir === "south" ? span.gy0 : i,
            span.floor,
            dozer,
          )
        : Number.NaN;
    if (fade === runFade) continue;
    const gx0 = span.dir === "south" ? run0 : span.gx0;
    const gx1 = span.dir === "south" ? i - 1 : span.gx0;
    const gy0 = span.dir === "south" ? span.gy0 : run0;
    const gy1 = span.dir === "south" ? span.gy0 : i - 1;
    const depth = depthKey(
      b.x + ((gx0 + gx1 + 1) * 0.5) * cs,
      b.y + ((gy0 + gy1 + 1) * 0.5) * cs,
      span.floor * FLOOR_Z,
    );
    runs.push({ span: sliceWallSpan(span, run0, i - 1, depth), fade: runFade });
    run0 = i;
    runFade = fade;
  }
  return runs;
}
