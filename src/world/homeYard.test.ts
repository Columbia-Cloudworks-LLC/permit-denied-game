import { describe, expect, it } from 'vitest';
import { createTown } from './town';
import { populateHomeYard, resetRange, type HomeYardOptions } from './homeYard';
import { cellPresent } from '../structure/types';

const build = (options: HomeYardOptions) => createTown({ seed: 7, populate: town => populateHomeYard(town, options) });

describe('home yard', () => {
  it('lays out the shop apron, dispatch pad, reset pad and four proving lanes', () => {
    const town = build({ yardTier: 0, countiesCleared: 0, lifetimeEarned: 0 });
    const home = town.home!;
    expect(home.lanes.map(l => l.key)).toEqual(['lane:A', 'lane:B', 'lane:C', 'lane:D']);
    expect(town.buildings.map(b => b.archetypeId)).toEqual(expect.arrayContaining(['vehicle-service-depot', 'cottage', 'corner-shop', 'pump-house']));
    expect(town.vehicles.map(v => v.definitionId).sort()).toEqual(['combine', 'tractor-trailer', 'tractor-trailer']);
    for (const zone of [home.apron, home.reset, home.lowboy]) {
      expect(zone.x).toBeGreaterThanOrEqual(0);
      expect(zone.x + zone.w).toBeLessThanOrEqual(town.maxX);
      expect(zone.y + zone.d).toBeLessThanOrEqual(town.maxY);
    }
    // The dozer rolls out of the shop clear of the apron trigger.
    expect(home.exit.y).toBeGreaterThan(home.apron.y + home.apron.d);
  });

  it('range tiers add the tower lane and the office slab pad', () => {
    expect(build({ yardTier: 1, countiesCleared: 0, lifetimeEarned: 0 }).home!.lanes).toHaveLength(5);
    const town = build({ yardTier: 2, countiesCleared: 0, lifetimeEarned: 0 });
    expect(town.home!.lanes).toHaveLength(6);
    expect(town.buildings.some(b => b.archetypeId === 'office-slab-eight')).toBe(true);
  });

  it('the trophy lot fills with crushed cruisers as counties are cleared', () => {
    const town = build({ yardTier: 0, countiesCleared: 9, lifetimeEarned: 150000 });
    expect(town.vehicles.filter(v => v.definitionId === 'police-cruiser')).toHaveLength(3);
  });

  it('a range reset rebuilds wrecked lanes but leaves the one the dozer stands in', () => {
    const options = { yardTier: 0, countiesCleared: 0, lifetimeEarned: 0 };
    const town = build(options);
    const shed = town.buildings.find(b => b.archetypeId === 'cottage')!;
    for (const cell of shed.cells) cell.state = 'gone';
    const laneB = town.home!.lanes[1]!;
    const skipped = resetRange(town, { x: laneB.x + 2, y: laneB.y + 2 }, options);
    expect(skipped).toEqual(['LANE B · MASONRY']);
    const fresh = town.buildings.find(b => b.archetypeId === 'cottage')!;
    expect(fresh).not.toBe(shed);
    expect(fresh.cells.every(cellPresent)).toBe(true);
    expect(town.buildings.filter(b => b.archetypeId === 'cottage')).toHaveLength(1);
  });
});
