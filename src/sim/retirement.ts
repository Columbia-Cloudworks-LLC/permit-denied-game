import { releaseInteriorCache } from '../structure/interior';
import { DEBRIS } from '../game/constants';
import type { Town } from '../world/town';
import type { Dozer } from '../vehicle/dozer';

/** Debris owns broken objects; the site owns the aftermath of a retired structure. */
export function retireStructures(town: Town, dozer: Dozer, dt: number): number {
  let retired = 0;
  for (const b of town.buildings) {
    if (b.retired) continue;
    if (b.fixtures.some(f => f.broken)) {
      b.fixtures = b.fixtures.filter(f => !f.broken);
      b.visualRevision++;
      b.collisionDirty = true;
    }
    const dx = Math.max(b.x - dozer.x, 0, dozer.x - (b.x + b.w * b.cellSize));
    const dy = Math.max(b.y - dozer.y, 0, dozer.y - (b.y + b.d * b.cellSize));
    if (!b.fullyDown || !b.collapseBonusPaid || Math.hypot(dx, dy) <= DEBRIS.retireRadius) {
      b.settledAwayTime = 0;
      continue;
    }
    b.settledAwayTime += dt;
    if (b.settledAwayTime < DEBRIS.retireDelay) continue;
    if (!town.collapsedSites.some(s => s.buildingId === b.id)) continue;
    b.cells = []; b.grid = []; b.roofs = []; b.floorTiles = []; b.fixtures = []; b.decorBoxes = [];
    releaseInteriorCache(b);
    b.retired = true;
    retired++;
    b.visualRevision++;
    b.collisionDirty = true;
  }
  return retired;
}
