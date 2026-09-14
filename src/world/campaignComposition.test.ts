import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS, campaignLevelById } from '../game/campaign';
import { Rng } from '../game/rng';
import { ParticlePool } from '../fx/particles';
import { createBuildingFromDefinition, stepStructures } from '../structure/building';
import { ARCHETYPES } from './archetypes';
import {
  campaignFamily,
  eligibleOrdinary,
  evaluateCampaignComposition,
  heightClass,
  planCampaignComposition,
} from './campaignComposition';
import { campaignEligible } from './campaignPlacement';

const URBAN_IDS = [
  'walkup-block', 'avenue-apartments', 'terrace-apartments',
  'bakery-walkup', 'laundry-lofts', 'market-apartments',
  'courtyard-midrise', 'corner-apartments', 'stepped-apartments',
  'office-slab-eight', 'office-stepped-ten', 'office-compact-twelve',
  'plaza-office-tower', 'needle-office', 'setback-office-tower',
  'residence-tower', 'twin-residence', 'crown-apartments',
] as const;

describe('campaign composition rules', () => {
  it('classifies occupied stories and discovers the urban roster', () => {
    expect(heightClass(4)).toBe('low-rise');
    expect(heightClass(5)).toBe('mid-rise');
    expect(heightClass(12)).toBe('mid-rise');
    expect(heightClass(13)).toBe('high-rise');
    expect(heightClass(20)).toBe('skyscraper');
    for (const id of URBAN_IDS) {
      const def = ARCHETYPES.find(entry => entry.id === id);
      expect(def, id).toBeTruthy();
      expect(def!.campaign?.family, id).toBeTruthy();
    }
    expect(ARCHETYPES.find(entry => entry.id === 'union-tower')?.campaign).toBeUndefined();
    expect(campaignEligible(ARCHETYPES.find(entry => entry.id === 'bakery')!.campaign, 'city-downtown')).toBe(false);
    expect(campaignEligible(ARCHETYPES.find(entry => entry.id === 'walkup')!.campaign, 'city-borough')).toBe(false);
    expect(campaignEligible(ARCHETYPES.find(entry => entry.id === 'parking-garage')!.campaign, 'city-downtown')).toBe(true);
    expect(ARCHETYPES.find(entry => entry.id === 'parking-garage')!.campaign?.exception).toBe(true);
  });

  it('plans Borough and Downtown quotas without repeating a variant past 20%', () => {
    const lots = Array.from({ length: 40 }, (_, i) => ({
      id: `lot${i}`,
      buildable: { x: 0, y: 0, w: 14 - (i % 4), d: 13 - (i % 3) },
      templateId: i < 12 ? 'tower' : i < 24 ? 'standard' : 'compact',
    }));
    for (const id of ['city-borough', 'city-downtown'] as const) {
      const level = campaignLevelById(id);
      const plan = planCampaignComposition(level, lots as never, id === 'city-borough' ? 31 : 35, ARCHETYPES, new Rng(19));
      expect(plan.issues, plan.issues.join('; ')).toEqual([]);
      const needed = id === 'city-borough' ? 31 : 35;
      expect(plan.assignments).toHaveLength(needed);
      const counts = new Map<string, number>();
      for (const item of plan.assignments) counts.set(item.buildingId, (counts.get(item.buildingId) ?? 0) + 1);
      expect(counts.size).toBeGreaterThanOrEqual(6);
      const cap = Math.floor(needed * 0.2);
      for (const [buildingId, count] of counts) {
        expect(count, buildingId).toBeLessThanOrEqual(cap);
      }
      const sky = plan.assignments.filter(item => (ARCHETYPES.find(entry => entry.id === item.buildingId)?.floors ?? 0) >= 20).length;
      if (id === 'city-borough') expect(sky).toBe(0);
      else expect(sky / needed).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('keeps County through Suburb and the mansion free of the city composition contract', () => {
    for (const level of CAMPAIGN_LEVELS) {
      if (level.id === 'city-borough' || level.id === 'city-downtown') {
        expect(level.composition).toBeTruthy();
        continue;
      }
      expect(level.composition).toBeUndefined();
      const report = evaluateCampaignComposition([], level, ARCHETYPES);
      expect(report.ok).toBe(true);
    }
    const borough = eligibleOrdinary(campaignLevelById('city-borough'), ARCHETYPES);
    expect(borough.every(entry => entry.floors < 20 || entry.campaign?.exception)).toBe(true);
    expect(borough.some(entry => campaignFamily(entry) === 'mixed-use')).toBe(true);
  });

  it('keeps urban variants standing without player damage', () => {
    for (const id of URBAN_IDS) {
      const def = ARCHETYPES.find(entry => entry.id === id)!;
      const building = createBuildingFromDefinition(def, def.label, 10, 10);
      const particles = new ParticlePool();
      for (let frame = 0; frame < 180; frame++) stepStructures([building], 1 / 60, particles, []);
      expect(building.cells.every(cell => cell.state === 'intact'), `${id}: spontaneous structural failure`).toBe(true);
      expect(building.fixtures.every(fixture => !fixture.broken), `${id}: unsupported fixture`).toBe(true);
      expect(building.roofs.every(roof => roof.state === 'intact'), `${id}: unsupported roof`).toBe(true);
    }
  });
});
