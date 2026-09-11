import { describe, it, expect } from 'vitest';
import { createTown } from './town';
import { ASSET_CATALOG } from './catalog';
import { ARCHETYPES } from './archetypes';
import { CONTENT_ASSETS } from './contents';
import { discoverYardAssets, layoutYard, instantiateBay, overlap } from './yardCatalog';
import { clearBayDebris, clearTestArea, planBatch, placementError, removeBay, restoreBay, spawnBatch } from './testYard';
import { destroyProp } from '../sim/assets';
import { crushBody } from '../sim/debris';
import { ParticlePool } from '../fx/particles';
import { createDozer } from '../vehicle/dozer';
import { stepWorld } from '../sim/worldSim';
import { applyCellDamage } from '../structure/building';
import { fixtureSolid } from '../structure/interior';
import { PileField } from '../sim/pile';

const yard = () => createTown({ yard: true });
const sum = (values: Float32Array) => values.reduce((a, b) => a + b, 0);
describe('generated asset test yard', () => {
  it('covers every catalog and archetype, plus both floors of every fixture', () => {
    const t = yard();
    expect(t.yard!.issues).toEqual([]);
    expect(t.yard!.bays).toHaveLength(ASSET_CATALOG.length + ARCHETYPES.length + CONTENT_ASSETS.length);
    expect(new Set(t.props.map(p => p.assetId))).toEqual(new Set(ASSET_CATALOG.map(a => a.id)));
    for (const a of ARCHETYPES) expect(t.buildings.some(b => b.archetypeId === a.id)).toBe(true);
    for (const a of CONTENT_ASSETS) {
      const host = t.yard!.bays.find(b => b.asset.id === `fixture:${a.id}`)!.building!;
      expect(host.fixtures.map(f => f.floor)).toEqual([0, 1]);
      expect(fixtureSolid(host, host.fixtures[0]!)).toBe(true);
      expect(fixtureSolid(host, host.fixtures[1]!)).toBe(false); // elevated fixtures do not block ground traffic
    }
  });
  it('discovers and constructs supplied definitions with no placement or picker edits', () => {
    const prop = { ...ASSET_CATALOG[0]!, id: 'new-test-prop', variants: 3 };
    const building = { ...ARCHETYPES[0]!, id: 'new-test-building', label: 'NEW TEST BUILDING', w: 7,
      footprint: Array.from({ length: 2 }, () => Array<string>(4).fill('#######')) };
    const discovered = discoverYardAssets([prop], [building]);
    expect(discovered.map(a => a.id).sort()).toEqual(['building:new-test-building', 'prop:new-test-prop']);
    const bays = layoutYard(discovered);
    for (const b of bays) instantiateBay(b);
    expect(bays.find(b => b.prop)?.prop?.assetId).toBe(prop.id);
    expect(bays.find(b => b.building)?.building?.w).toBe(7);
  });
  it('lays out deterministically with nonoverlapping demolition clearance and six-unit aisles', () => {
    const a = layoutYard(), b = layoutYard(); expect(a).toEqual(b);
    for (let i = 0; i < a.length; i++) {
      const bay = a[i]!;
      for (const other of a.slice(i + 1)) expect(overlap({ ...bay, w: bay.w + 5.9, d: bay.d + 5.9 }, other)).toBe(false);
      if (bay.asset.prop) expect(bay.asset.clearance).toBeGreaterThan(bay.asset.prop.explodeRadius);
    }
  });
  it('spawns single, ten-copy, and expanded variants with unique IDs and rejects overlap', () => {
    const t = yard(), asset = t.yard!.assets.find(a => a.id === 'prop:car')!;
    const plan = planBatch([asset], 10, false, 8, t.yard!.baselineEnd, 2);
    expect(placementError(t, plan)).toBeUndefined(); spawnBatch(t, plan);
    expect(plan.every(b => b.prop?.variant === 2)).toBe(true);
    expect(placementError(t, plan)).toMatch(/Overlaps/);
    const variants = planBatch([asset], 1, true, 8, t.yard!.baselineEnd + 50);
    spawnBatch(t, variants); expect(variants.map(b => b.prop!.variant)).toEqual([0, 1, 2, 3]);
    expect(new Set(t.props.map(p => p.id)).size).toBe(t.props.length);
    expect(() => planBatch([asset], 0, false, 0, 0)).toThrow();
  });
  it('cleans destroyed and moved debris while preserving neighboring experiments over repeated cycles', () => {
    const t = yard(), pool = new ParticlePool(); pool.ownerAt = t.debrisOwnerAt;
    const bay = t.yard!.bays.find(b => b.asset.id === 'prop:dumpster')!;
    const plan = planBatch([bay.asset], 1, false, 8, t.yard!.baselineEnd); spawnBatch(t, plan);
    const experiment = plan[0]!.prop!;
    t.pile.addMass(experiment.x, experiment.y, 2, 'wood');
    const dozer = createDozer(3, 3, 0), upgrades = { blade: 0, engine: 0, push: 0 };
    stepWorld(t, dozer, pool, upgrades, 1 / 60);
    const ids = new Set<number>();
    for (let i = 0; i < 8; i++) {
      ids.add(bay.prop!.id); destroyProp(t, bay.prop!, pool, [], 0, 0);
      const body = t.rubble.find(r => r.yardOwner === bay.key)!;
      expect(body).toBeDefined(); body.x = experiment.x + 20; crushBody(t, body, pool);
      restoreBay(t, bay, pool);
      expect(t.props).toContain(experiment); expect(experiment.hp).toBe(experiment.maxHp);
      expect(t.rubble.filter(r => r.yardOwner === bay.key)).toHaveLength(0);
      expect(pool.items.some(p => p.alive && p.kind !== 'dust')).toBe(false);
      expect(t.marks.filter(m => m.yardOwner === bay.key)).toHaveLength(0);
      expect(sum(t.pile.mass)).toBeCloseTo(2, 4);
      expect(stepWorld(t, dozer, pool, upgrades, 1 / 60).metrics.collisionRebuilds).toBe(1);
    }
    expect(ids.size).toBe(8);
    removeBay(t, plan[0]!, pool); expect(t.props).not.toContain(experiment);
    expect(sum(t.pile.mass)).toBeCloseTo(0, 4);
  });
  it('restores collapsed structures and fixtures without removing other bays', () => {
    const t = yard(), pool = new ParticlePool(), bay = t.yard!.bays.find(b => b.asset.id === 'building:ranch')!;
    const neighbor = t.yard!.bays.find(b => b.asset.id === 'building:rivertown')!.building!;
    const old = bay.building!;
    for (const c of old.cells) applyCellDamage(old, c, 10000, 1, 0, pool, []);
    const dozer = createDozer(3, 3, 0);
    for (let i = 0; i < 150; i++) stepWorld(t, dozer, pool, { blade: 0, engine: 0, push: 0 }, 1 / 60);
    restoreBay(t, bay, pool);
    expect(t.buildings).not.toContain(old); expect(t.buildings).toContain(neighbor);
    expect(t.collapsedSites.some(s => s.buildingId === old.id)).toBe(false);
    expect(bay.building!.cells.every(c => c.state === 'intact')).toBe(true);
  });
  it('grows pile coverage for large batches without losing existing mass', () => {
    const t = yard(); const bay = t.yard!.bays[0]!;
    t.pile.addMass(bay.x + 2, bay.y + 2, 3, 'wood');
    const oldMax = t.maxY;
    spawnBatch(t, planBatch(t.yard!.assets.filter(a => a.archetype), 10, false, 8, t.yard!.baselineEnd));
    expect(t.maxY).toBeGreaterThan(oldMax); expect(sum(t.pile.mass)).toBeCloseTo(3, 4);
    clearBayDebris(t, bay); expect(sum(t.pile.mass)).toBeCloseTo(0, 4);
  });
  it('removes only the selected material contribution from mixed piles', () => {
    const p = new PileField(0, 0, 20, 20); p.addMass(3, 3, 2, 'wood', 'a'); p.addMass(3, 3, 3, 'metal', 'b');
    p.removeOwner('a'); expect(sum(p.mass)).toBeCloseTo(3, 4); expect(sum(p.mats[0]!)).toBeCloseTo(0, 4); expect(sum(p.mats[3]!)).toBeCloseTo(3, 4);
  });
  it('retains ownership when extracting, moving and growing pile fields', () => {
    let p = new PileField(0, 0, 20, 20); p.addMass(3, 3, 2, 'wood', 'a'); p.addMass(3, 3, 3, 'wood', 'b');
    const extracted = p.extractDisk(3, 3, 2, 5); p.addMass(10, 10, extracted.mass, extracted.material, extracted.owners);
    p = p.grow(30, 30); p.removeOwner('a'); expect(sum(p.mass)).toBeCloseTo(3, 4); p.removeOwner('b'); expect(sum(p.mass)).toBeCloseTo(0, 4);
  });
  it('rejects obstructed placements and does not retain removed colliders', () => {
    const t = yard(), asset = t.yard!.assets.find(a => a.id === 'prop:dumpster')!;
    const plan = planBatch([asset], 1, false, 8, t.yard!.baselineEnd);
    const b = plan[0]!;
    t.pile.addMass(b.x + 2, b.y + 2, 1, 'wood', 'loose');
    expect(placementError(t, plan)).toMatch(/Pile/);
    clearTestArea(t, b); spawnBatch(t, plan);
    const p = b.prop!, x = p.x + p.w / 2, y = p.y + p.d / 2;
    const pool = new ParticlePool(), upgrades = { blade: 0, engine: 0, push: 0 };
    const blocked = createDozer(x, y, 0); stepWorld(t, blocked, pool, upgrades, 1 / 60);
    expect(Math.hypot(blocked.x - x, blocked.y - y)).toBeGreaterThan(0);
    removeBay(t, b);
    const free = createDozer(x, y, 0); stepWorld(t, free, pool, upgrades, 1 / 60);
    expect(free.x).toBe(x); expect(free.y).toBe(y);
  });
  it('leaves the world untouched if a batch constructor fails', () => {
    const t = yard(), first = t.yard!.assets.find(a => a.id === 'prop:dumpster')!;
    const source = t.yard!.assets.find(a => a.id === 'building:rivertown')!;
    const invalid = { ...source, archetype: { ...source.archetype!, construction: { ...source.archetype!.construction!, fallDuration: -1 } } };
    const plan = planBatch([first, invalid], 1, false, 8, t.yard!.baselineEnd);
    const before = [t.props.length, t.buildings.length, t.yard!.bays.length];
    expect(() => spawnBatch(t, plan)).toThrow(/Invalid building/);
    expect([t.props.length, t.buildings.length, t.yard!.bays.length]).toEqual(before);
  });
  it('clears a selected area without touching material or objects outside it', () => {
    const t = yard(), a = t.yard!.bays[0]!, b = t.yard!.bays[1]!;
    t.pile.addMass(a.x + 2, a.y + 2, 2, 'wood', b.key);
    t.pile.addMass(b.x + 2, b.y + 2, 3, 'metal', b.key);
    clearTestArea(t, a); expect(sum(t.pile.mass)).toBeCloseTo(3, 4);
    expect(t.yard!.bays).toContain(b); clearBayDebris(t, b); expect(sum(t.pile.mass)).toBeCloseTo(0, 4);
  });
  it('keeps challenge and district generation unchanged unless yard is requested', () => {
    expect(createTown().yard).toBeUndefined(); expect(createTown().buildings).toHaveLength(7);
    expect(createTown({ showcase: true }).buildings).toHaveLength(3);
    for (const district of ['d10', 'd30', 'd100'] as const) expect(createTown({ district, yard: true }).yard).toBeUndefined();
  });
});
