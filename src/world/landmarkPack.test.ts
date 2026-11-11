import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { createBuildingFromArchetype, stepStructures } from '../structure/building';
import { ARCHETYPES, archetypeById, validateBuildingDefinition } from './archetypes';
import { LANDMARK_ARCHETYPES } from './landmarkPack';

const RAW = import.meta.glob<string>('./landmarkData/**/*.json', { eager: true, query: '?raw', import: 'default' });

describe('regional landmark pack', () => {
  it('registers every package by id without joining the eager roster', () => {
    expect(LANDMARK_ARCHETYPES.length).toBeGreaterThanOrEqual(5);
    for (const a of LANDMARK_ARCHETYPES) {
      expect(archetypeById(a.id)).toBe(a);
      expect(ARCHETYPES.some(entry => entry.id === a.id)).toBe(false);
    }
  });

  it('keeps landmark JSON on LF line endings and under a sane size', () => {
    const files = Object.entries(RAW);
    expect(files.filter(([, text]) => text.includes('\r')).map(([file]) => file)).toEqual([]);
    expect(files.reduce((sum, [, text]) => sum + text.length, 0)).toBeLessThan(120_000);
  });

  it.each(LANDMARK_ARCHETYPES.map(a => [a.id, a] as const))('%s validates, never enters ordinary lots, and stands on its own', (_id, a) => {
    expect(validateBuildingDefinition(a)).toEqual([]);
    expect(Object.values(a.zones).every(weight => weight === 0)).toBe(true);
    expect(a.campaign?.landmarkOnly).toBe(true);
    for (const detail of a.facadeDetails ?? []) if (detail.text !== undefined) expect(detail.text).toMatch(/^[A-Z0-9 ]{1,16}$/);
    const b = createBuildingFromArchetype(a.id, 'TEST', 0, 0);
    const particles = new ParticlePool();
    for (let i = 0; i < 180; i++) stepStructures([b], 1 / 60, particles, []);
    expect(b.cells.every(cell => cell.state === 'intact')).toBe(true);
    expect(b.roofs.every(roof => roof.state === 'intact')).toBe(true);
  });
});
