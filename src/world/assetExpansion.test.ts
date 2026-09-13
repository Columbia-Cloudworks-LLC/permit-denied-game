import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { createBuildingFromDefinition, stepStructures } from '../structure/building';
import { ParticlePool } from '../fx/particles';
import { discoverYardAssets, yardGridSlots, layoutYard } from './yardCatalog';
import { BUILDING_SITES } from './buildingSites';
import { ASSET_CATALOG } from './catalog';
import { FACADE_DETAIL_KINDS } from '../structure/facadeDetails';

describe('expanded building roster', () => {
  it('retains every numbered building and assembled site in the approved backlog', () => {
    const codes = ARCHETYPES.flatMap(a => a.traits?.form?.filter(t => /^B\d{2}$/.test(t)) ?? []);
    expect(codes.sort()).toEqual(Array.from({ length: 60 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`));
    const yard = new Set(discoverYardAssets().map(a => a.id));
    for (const a of ARCHETYPES.filter(a => a.traits?.form?.some(t => /^B\d{2}$/.test(t)))) {
      expect(yard.has(`building:${a.id}`), `${a.id}: missing yard context`).toBe(true);
    }
    for (const id of ['suburban-block', 'rowhouse-court', 'roadside-motel', 'main-street', 'service-station', 'storage-business',
      'farmstead', 'contractor-yard', 'civic-block', 'school-grounds', 'factory-works', 'office-pair-plaza']) {
      expect(BUILDING_SITES.some(s => s.id === id), `${id}: missing site`).toBe(true);
      expect(yard.has(`site:${id}`), `${id}: missing yard context`).toBe(true);
    }
  });

  it('retains all 24 supporting assets with their production hosts or fixture contexts', () => {
    // D01-D08, D10 and D12: attached details must have a real authored host.
    const details = ['roll-up-door', 'signboard', 'marquee', 'display-glazing', 'porch', 'dormer', 'fire-escape', 'roof-duct', 'entry-steps', 'clock-face'];
    for (const kind of details) {
      expect([...FACADE_DETAIL_KINDS]).toContain(kind);
      expect(ARCHETYPES.some(a => a.facadeDetails?.some(d => d.kind === kind)), `${kind}: missing host`).toBe(true);
    }
    // D09 and D11 use the prop and structural-building paths respectively.
    expect(ASSET_CATALOG.some(a => a.id === 'loading-dock-bumpers')).toBe(true);
    expect(ARCHETYPES.find(a => a.id === 'service-station-canopy')?.canopy).toBeDefined();
    const yard = new Set(discoverYardAssets().map(a => a.id));
    expect(yard.has('prop:loading-dock-bumpers')).toBe(true);
    expect(yard.has('building:service-station-canopy')).toBe(true);
    // D13-D24 must remain available as both standalone and supported fixtures.
    for (const kind of ['diner-booth', 'washer-dryer', 'commercial-oven', 'office-desk', 'filing-cabinet', 'checkout-register',
      'theater-seats', 'repair-lift', 'display-fridge', 'school-desks', 'examination-table', 'nursery-bench']) {
      expect(yard.has(`prop:interior-${kind}`), `${kind}: missing standalone model`).toBe(true);
      expect(yard.has(`fixture:interior-${kind}`), `${kind}: missing fixture host`).toBe(true);
    }
  });
  it('keeps newly authored buildings standing without player damage', () => {
    for (const def of ARCHETYPES.filter(a => a.traits?.form?.some(t => /^B\d{2}$/.test(t)))) {
      const b = createBuildingFromDefinition(def, def.label, 10, 10);
      const particles = new ParticlePool();
      for (let frame = 0; frame < 180; frame++) stepStructures([b], 1 / 60, particles, []);
      expect(b.cells.every(c => c.state === 'intact'), `${def.id}: spontaneous structural failure`).toBe(true);
      expect(b.fixtures.every(f => !f.broken), `${def.id}: unsupported fixture`).toBe(true);
      expect(b.roofs.every(r => r.state === 'intact'), `${def.id}: unsupported roof`).toBe(true);
    }
  });
  it('leaves room for experimentation after loading the complete baseline', () => {
    const assets = discoverYardAssets();
    const baseline = assets.reduce((total, a) => total + yardGridSlots(a), 0);
    expect(baseline).toBeLessThan(65536 - 32768);
    const bays = layoutYard(assets);
    expect(Math.max(...bays.map(b => b.y + b.d)) + 150).toBeLessThan(2000);
  });
});
