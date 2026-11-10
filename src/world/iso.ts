import { ISO_H, ISO_W, ISO_Z } from "../game/constants";

export function worldToScreen(x: number, y: number, z = 0): { x: number; y: number } {
  return {
    x: (x - y) * ISO_W,
    y: (x + y) * ISO_H - z * ISO_Z,
  };
}

export function screenToWorld(sx: number, sy: number, z = 0): { x: number; y: number } {
  const adjY = sy + z * ISO_Z;
  return {
    x: adjY / ISO_H / 2 + sx / ISO_W / 2,
    y: adjY / ISO_H / 2 - sx / ISO_W / 2,
  };
}

export function depthKey(x: number, y: number, z = 0): number {
  return (x + y) * 1000 + z * 2;
}

/** Front-most vertex so a sloped roof paints after the walls under its eave. */
export function roofPainterDepth(verts: { x: number; y: number; z: number }[]): number {
  let best = -Infinity;
  for (const v of verts) {
    const d = depthKey(v.x, v.y, v.z);
    if (d > best) best = d;
  }
  return best;
}

export interface ScreenAabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Screen bounds of an axis-aligned world box. Projection is monotonic in x - y and x + y,
 * so the extremes come straight from the box's extents with no corner list.
 */
export function worldBoundsToScreen(
  x: number,
  y: number,
  w: number,
  d: number,
  z0 = 0,
  z1 = 0,
): ScreenAabb {
  const x0 = Math.min(x, x + w), x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + d), y1 = Math.max(y, y + d);
  return {
    minX: (x0 - y1) * ISO_W,
    minY: (x0 + y0) * ISO_H - Math.max(z0, z1) * ISO_Z,
    maxX: (x1 - y0) * ISO_W,
    maxY: (x1 + y1) * ISO_H - Math.min(z0, z1) * ISO_Z,
  };
}

/** Screen-space bounds of world points given as [x, y, z]. */
export function screenBoundsOf(points: readonly (readonly [number, number, number])[]): ScreenAabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [wx, wy, z] of points) {
    const s = worldToScreen(wx, wy, z);
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  return { minX, minY, maxX, maxY };
}

export function screenAabbVisible(
  box: ScreenAabb,
  viewW: number,
  viewH: number,
  camX: number,
  camY: number,
  zoom: number,
  pad = 64,
): boolean {
  const left = viewW * 0.5 - camX + box.minX * zoom;
  const right = viewW * 0.5 - camX + box.maxX * zoom;
  const top = viewH * 0.5 - camY + box.minY * zoom;
  const bottom = viewH * 0.5 - camY + box.maxY * zoom;
  return right > -pad && left < viewW + pad && bottom > -pad && top < viewH + pad;
}

export function isoQuad(
  x: number,
  y: number,
  w: number,
  d: number,
  z: number,
): [number, number, number, number, number, number, number, number] {
  const a = worldToScreen(x, y, z);
  const b = worldToScreen(x + w, y, z);
  const c = worldToScreen(x + w, y + d, z);
  const e = worldToScreen(x, y + d, z);
  return [a.x, a.y, b.x, b.y, c.x, c.y, e.x, e.y];
}
