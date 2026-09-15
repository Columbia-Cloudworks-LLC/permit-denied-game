import type { Building } from "../structure/types";
import { getBuildingSurfaces, type WallSpan } from "./buildingSurfaces";
import { wallSpanFadeRuns, type OccludeDozer } from "./occlusion";

/** One cell per command so a long east/south run cannot sort behind a nearer floor tile. */
export function splitWallSpan(span: WallSpan): WallSpan[] {
  const count = span.dir === "south" ? span.gx1 - span.gx0 + 1 : span.gy1 - span.gy0 + 1;
  if (count <= 1) return [span];
  return Array.from({ length: count }, (_, i) => ({
    ...span,
    gx0: span.gx0 + (span.dir === "south" ? i : 0),
    gx1: span.gx0 + (span.dir === "south" ? i : 0),
    gy0: span.gy0 + (span.dir === "east" ? i : 0),
    gy1: span.gy0 + (span.dir === "east" ? i : 0),
  }));
}

export function wallPaintSpans(b: Building): WallSpan[] {
  return getBuildingSurfaces(b).walls.flatMap(splitWallSpan);
}

/** Painter depths the shared wall path actually submits, including fade-run face depth. */
export function wallPaintDepths(b: Building, dozer: OccludeDozer): { span: WallSpan; depth: number; fade: number }[] {
  const out: { span: WallSpan; depth: number; fade: number }[] = [];
  for (const span of wallPaintSpans(b)) {
    for (const run of wallSpanFadeRuns(b, span, dozer)) {
      out.push({ span: run.span, depth: run.span.depth, fade: run.fade });
    }
  }
  return out;
}
