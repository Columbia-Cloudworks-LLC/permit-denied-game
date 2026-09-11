import { it, expect } from 'vitest';
import { createTown } from './town';
import { ARCHETYPES } from './archetypes';
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16); };
// Captured from the monolithic catalog before migration (seed 19).
it('preserves every legacy definition byte-for-byte after resolving local layouts', () => {
  expect(ARCHETYPES.filter(a => a.generationOrder !== undefined).map(a => {
    const { generationOrder: _order, ...original } = a;
    return [a.id, hash(JSON.stringify(original))];
  })).toEqual([["rivertown","8b43b088"],["steel-warehouse","d6945f71"],["ranch","30237a89"],["cottage","574ef810"],["colonial","10f1fde2"],["walkup","d6ba749e"],["porch-house","31fe588a"],["storefront","da13ce51"],["corner-shop","f69c266d"],["civic","c23c66bc"],["warehouse","cd6b1ac4"]]);
});
it.each([['classic','a821a06'],['d10','8e56a3d9'],['d30','c28cf9d6'],['d100','f80d7896']] as const)('preserves seed 19 positions, cells, roofs, fixtures and slabs in %s', (district, expected) => {
  const t = createTown({ district, seed: 19 });
  expect(hash(JSON.stringify(t.buildings.map(b => [b.archetypeId,b.name,b.x,b.y,b.w,b.d,b.floors,b.cells,b.roofs,b.fixtures,b.floorTiles])))).toBe(expected);
});
