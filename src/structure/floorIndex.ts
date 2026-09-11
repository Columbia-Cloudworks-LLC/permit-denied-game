import type { Building, FloorTile } from './types';

// References to mutable tile state; no per-frame copying or per-fixture full-building scans.
const cache = new WeakMap<Building, ReturnType<typeof indexFloors>>();
function indexFloors(b: Building) {
  const byFloor = Array.from({ length: b.floors }, () => [] as FloorTile[]);
  const columns = Array.from({ length: b.w * b.d }, () => [] as FloorTile[]);
  const tiles: (FloorTile | undefined)[] = new Array(b.floors * b.w * b.d);
  for (const tile of b.floorTiles) {
    byFloor[tile.floor]!.push(tile);
    columns[tile.gx * b.d + tile.gy]!.push(tile);
    tiles[tile.floor * b.w * b.d + tile.gx * b.d + tile.gy] = tile;
  }
  return { source: b.floorTiles, length: b.floorTiles.length, byFloor, columns,
    at: (floor: number, gx: number, gy: number) => tiles[floor * b.w * b.d + gx * b.d + gy] };
}
export function floorIndex(b: Building) {
  let index = cache.get(b);
  if (!index || index.source !== b.floorTiles || index.length !== b.floorTiles.length) {
    index = indexFloors(b); cache.set(b, index);
  }
  return index;
}
export function releaseFloorIndex(b: Building): void { cache.delete(b); }
