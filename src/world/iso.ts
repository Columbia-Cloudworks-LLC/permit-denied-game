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

export interface ScreenAabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function worldBoundsToScreen(
  x: number,
  y: number,
  w: number,
  d: number,
  z0 = 0,
  z1 = 0,
): ScreenAabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corners: [number, number, number][] = [
    [x, y, z0],
    [x + w, y, z0],
    [x + w, y + d, z0],
    [x, y + d, z0],
    [x, y, z1],
    [x + w, y, z1],
    [x + w, y + d, z1],
    [x, y + d, z1],
  ];
  for (const [wx, wy, z] of corners) {
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
