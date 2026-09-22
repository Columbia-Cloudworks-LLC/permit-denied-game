import { worldBoundsToScreen } from "../world/iso";
import type { Town } from "../world/town";

const HUD_TOP = 96;
const HUD_BOTTOM = 132;

/** Frame the whole surface, kept clear of the top bar and instrument deck. */
export function frameTownOverview(
  town: Town,
  viewW: number,
  viewH: number,
): { camX: number; camY: number; zoom: number } {
  const pad = 6;
  const surface = town.surface;
  let minX = surface ? surface.ox - pad : town.minX - pad;
  let minY = surface ? surface.oy - pad : town.minY - pad;
  let maxX = surface ? surface.ox + surface.cols * surface.cell + pad : town.maxX + pad;
  let maxY = surface ? surface.oy + surface.rows * surface.cell + pad : town.maxY + pad;
  for (const building of town.buildings) {
    minX = Math.min(minX, building.x - pad);
    minY = Math.min(minY, building.y - pad);
    maxX = Math.max(maxX, building.x + building.w * building.cellSize + pad);
    maxY = Math.max(maxY, building.y + building.d * building.cellSize + pad);
  }
  const tallest = Math.max(2, ...town.buildings.map((building) => building.floors * 0.45 + 1.5));
  const box = worldBoundsToScreen(minX, minY, Math.max(8, maxX - minX), Math.max(8, maxY - minY), 0, tallest);
  const spanX = Math.max(1, box.maxX - box.minX);
  const spanY = Math.max(1, box.maxY - box.minY);
  const playW = Math.max(160, viewW);
  const playH = Math.max(160, viewH - HUD_TOP - HUD_BOTTOM);
  const zoom = Math.min(0.95, Math.max(0.1, 0.9 * Math.min(playW / spanX, playH / spanY)));
  const playCenterY = (HUD_TOP + (viewH - HUD_BOTTOM)) / 2;
  const screenCenterY = viewH / 2;
  return {
    zoom,
    camX: ((box.minX + box.maxX) / 2) * zoom,
    camY: ((box.minY + box.maxY) / 2) * zoom + (screenCenterY - playCenterY),
  };
}
