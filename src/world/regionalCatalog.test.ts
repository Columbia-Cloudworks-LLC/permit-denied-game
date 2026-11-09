import { describe, expect, it } from 'vitest';
import { buildingBonus } from '../structure/building';
import type { Building } from '../structure/types';
import { ARCHETYPES } from './archetypes';
import { campaignWeight } from './campaignPlacement';
import { countyAt } from './counties';
import {
  COUNTY_ARCHETYPES,
  REGIONAL_FLAVORS,
  regionalPlacement,
  regionalWeight,
  SIGNATURE_BONUS,
  tagRegionalSignatures,
} from './regionalCatalog';
import { REGIONS } from './regions';
import { createTown } from './town';

const ESTATE_MEMBERS = new Set(['governors-mansion', 'mansion-admin-wing', 'mansion-garage', 'mansion-gatehouse', 'mansion-service']);
const byId = new Map(ARCHETYPES.map(archetype => [archetype.id, archetype]));
const eligibleSomewhere = (id: string) => {
  const levels = byId.get(id)?.campaign?.levels ?? {};
  return Object.values(levels).some(weight => (weight ?? 0) > 0);
};

describe('regional flavor registry', () => {
  it('covers every region flavor and only names real, campaign-eligible buildings', () => {
    for (const region of REGIONS) expect(REGIONAL_FLAVORS[region.flavor], region.id).toBeDefined();
    for (const flavor of Object.values(REGIONAL_FLAVORS)) {
      expect(flavor.signatures.length, flavor.id).toBeGreaterThanOrEqual(1);
      expect(flavor.signatures.length, flavor.id).toBeLessThanOrEqual(2);
      for (const id of [...Object.keys(flavor.boosts), ...flavor.signatures.map(spec => spec.buildingId)]) {
        expect(eligibleSomewhere(id), `${flavor.id}: ${id}`).toBe(true);
      }
      for (const weight of Object.values(flavor.boosts)) expect(weight).toBeGreaterThan(0);
    }
  });

  it("keeps each county archetype's boosts and signatures on buildings its own level can place", () => {
    for (const archetype of COUNTY_ARCHETYPES) {
      for (const id of [...Object.keys(archetype.boosts), ...archetype.signatures.map(spec => spec.buildingId)]) {
        const placeable = campaignWeight(byId.get(id)?.campaign, archetype.levelId) > 0
          || (archetype.levelId === 'governors-mansion' && ESTATE_MEMBERS.has(id));
        expect(placeable, `${archetype.id}: ${id}`).toBe(true);
      }
    }
  });

  it('compounds region and county boosts, and leaves legacy maps unweighted', () => {
    const iowaRural = regionalPlacement('grain-belt', 1);
    expect(regionalWeight(iowaRural, 'grain-elevator')).toBe(6);
    expect(regionalWeight(iowaRural, 'gable-barn')).toBe(3);
    expect(regionalWeight(iowaRural, 'cottage')).toBe(1);
    expect(regionalWeight(undefined, 'grain-elevator')).toBe(1);
  });

  it('tags at most two signatures, never the landmark, and pays the signature bonus on collapse', () => {
    const building = (id: string, extra: Partial<Building> = {}) => ({ archetypeId: id, kind: 'house', ...extra }) as Building;
    const buildings = [building('grain-elevator', { campaignLandmark: true }), building('grain-elevator'), building('feed-store'), building('gable-barn')];
    const tagged = tagRegionalSignatures(buildings, regionalPlacement('grain-belt', 1));
    expect(tagged.map(entry => entry.regionalSignature)).toEqual(['Grain Elevator', 'Co-op Feed Store']);
    expect(buildings[0]!.regionalSignature).toBeUndefined();
    expect(buildings[3]!.regionalSignature).toBeUndefined();
    expect(buildingBonus(buildings[1]!) - buildingBonus(buildings[3]!)).toBe(SIGNATURE_BONUS);
  });
});

describe('regional county generation', () => {
  const build = (regionId: string, index: number, regional = true) => {
    const county = countyAt(regionId, index)!;
    const region = REGIONS.find(entry => entry.id === regionId)!;
    return createTown({
      district: 'd30', seed: county.seed, campaign: county.level,
      regional: regional ? regionalPlacement(region.flavor, index) : undefined,
    });
  };

  it('builds the same county layout every time from its region and index', () => {
    const ids = (town: ReturnType<typeof createTown>) => town.buildings.map(building => `${building.archetypeId}@${building.x.toFixed(2)},${building.y.toFixed(2)}`);
    expect(ids(build('US-KS', 1))).toEqual(ids(build('US-KS', 1)));
  });

  it('leans Grain Belt farm counties toward their boosted buildings and calls out a signature', () => {
    const boosted = new Set(Object.keys(REGIONAL_FLAVORS['grain-belt'].boosts));
    const count = (town: ReturnType<typeof createTown>) => town.buildings.filter(building => boosted.has(building.archetypeId)).length;
    let biased = 0, plain = 0, signed = 0;
    for (const regionId of ['US-IA', 'US-NE', 'US-KS', 'CA-SK']) {
      const town = build(regionId, 1);
      biased += count(town);
      plain += count(build(regionId, 1, false));
      const signatures = town.buildings.filter(building => building.regionalSignature);
      expect(signatures.length).toBeLessThanOrEqual(2);
      if (signatures.length) signed++;
    }
    expect(biased).toBeGreaterThan(plain);
    expect(signed).toBeGreaterThanOrEqual(3);
  });

  it('still meets city composition rules with a regional bias on Main Street and Downtown counties', () => {
    for (const [regionId, index] of [['US-NY', 5], ['US-TX', 6]] as const) {
      const town = build(regionId, index);
      expect(town.diagnostic.ok, `${regionId}#${index}`).toBe(true);
      expect(town.buildings.some(building => building.campaignLandmark)).toBe(true);
    }
  });
});
