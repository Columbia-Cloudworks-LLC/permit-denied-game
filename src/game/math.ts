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

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
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
