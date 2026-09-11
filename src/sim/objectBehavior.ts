import type { AssetDef } from '../world/catalog';
import type { PropPose } from '../structure/types';

export interface DamageableObject { hp: number; broken: boolean; pose: PropPose }
/** The same material response applies to room furnishings and outdoor placements. */
export function hitObject(object: DamageableObject, def: AssetDef, amount: number, nx: number, ny: number): void {
  if (object.broken || amount <= 0) return;
  object.hp = Math.max(0, object.hp - amount * def.bladeMul);
  const length = Math.hypot(nx, ny) || 1;
  if (def.destruction === 'bend-snap' || def.destruction === 'topple') {
    object.pose.lean = Math.min(1, object.pose.lean + amount * .08);
    object.pose.leanX = nx / length;
    object.pose.leanY = ny / length;
  }
  if (def.destruction === 'crush') object.pose.crush = Math.min(.7, object.pose.crush + amount * .05);
}

/** Placement supplies location and support height; the catalog supplies all breakage behavior. */
export function objectFragments(def: AssetDef, placement: { x: number; y: number; w: number; d: number; h: number; elev: number }, nx: number, ny: number) {
  const length = Math.hypot(nx, ny) || 1, dx = nx / length, dy = ny / length;
  const count = def.debris.remnants + def.debris.fragments;
  const mass = Math.max(.01, def.mass - (def.destruction === 'crush' ? def.debris.pileMass : 0)) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => {
    const remnant = i < def.debris.remnants;
    const tall = def.destruction === 'topple' || def.destruction === 'panel-collapse';
    return {
      x: placement.x + placement.w / 2 + dx * (i - .5) * .16,
      y: placement.y + placement.d / 2 + dy * (i - .5) * .16,
      w: Math.max(.12, remnant ? (tall ? Math.max(placement.w, placement.h) : placement.w) * def.debris.remnantScale : placement.w * .22),
      d: Math.max(.1, placement.d * (remnant ? def.debris.remnantScale * (def.destruction === 'topple' ? .4 : 1) : .22)),
      material: def.material, mass, elev: placement.elev,
      pileMass: i === 0 && def.destruction === 'crush' ? def.debris.pileMass : 0,
      vx: dx * (def.destruction === 'roll' ? 2.4 : 1 + i * .2), vy: dy * (def.destruction === 'roll' ? 2.4 : 1 + i * .2),
      shape: def.debris.shape, layer: remnant ? 'remnant' as const : 'fragment' as const,
    };
  });
}
