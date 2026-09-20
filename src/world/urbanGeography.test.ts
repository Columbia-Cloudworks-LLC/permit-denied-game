import { describe, expect, it } from 'vitest';
import { pumpVitestRpc } from '../sim/benchSupport';
import { CAMPAIGN_LEVELS, campaignLevelById } from '../game/campaign';
import { availableTownValue, landmarkShare } from '../game/campaignValue';
import { landmarkDemolitionStatus } from '../game/campaignRun';
import { ARCHETYPES } from './archetypes';
import { campaignEligible } from './campaignPlacement';
import { evaluateCampaignComposition } from './campaignComposition';
import { generateCampaignLayout } from './campaignLayout';
import { createTown } from './town';
import { validateTown } from './districts';
import { URBAN_BANDS } from './urbanBands';
import {
  URBAN_FABRIC_THRESHOLDS,
  evaluateUrbanFabric,
  urbanDebugDump,
} from './urbanGeography';

const CITY_SEEDS = [19, 0x51a11, 77, 1001, 42, 2026, 7, 31415];
const PLAY_SEEDS = [19, 0x51a11, 77, 1001];

describe('campaign urban geography', () => {
  it('tags every campaign building with an explicit urban band', () => {
    const campaign = ARCHETYPES.filter(entry => entry.campaign);
    expect(campaign.length).toBeGreaterThan(40);
    for (const def of campaign) {
      expect(def.campaign!.urbanBands?.length, def.id).toBeGreaterThan(0);
      for (const band of def.campaign!.urbanBands!) {
        expect(URBAN_BANDS, `${def.id} ${band}`).toContain(band);
      }
    }
    expect(ARCHETYPES.find(entry => entry.id === 'ranch')!.campaign!.urbanBands).toContain('rural');
    expect(ARCHETYPES.find(entry => entry.id === 'storefront')!.campaign!.urbanBands).toContain('downtown-transition');
    expect(ARCHETYPES.find(entry => entry.id === 'needle-office')!.campaign!.urbanBands).toEqual(['downtown-core']);
    expect(ARCHETYPES.find(entry => entry.id === 'bakery')!.campaign!.urbanBands).not.toContain('downtown-core');
    expect(ARCHETYPES.find(entry => entry.id === 'union-tower')!.campaign).toBeUndefined();
    expect(ARCHETYPES.find(entry => entry.id === 'ranch')!.zones.residential).toBeGreaterThan(0);
  });

  it('classifies City Borough and City Downtown lots by world-space band on eight seeds', async () => {
    for (const id of ['city-borough', 'city-downtown'] as const) {
      const level = campaignLevelById(id);
      for (const seed of CITY_SEEDS) {
        const a = generateCampaignLayout(level, seed);
        const b = generateCampaignLayout(level, seed);
        expect(a.buildings.map(building => `${building.archetypeId}:${building.x}:${building.y}`))
          .toEqual(b.buildings.map(building => `${building.archetypeId}:${building.x}:${building.y}`));
        expect(a.lots.map(lot => `${lot.id}:${lot.urbanBand}:${lot.districtRole}`))
          .toEqual(b.lots.map(lot => `${lot.id}:${lot.urbanBand}:${lot.districtRole}`));
        expect(a.buildings).toHaveLength(level.generation.buildingCount);
        expect(a.buildings.filter(building => building.campaignLandmark)).toHaveLength(1);
        expect(a.urban, `${id} seed ${seed}`).toBeTruthy();
        expect(a.lots.every(lot => lot.urbanBand && lot.districtRole), `${id} seed ${seed} unclassified lot`).toBe(true);

        const report = evaluateCampaignComposition(a.buildings, level, ARCHETYPES);
        expect(report.ok, `${id} seed ${seed}: ${report.issues.join('; ')}`).toBe(true);
        const fabric = evaluateUrbanFabric(level, a.buildings, a.lots, a.urban!, ARCHETYPES, a.network.segments, a.network.nodes);
        expect(fabric.ok, `${id} seed ${seed}: ${fabric.issues.join('; ')}`).toBe(true);
        expect(fabric.coreOneStory).toBe(0);
        expect(fabric.coreFourPlus).toBeGreaterThanOrEqual(URBAN_FABRIC_THRESHOLDS[id].coreMinFourPlus);

        if (id === 'city-downtown') {
          const core = a.buildings.filter(building => {
            const lot = a.lots.find(entry => entry.id === building.lotId);
            return lot?.districtRole === 'downtown-core' && !building.campaignLandmark;
          });
          expect(core.every(building => (ARCHETYPES.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors) >= 4)).toBe(true);
          const oneStory = a.buildings.filter(building => {
            const floors = ARCHETYPES.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors;
            return floors <= 1 && !building.campaignLandmark;
          });
          for (const building of oneStory) {
            const lot = a.lots.find(entry => entry.id === building.lotId);
            expect(['transition-ring', 'borough-edge', 'industrial-service-edge']).toContain(lot?.districtRole);
          }
        }

        const dump = urbanDebugDump(level, seed, a.buildings, a.lots, a.urban!, ARCHETYPES);
        expect(dump.level).toBe(id);
        expect(dump.seed).toBe(seed);
        await pumpVitestRpc();
      }
    }
  }, 240_000);

  it('keeps earlier campaign levels on their geography without leaking rural stock into city cores', async () => {
    for (const seed of PLAY_SEEDS) {
      for (const level of CAMPAIGN_LEVELS) {
        const layout = generateCampaignLayout(level, seed);
        expect(layout.buildings).toHaveLength(level.generation.buildingCount);
        expect(layout.lots.every(lot => lot.urbanBand && lot.districtRole), `${level.id} ${seed}`).toBe(true);
        if (level.id === 'county') {
          expect(layout.lots.every(lot => lot.districtRole === 'rural' || lot.districtRole === 'scattered')).toBe(true);
        }
        if (level.id === 'governors-mansion') {
          expect(layout.lots.every(lot => lot.urbanBand === 'estate')).toBe(true);
        }
        if (level.id === 'city-downtown' || level.id === 'city-borough') {
          for (const building of layout.buildings) {
            const def = ARCHETYPES.find(entry => entry.id === building.archetypeId)!;
            const lot = layout.lots.find(entry => entry.id === building.lotId);
            if (lot?.urbanBand === 'downtown-core') {
              expect(def.campaign?.urbanBands?.includes('rural') && def.floors <= 2, `${building.archetypeId} rural leak`).toBe(false);
              expect(def.floors >= 4 || !!def.campaign?.exception, `${building.archetypeId} in core`).toBe(true);
            }
          }
        }
        await pumpVitestRpc();
      }
    }
  }, 180_000);

  it('validates playability across the seven-level seed matrix', async () => {
    for (const level of CAMPAIGN_LEVELS) {
      for (const seed of PLAY_SEEDS) {
        const layout = generateCampaignLayout(level, seed);
        const landmarks = layout.buildings.filter(building => building.campaignLandmark);
        expect(landmarks).toHaveLength(1);
        expect(landmarks[0]!.archetypeId).toBe(level.landmark.buildingId);
        expect(landmarkDemolitionStatus(layout.buildings, level).targets).toHaveLength(1);
        const town = createTown({ district: 'd30', seed, campaign: level });
        const check = validateTown(town);
        expect(check.ok, `${level.id} seed ${seed} ${check.issues.map(issue => issue.detail).join('; ')}`).toBe(true);
        expect(availableTownValue(town)).toBeGreaterThan(level.dollarTarget);
        expect(landmarkShare(town, level.landmark.structureIds)).toBeLessThan(level.dollarTarget);
        for (const building of town.buildings) {
          const def = ARCHETYPES.find(entry => entry.id === building.archetypeId);
          expect(campaignEligible(def!.campaign, level.id, { landmark: !!building.campaignLandmark || !!def!.campaign?.landmarkOnly })).toBe(true);
        }
        await pumpVitestRpc();
      }
    }
  }, 180_000);
});
