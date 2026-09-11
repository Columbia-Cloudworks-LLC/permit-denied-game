import { describe, expect, it } from 'vitest';
import { createBuildingFromArchetype } from '../structure/building';
import { applyFixtureDamage, fixtureCatalog } from '../structure/interior';
import { spawnAsset } from '../world/catalog';
import { applyAssetHit } from './assets';
import { objectFragments } from './objectBehavior';
import { ParticlePool } from '../fx/particles';

describe('shared placed-object behavior', () => {
  it.each(['toilet', 'sofa', 'cabinet'] as const)('applies the same %s damage and debris profile indoors and outdoors', kind => {
    const b = createBuildingFromArchetype('ranch', 'OBJECT', 0, 0), f = b.fixtures.find(f => f.kind === kind)!;
    const p = spawnAsset(`interior-${kind}`, f.x, f.y, 0, 0, { w: f.w, d: f.d });
    applyAssetHit(p, 2, 1, 0);
    applyFixtureDamage(b, f, 2, 1, 0, new ParticlePool(), []);
    expect(f.hp).toBe(p.hp);
    expect(f.pose).toEqual(p.pose);
    const fragments = applyFixtureDamage(b, f, 999, 1, 0, new ParticlePool(), []).frags;
    expect(fragments).toEqual(objectFragments(fixtureCatalog(kind), { ...f, elev: .15 }, 1, 0));
    const mass = fragments.reduce((n, f) => n + f.mass + (f.pileMass ?? 0), 0);
    expect(mass).toBeCloseTo(fixtureCatalog(kind).mass);
  });
});
