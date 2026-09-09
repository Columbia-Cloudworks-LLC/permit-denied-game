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
