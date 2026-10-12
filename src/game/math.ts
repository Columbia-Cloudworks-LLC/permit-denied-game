export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

export function norm(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  if (l < 1e-8) return [0, 0];
  return [x / l, y / l];
}

export function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ad: number,
  bx: number,
  by: number,
  bw: number,
  bd: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bd && ay + ad > by;
}

export function circleAabb(
  cx: number,
  cy: number,
  r: number,
  x: number,
  y: number,
  w: number,
  d: number,
): { hit: boolean; nx: number; ny: number; depth: number } {
  const qx = clamp(cx, x, x + w);
  const qy = clamp(cy, y, y + d);
  const dx = cx - qx;
  const dy = cy - qy;
  const dist = Math.hypot(dx, dy);
  if (dist >= r) return { hit: false, nx: 0, ny: 0, depth: 0 };
  if (dist < 1e-6) {
    const left = cx - x;
    const right = x + w - cx;
    const top = cy - y;
    const bot = y + d - cy;
    const m = Math.min(left, right, top, bot);
    if (m === left) return { hit: true, nx: -1, ny: 0, depth: r + left };
    if (m === right) return { hit: true, nx: 1, ny: 0, depth: r + right };
    if (m === top) return { hit: true, nx: 0, ny: -1, depth: r + top };
    return { hit: true, nx: 0, ny: 1, depth: r + bot };
  }
  return { hit: true, nx: dx / dist, ny: dy / dist, depth: r - dist };
}

export function pointInAabb(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  d: number,
): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + d;
}

export function pointInPoly(px: number, py: number, poly: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const hit = a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y + 1e-9) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby + 1e-8), 0, 1);
  return len(px - (ax + abx * t), py - (ay + aby * t));
}

/** Corners of a `length` x `width` rectangle centred on (cx, cy), long axis along `heading`. */
export function orientedRect(
  cx: number,
  cy: number,
  heading: number,
  length: number,
  width: number,
): { x: number; y: number }[] {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const hl = length * 0.5;
  const hw = width * 0.5;
  return [
    { x: cx + fx * hl - fy * hw, y: cy + fy * hl + fx * hw },
    { x: cx + fx * hl + fy * hw, y: cy + fy * hl - fx * hw },
    { x: cx - fx * hl + fy * hw, y: cy - fy * hl - fx * hw },
    { x: cx - fx * hl - fy * hw, y: cy - fy * hl + fx * hw },
  ];
}

export function pointBounds(points: readonly { x: number; y: number }[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Separating-axis test for two convex polygons. Only a gap wider than 1e-4 separates them, so touching counts as overlapping. */
export function convexOverlap(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): boolean {
  return !separatingAxis(a, b) && !separatingAxis(b, a);
}

function separatingAxis(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    if (separatedAlong(a, b, p.y - q.y, q.x - p.x)) return true;
  }
  return false;
}

/** The two point sets project to disjoint ranges on the axis (nx, ny). */
function separatedAlong(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[], nx: number, ny: number): boolean {
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (const v of a) {
    const d = v.x * nx + v.y * ny;
    if (d < minA) minA = d;
    if (d > maxA) maxA = d;
  }
  for (const v of b) {
    const d = v.x * nx + v.y * ny;
    if (d < minB) minB = d;
    if (d > maxB) maxB = d;
  }
  return maxA < minB - 1e-4 || maxB < minA - 1e-4;
}
