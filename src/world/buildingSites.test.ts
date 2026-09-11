import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { ASSET_CATALOG } from './catalog';
import { BUILDING_SITES, SITE_FILES, instantiateBuildingSite, parseBuildingSites } from './buildingSites';
import { discoverYardAssets, bayBuildings, bayProps } from './yardCatalog';
import { createTown } from './town';
import { planBatch, spawnBatch, restoreBay, removeBay } from './testYard';
import { applyCellDamage, stepStructures } from '../structure/building';
import { ParticlePool } from '../fx/particles';

describe('building sites', () => {
  it('discovers a campus with separate buildings and exterior equipment', () => {
    const site = BUILDING_SITES[0]!, a = instantiateBuildingSite(site, 2, 3), b = instantiateBuildingSite(site, 2, 3);
    expect(a.buildings).toHaveLength(3); expect(a.props).toHaveLength(4);
    expect(a.buildings.map(b => [b.archetypeId,b.x,b.y,b.cells.length])).toEqual(b.buildings.map(b => [b.archetypeId,b.x,b.y,b.cells.length]));
    expect(new Set([...a.buildings, ...b.buildings].map(b => b.id)).size).toBe(6);
    expect(a.buildings[0]!.layout).toBe(a.buildings[1]!.layout); // immutable template only
    const untouched = JSON.stringify(a.buildings[1]);
    const p = new ParticlePool();
    for (const cell of a.buildings[0]!.cells) applyCellDamage(a.buildings[0]!,cell,10000,1,0,p,[]);
    for (let i = 0; i < 150; i++) stepStructures(a.buildings,1/60,p,[]);
    expect(a.buildings[0]!.fullyDown).toBe(true);
    expect(JSON.stringify(a.buildings[1])).toBe(untouched);
    expect(b.buildings.every(b => b.cells.every(c => c.state === 'intact'))).toBe(true);
    expect(a.props.every(p => p.hp === p.maxHp)).toBe(true);
  });
  it('reports member references, duplicate identities, overlap and bounds with source paths', () => {
    const file = Object.keys(SITE_FILES)[0]!;
    const parse = (site: unknown) => parseBuildingSites({ [file]: site }, ARCHETYPES, ASSET_CATALOG);
    for (const edit of [(s: any) => s.buildings[0].building = 'missing', (s: any) => s.equipment[0].asset = 'missing',
      (s: any) => s.buildings[1].id = s.buildings[0].id, (s: any) => s.buildings[0].x = 1000,
      (s: any) => s.buildings[1].x = s.buildings[0].x, (s: any) => s.version = 2]) {
      const site = structuredClone(BUILDING_SITES[0]); edit(site); expect(() => parse(site)).toThrow(file);
    }
    expect(() => parseBuildingSites({ ...SITE_FILES, 'duplicate.site.json': BUILDING_SITES[0] }, ARCHETYPES, ASSET_CATALOG)).toThrow('Duplicate or missing site id');
  });
  it('places, restores and removes a campus atomically through the playable yard', () => {
    const town = createTown({ yard: true }), pool = new ParticlePool();
    const asset = discoverYardAssets().find(a => a.id === 'site:edge-campus')!;
    const plan = planBatch([asset], 1, false, 8, town.yard!.baselineEnd + 6);
    const baseline = town.buildings.length, baselineProps = town.props.length;
    spawnBatch(town, plan);
    const bay = plan[0]!, old = bayBuildings(bay), oldProps = bayProps(bay);
    expect(town.buildings.length).toBe(baseline + 3);
    expect(town.props.length).toBe(baselineProps + 4);
    applyCellDamage(old[0]!, old[0]!.cells[0]!, 10000, 1, 0, pool, []);
    restoreBay(town, bay, pool);
    expect(old.some(b => town.buildings.includes(b))).toBe(false);
    expect(oldProps.some(p => town.props.includes(p))).toBe(false);
    expect(bayBuildings(bay).every(b => b.cells.every(c => c.state === 'intact'))).toBe(true);
    removeBay(town, bay, pool);
    expect(town.buildings.length).toBe(baseline);
    expect(town.props.length).toBe(baselineProps);
  });
  it('rejects large batches before constructing runtime objects', () => {
    const tower = discoverYardAssets().find(a => a.id === 'building:union-tower')!;
    expect(() => planBatch([tower], 100, false, 8, 8)).toThrow('32768');
  });
});
