import { expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from './building';
import { cellWorldBox } from './types';

it('keeps drive-through space open and drops its roof after column loss', () => {
  const b = createBuildingFromArchetype('service-station-canopy', 'CANOPY', 0, 0), particles = new ParticlePool();
  expect(b.cells).toHaveLength(4);
  expect(b.cells.every(c => c.role === 'column' && !c.cladding)).toBe(true);
  expect(b.grid[0]![4]![2]!.state).toBe('gone');
  for (const c of b.cells) expect(cellWorldBox(b, c)).toMatchObject({ w: .32, d: .32 });
  expect(b.roofs.length).toBeGreaterThan(0);
  for (let i = 0; i < 300; i++) stepStructures([b], 1/60, particles, []);
  expect(b.roofs.every(r => r.state === 'intact')).toBe(true);
  for (const c of b.cells) applyCellDamage(b, c, 10000, 1, 0, particles, []);
  let roofDebris = 0;
  for (let i = 0; i < 900; i++) roofDebris += stepStructures([b], 1/60, particles, []).rubbleSpawns.filter(r => r.source === 'roof').length;
  expect(roofDebris).toBeGreaterThan(0);
  expect(b.roofs.every(r => r.state === 'gone')).toBe(true);
  expect(b.fullyDown).toBe(true);
});

it('rejects missing and duplicate canopy columns', () => {
  const a = structuredClone(archetypeById('service-station-canopy'));
  a.canopy!.columns[0] = { ...a.canopy!.columns[1]! };
  expect(validateBuildingDefinition(a).join(';')).toContain('distinct occupied column cells');
});
