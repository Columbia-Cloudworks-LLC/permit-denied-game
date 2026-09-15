import { it, expect } from 'vitest';
import { createTown } from './town';
import { ARCHETYPES } from './archetypes';
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16); };
// Captured from the monolithic catalog before migration (seed 19).
it('preserves every legacy definition byte-for-byte after resolving local layouts', () => {
  expect(ARCHETYPES.filter(a => a.generationOrder !== undefined).map(a => {
    const { generationOrder: _order, ...original } = a;
    return [a.id, hash(JSON.stringify(original))];
  })).toEqual([["rivertown","8b43b088"],["steel-warehouse","3c1adcd"],["ranch","e52a60b7"],["cottage","fb31fe5d"],["colonial","f8076de0"],["walkup","9384814c"],["porch-house","269fee02"],["storefront","e8606da1"],["corner-shop","4827b279"],["civic","181ea844"],["warehouse","ac0b8d09"]]);
});
it.each([['classic','a821a06'],['d10','8e56a3d9'],['d30','c28cf9d6'],['d100','f80d7896']] as const)('preserves seed 19 positions, cells, roofs, fixtures and slabs in %s', (district, expected) => {
  const t = createTown({ district, seed: 19 });
  expect(hash(JSON.stringify(t.buildings.map(b => [b.archetypeId,b.name,b.x,b.y,b.w,b.d,b.floors,b.cells,b.roofs,b.fixtures,b.floorTiles])))).toBe(expected);
});
