import { expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from '../structure/building';
import { DETAILED_FLOORS, paintsFloorSlab } from '../structure/coreCollapse';
import { interiorFloorCoverage } from '../structure/interior';
import { ARCHETYPES } from '../world/archetypes';
import { discoverYardAssets } from '../world/yardCatalog';
import { interiorCmds } from './interiorDraw';

const URBAN_PACKAGES = [
  'walkup-block', 'avenue-apartments', 'terrace-apartments',
  'bakery-walkup', 'laundry-lofts', 'market-apartments',
  'courtyard-midrise', 'corner-apartments', 'stepped-apartments',
  'office-slab-eight', 'office-stepped-ten', 'office-compact-twelve',
  'plaza-office-tower', 'needle-office', 'setback-office-tower',
  'residence-tower', 'twin-residence', 'crown-apartments',
] as const;

const MID_RISES = URBAN_PACKAGES.filter(id => {
  const floors = ARCHETYPES.find(a => a.id === id)!.floors;
  return floors >= 5 && floors <= 12;
});
const SKYSCRAPERS = URBAN_PACKAGES.filter(id => ARCHETYPES.find(a => a.id === id)!.floors >= 20);
const LANDMARKS = ARCHETYPES.filter(a => a.campaign?.landmarkOnly).map(a => a.id);

function paintedFloors(id: string, reveal = true) {
  const b = createBuildingFromArchetype(id, id.toUpperCase(), 0, 0);
  const spans = interiorFloorCoverage(b, reveal).spans.map(s => s.floor);
  const cmds = interiorCmds(b, 1, { reveal, maxFloor: 99 }).filter(c => c.kind === 'floor').map(c => c.floor);
  return { b, spans, cmds };
}

it('never paints floor 4+ on any discovered package, including planner catalog buildings', () => {
  expect(MID_RISES.length).toBeGreaterThan(0);
  expect(SKYSCRAPERS.length).toBeGreaterThan(0);
  expect(LANDMARKS).toContain('city-hall');
  const plannerBuildings = discoverYardAssets().filter(a => a.category === 'building').map(a => a.archetype!.id);
  expect(plannerBuildings.sort()).toEqual(ARCHETYPES.map(a => a.id).sort());
  for (const id of [...new Set([...ARCHETYPES.map(a => a.id), ...URBAN_PACKAGES, ...LANDMARKS])]) {
    for (const reveal of [false, true]) {
      const { b, spans, cmds } = paintedFloors(id, reveal);
      expect(spans.every(paintsFloorSlab), `${id} coverage reveal=${reveal}`).toBe(true);
      expect(cmds.every(paintsFloorSlab), `${id} cmds reveal=${reveal}`).toBe(true);
      expect(b.fixtures.every(f => paintsFloorSlab(f.floor)), id).toBe(true);
      if (b.floors > DETAILED_FLOORS) {
        expect(b.floorTiles.some(t => !t.void && t.floor >= DETAILED_FLOORS), id).toBe(true);
        expect(b.coreCollapse ?? b.elevatedTank, id).toBeDefined();
      }
    }
  }
});

it('keeps AVENUE APARTMENTS and downtown towers collapsing as tall stacks', () => {
  const p = new ParticlePool();
  for (const id of ['avenue-apartments', 'plaza-office-tower'] as const) {
    const b = createBuildingFromArchetype(id, id.toUpperCase(), 0, 0);
    expect(b.floors).toBeGreaterThan(DETAILED_FLOORS);
    expect(new Set(interiorFloorCoverage(b, true).spans.map(s => s.floor))).toEqual(new Set([0, 1, 2]));
    expect(interiorFloorCoverage(b, true).spans.every(s => s.floor < DETAILED_FLOORS)).toBe(true);
    expect(b.coreCollapse!.floors.some(f => f.floor >= DETAILED_FLOORS), id).toBe(true);
    for (const c of b.cells) if (c.floor === 0 && !c.silo) applyCellDamage(b, c, 99999, 0, -1, p, []);
    for (let i = 0; i < 900; i++) stepStructures([b], 1 / 60, p, []);
    expect(b.coreCollapse?.phase, id).toBe('settled');
    expect(b.fullyDown, id).toBe(true);
  }
});

it('does not paint the unseen fourth parking deck', () => {
  const { b, spans, cmds } = paintedFloors('parking-garage', true);
  expect(b.openDecks).toBe(true);
  expect(b.floors).toBe(4);
  expect(b.floorTiles.some(t => t.floor === 3 && !t.void)).toBe(true);
  expect(spans.includes(3)).toBe(false);
  expect(cmds.includes(3)).toBe(false);
  expect(b.coreCollapse).toBeDefined();
});
