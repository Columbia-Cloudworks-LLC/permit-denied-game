import { worldToScreen } from "../world/iso";

/** Camera offsets are CSS pixels, matching the scaled world in layout/culling. */
export function cameraFocus(x: number, y: number, z: number, zoom: number) {
  const p = worldToScreen(x, y, z);
  return { x: p.x * zoom, y: p.y * zoom };
}
