import { describe, expect, it } from 'vitest';
import { aabbOverlap } from '../game/math';
import { ARCHETYPES } from './archetypes';
import { evaluateCampaignComposition } from './campaignComposition';
import { countyAt, countyEnvironment } from './counties';
import { CITY_PLANS } from './cityPlans';
import { CITY_SITES } from './cityPlanSites';
import { biomeById } from './biomes';
import { climateById } from './climate';
import { regionalPlacement } from './regionalCatalog';
import { regionById } from './regions';
import { aabbOverlapsRoad, publicStreetsReachable } from './roads';
import { surfaceAt, traversalAt } from './terrain';
import { createTown } from './town';

function buildCity(regionId: string) {
  const region = regionById(regionId)!;
  const county = countyAt(regionId, 6)!;
  const environment = countyEnvironment(region, 6);
  const placement = regionalPlacement(region, 6);
  const town = createTown({
    district: 'd30',
    seed: county.seed,
    campaign: county.level,
    biome: biomeById(environment.biomeId),
    climate: climateById(environment.climateId),
    regional: placement,
  });
  return { town, county, plan: CITY_PLANS[regionId]! };
}

it('lists a real-world site for every planned city, and no others', () => {
  expect(Object.keys(CITY_SITES).sort()).toEqual(Object.keys(CITY_PLANS).sort());
});

describe.each(Object.keys(CITY_PLANS))('city plan %s', regionId => {
  const { town, county, plan } = buildCity(regionId);

  it('names the Downtown county for the city and plays the plan\'s level', () => {
    expect(county.name).toBe(plan.name);
    expect(county.mapName).toBe(plan.name);
    expect(county.level.landmark.buildingId).toBe(plan.landmarks[0]!.buildingId);
    expect(county.level.generation.buildingCount).toBe(plan.fillCount + 1);
    expect(county.level.dollarTarget).toBe(plan.dollarTarget);
  });

  it('stands every landmark exactly where the plan pins it', () => {
    expect(town.diagnostic.issues).toEqual([]);
    for (const [index, pin] of plan.landmarks.entries()) {
      const building = town.buildings.find(entry => entry.archetypeId === pin.buildingId);
      expect(building, pin.buildingId).toBeDefined();
      expect(building!.x).toBeCloseTo(pin.x, 5);
      expect(building!.y).toBeCloseTo(pin.y, 5);
      expect(!!building!.campaignLandmark).toBe(index === 0);
      if (index > 0) expect(building!.regionalSignature).toBe(pin.label);
    }
    expect(town.buildings.filter(building => building.campaignLandmark)).toHaveLength(1);
  });

  it('fills the rest with a legal downtown mix', () => {
    expect(town.buildings).toHaveLength(plan.fillCount + plan.landmarks.length);
    expect(evaluateCampaignComposition(town.buildings, county.level, ARCHETYPES).issues).toEqual([]);
  });

  it('keeps buildings on dry land, off the streets, out of the parks and clear of each other', () => {
    for (const building of town.buildings) {
      const w = building.w * building.cellSize, d = building.d * building.cellSize;
      for (const [x, y] of [[building.x, building.y], [building.x + w, building.y], [building.x, building.y + d], [building.x + w, building.y + d], [building.x + w / 2, building.y + d / 2]] as const) {
        expect(surfaceAt(town.surface, x, y), `${building.archetypeId} at ${x},${y}`).not.toBe('water');
      }
      expect(aabbOverlapsRoad(town.network, building.x, building.y, w, d), `${building.archetypeId} on a street`).toBe(false);
      expect(plan.parks.some(park => aabbOverlap(building.x, building.y, w, d, park.x, park.y, park.w, park.d)), `${building.archetypeId} in a park`).toBe(false);
      for (const other of town.buildings) {
        if (other === building) continue;
        expect(aabbOverlap(building.x, building.y, w, d, other.x, other.y, other.w * other.cellSize, other.d * other.cellSize), `${building.archetypeId} overlaps ${other.archetypeId}`).toBe(false);
      }
    }
  });

  it('spawns the dozer on open ground with every street reachable', () => {
    expect(traversalAt(town.surface, town.spawnX, town.spawnY)).toBe('open');
    expect(publicStreetsReachable(town.network, town.spawnX, town.spawnY)).toBe(true);
  });

  it('builds the same city for the same county', () => {
    const again = buildCity(regionId).town;
    expect(again.buildings.map(building => `${building.archetypeId}@${building.x.toFixed(2)},${building.y.toFixed(2)}`))
      .toEqual(town.buildings.map(building => `${building.archetypeId}@${building.x.toFixed(2)},${building.y.toFixed(2)}`));
  });
});
