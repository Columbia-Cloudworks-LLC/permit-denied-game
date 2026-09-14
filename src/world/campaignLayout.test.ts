import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS } from '../game/campaign';
import { landmarkDemolitionStatus } from '../game/campaignRun';
import { availableTownValue, landmarkShare } from '../game/campaignValue';
import { campaignEligible } from './campaignPlacement';
import { generateCampaignLayout } from './campaignLayout';
import { getAsset } from './catalog';
import { createTown } from './town';
import { validateTown } from './districts';
import { ARCHETYPES } from './archetypes';

const SEEDS = [19, 0x51a11, 77, 1001];

describe('campaign generation', () => {
  it('builds a deterministic reachable landmark on every level and seed', () => {
    for (const level of CAMPAIGN_LEVELS) {
      for (const seed of SEEDS) {
        const a = generateCampaignLayout(level, seed);
        const b = generateCampaignLayout(level, seed);
        expect(a.buildings.map(building => `${building.archetypeId}:${building.x}:${building.y}`))
          .toEqual(b.buildings.map(building => `${building.archetypeId}:${building.x}:${building.y}`));
        const landmarks = a.buildings.filter(building => building.campaignLandmark);
        expect(landmarks, `${level.id} seed ${seed} landmark count`).toHaveLength(1);
        expect(landmarks[0]!.archetypeId).toBe(level.landmark.buildingId);
        const status = landmarkDemolitionStatus(a.buildings, level);
        expect(status.targets).toHaveLength(1);
        expect(status.ready).toBe(false);
        expect(status.progress).toBe(0);
        const town = createTown({ district: 'd30', seed, campaign: level });
        expect(validateTown(town).ok, `${level.id} seed ${seed} ${validateTown(town).issues.map(i => i.detail).join('; ')}`).toBe(true);
        expect(availableTownValue(town)).toBeGreaterThan(level.dollarTarget);
        expect(landmarkShare(town, level.landmark.structureIds)).toBeLessThan(level.dollarTarget);
      }
    }
  });

  it('only places campaign-eligible buildings and props', () => {
    for (const level of CAMPAIGN_LEVELS) {
      const town = createTown({ district: 'd30', seed: 19, campaign: level });
      for (const building of town.buildings) {
        const def = ARCHETYPES.find(a => a.id === building.archetypeId);
        expect(def, building.archetypeId).toBeTruthy();
        expect(
          campaignEligible(def!.campaign, level.id, { landmark: !!building.campaignLandmark || !!def!.campaign?.landmarkOnly }),
          `${building.archetypeId} on ${level.id}`,
        ).toBe(true);
      }
      for (const prop of town.props) {
        expect(campaignEligible(getAsset(prop.assetId).campaign, level.id), prop.assetId).toBe(true);
      }
    }
  });

  it('increases density from County through City Downtown', () => {
    const footprints = CAMPAIGN_LEVELS.slice(0, 6).map(level => {
      const town = createTown({ district: 'd30', seed: 19, campaign: level });
      const area = Math.max(1, (town.maxX - town.minX) * (town.maxY - town.minY));
      const covered = town.buildings.reduce((sum, building) => sum + building.w * building.d * building.cellSize * building.cellSize, 0);
      return { id: level.id, count: town.buildings.length, coverage: covered / area, setback: town.lots[0]?.setbacks.side ?? 0 };
    });
    for (let i = 1; i < footprints.length; i++) {
      expect(footprints[i]!.count, `${footprints[i]!.id} count`).toBeGreaterThanOrEqual(footprints[i - 1]!.count);
    }
    expect(footprints[0]!.coverage).toBeLessThan(footprints[5]!.coverage);
    expect(footprints[0]!.setback).toBeGreaterThan(footprints[5]!.setback);
  });
});
