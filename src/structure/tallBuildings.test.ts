import { ARCHETYPES } from '../world/archetypes';
import { expect, it } from 'vitest';
import { createBuildingFromArchetype, applyCellDamage, stepStructures } from './building';
import { DETAILED_FLOORS, paintsFloorSlab } from './coreCollapse';
import { ParticlePool } from '../fx/particles';

it('bounds apartment tower simulation and collapses it as a coherent shell', () => {
  const b = createBuildingFromArchetype('apartment-tower', 'TEST', 0, 0), p = new ParticlePool();
  const fixtures = b.fixtures.length;
  for (const c of b.cells) if (c.floor === 0 && !c.silo) applyCellDamage(b, c, 99999, 0, -1, p, []);
  const start = performance.now(); let fragments = 0, pulses = 0;
  for (let i = 0; i < 900; i++) {
    const r = stepStructures([b], 1 / 60, p, []);
    fragments += r.rubbleSpawns.filter(s => !s.aggregate).length;
    pulses += r.coreImpacts.length;
  }
  console.log(JSON.stringify({ fixtures, ms: performance.now() - start, fragments, pulses }));
  expect(b.coreCollapse?.phase).toBe('settled');
  expect(b.fixtures.every(f => paintsFloorSlab(f.floor))).toBe(true);
  expect(fragments).toBe(0);
  expect(pulses).toBe(b.floors);
  expect(b.fullyDown).toBe(true);
});

it.each(['parking-garage', 'grain-elevator', 'hotel-podium', 'union-tower'])('uses controlled collapse for tall %s', id => {
  const b = createBuildingFromArchetype(id, 'TEST', 0, 0);
  expect(b.coreCollapse).toBeDefined();
  expect(b.fixtures.every(f => paintsFloorSlab(f.floor))).toBe(true);
  expect(b.coreCollapse!.definition.supports.every(s => !b.grid[0]![s.x]![s.y]!.silo)).toBe(true);
});

it('preserves detailed three-story homes', () => {
  const b = createBuildingFromArchetype('rowhouse-unit', 'TEST', 0, 0);
  expect(b.floors).toBe(3);
  expect(b.coreCollapse).toBeUndefined();
  expect(b.fixtures.some(f => f.floor === 2)).toBe(true);
});

it('applies the cutoff to every building package', () => {
  for (const a of ARCHETYPES) {
    const b = createBuildingFromArchetype(a.id, 'TEST', 0, 0);
    if (b.floors > DETAILED_FLOORS) expect(b.coreCollapse ?? b.elevatedTank, a.id).toBeDefined();
    else expect(b.coreCollapse, a.id).toBeUndefined();
    expect(b.fixtures.every(f => paintsFloorSlab(f.floor)), a.id).toBe(true);
  }
});

it('keeps silo modules interactive after the headhouse settles', () => {
  const b = createBuildingFromArchetype('grain-elevator', 'TEST', 0, 0), p = new ParticlePool();
  for (const c of b.cells) if (c.floor === 0 && !c.silo) applyCellDamage(b, c, 99999, 0, -1, p, []);
  for (let i = 0; i < 600; i++) stepStructures([b], 1 / 60, p, []);
  expect(b.coreCollapse!.phase).toBe('settled');
  expect(b.fullyDown).toBe(false);
  expect(b.silos!.every(s => s.phase === 'standing')).toBe(true);
  for (const c of b.cells) if (c.silo) applyCellDamage(b, c, 99999, 0, -1, p, []);
  for (let i = 0; i < 600; i++) stepStructures([b], 1 / 60, p, []);
  expect(b.fullyDown).toBe(true);
  expect(b.cells.every(c => c.state === 'gone')).toBe(true);
});
