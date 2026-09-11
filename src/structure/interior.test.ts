import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { ARCHETYPES } from '../world/archetypes';
import { createBuildingFromArchetype, applyCellDamage } from './building';
import { fixtureCatalog, fixtureSolid, fixtureSupported, generateInteriors, interiorFloorCoverage, interiorRoomAt, stepInteriors } from './interior';

const make = (id = 'ranch') => createBuildingFromArchetype(id, 'INTERIOR', 4, 5);
const open = (b: ReturnType<typeof make>, floor = 0) => {
  for (const c of b.cells.filter(c => c.floor === floor && c.gy === b.d - 1)) applyCellDamage(b, c, 999, 0, 1, new ParticlePool(), []);
};

describe('building interiors', () => {
  it.each(ARCHETYPES.map(a => a.id))('gives %s supported floors and identifiable furnishings', id => {
    const b = make(id);
    expect(b.layout.rooms.length).toBeGreaterThan(0);
    expect(b.fixtures.length).toBeGreaterThan(0);
    expect(b.fixtures.every(f => fixtureSupported(b, f) && b.layout.rooms.some(r => r.id === f.roomId && r.floor === f.floor))).toBe(true);
    expect(b.floorTiles.every(t => b.layout.rooms.some(r => r.id === t.roomId))).toBe(true);
    expect(generateInteriors(b)).toEqual(b.fixtures);
  });
  it('opens furnished ground floors after a wall breach without deleting the slab', () => {
    const b = make();
    expect(interiorFloorCoverage(b).spans).toEqual([]);
    open(b);
    expect(interiorFloorCoverage(b).hasFloor(2, 1, 0)).toBe(true);
    expect(b.fixtures.every(f => fixtureSupported(b, f))).toBe(true);
    expect(b.fixtures.some(f => fixtureSolid(b, f))).toBe(true);
    expect(b.floorTiles.every(t => t.state === 'intact')).toBe(true);
  });
  it('keeps room finishes distinct and merges contiguous floor coverage', () => {
    const b = make(); open(b);
    const coverage = interiorFloorCoverage(b);
    expect(new Set(coverage.spans.map(s => s.finish))).toEqual(new Set(['linoleum', 'plank', 'tile']));
    expect(coverage.spans.length).toBeLessThan(b.floorTiles.length);
    expect(interiorRoomAt(b, 0, 0)).toBe('kitchen');
    expect(interiorRoomAt(b, 4, 2)).toBe('bathroom');
    expect(interiorFloorCoverage(b).spans).toBe(coverage.spans);
  });
  it('breaks furniture when its actual slab support disappears, with one debris emission', () => {
    const b = make('cottage'), fixture = b.fixtures.find(f => f.floor === 1)!;
    for (const s of fixture.support) b.floorTiles.find(t => t.floor === 1 && t.gx === s.gx && t.gy === s.gy)!.state = 'gone';
    const first = stepInteriors(b, new ParticlePool(), []);
    expect(fixture.broken).toBe(true);
    expect(fixtureSupported(b, fixture)).toBe(false);
    expect(first.frags.length).toBeGreaterThan(0);
    expect(stepInteriors(b, new ParticlePool(), []).frags).toEqual([]);
  });
  it('uses the catalog for physical material, health, finish and reward', () => {
    const b = make();
    for (const f of b.fixtures) {
      expect(f.material).toBe(fixtureCatalog(f.kind).material);
      expect(f.hp).toBe(fixtureCatalog(f.kind).hp);
    }
    expect(fixtureCatalog('toilet').finish).toBe('ceramic');
    expect(fixtureCatalog('radiator').finish).toBe('metal');
  });
  it('removes broken furniture from collision while preserving its ground support', () => {
    const b = make(); open(b);
    const f = b.fixtures[0]!;
    expect(fixtureSolid(b, f)).toBe(true);
    f.broken = true;
    expect(fixtureSolid(b, f)).toBe(false);
    expect(fixtureSupported(b, f)).toBe(true);
  });
  it('does not reveal an upper-floor hole as a nonexistent floor tile', () => {
    const b = make('porch-house');
    const coverage = interiorFloorCoverage(b, true);
    expect(coverage.hasFloor(3, 1, 1)).toBe(false);
    expect(coverage.hasFloor(2, 1, 1)).toBe(true);
    expect(b.roofs.some(r => r.floor === 0)).toBe(true);
  });
});
