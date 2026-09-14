import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS, campaignLevelById } from '../game/campaign';
import { landmarkDemolitionStatus } from '../game/campaignRun';
import { availableTownValue, landmarkShare } from '../game/campaignValue';
import { campaignEligible } from './campaignPlacement';
import { campaignFamily, evaluateCampaignComposition, heightClass } from './campaignComposition';
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

  it('places mid-rise Borough and skyscraper Downtown maps on eight seeds', () => {
    const seeds = [19, 0x51a11, 77, 1001, 42, 2026, 7, 31415];
    for (const id of ['city-borough', 'city-downtown'] as const) {
      const level = campaignLevelById(id);
      for (const seed of seeds) {
        const a = generateCampaignLayout(level, seed);
        const b = generateCampaignLayout(level, seed);
        expect(a.buildings.map(building => `${building.archetypeId}:${building.x}:${building.y}`))
          .toEqual(b.buildings.map(building => `${building.archetypeId}:${building.x}:${building.y}`));
        expect(a.buildings.filter(building => building.campaignLandmark)).toHaveLength(1);
        expect(a.buildings).toHaveLength(level.generation.buildingCount);
        const report = evaluateCampaignComposition(a.buildings, level, ARCHETYPES);
        expect(report.ok, `${id} seed ${seed}: ${report.issues.join('; ')}`).toBe(true);
        expect(report.ordinary).toBe(level.generation.buildingCount - 1);
        if (id === 'city-borough') {
          expect(report.byClass.skyscraper).toBe(0);
          expect(report.byClass['mid-rise'] / report.ordinary).toBeGreaterThanOrEqual(0.8);
        } else {
          const tall = a.buildings.filter(building => !building.campaignLandmark && heightClass(
            ARCHETYPES.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors,
          ) !== 'low-rise').length;
          expect(tall / report.ordinary).toBeGreaterThanOrEqual(0.95);
          expect(report.byClass.skyscraper / report.ordinary).toBeGreaterThanOrEqual(0.3);
        }
        const families = new Set(a.buildings.filter(building => !building.campaignLandmark).map(building => {
          const def = ARCHETYPES.find(entry => entry.id === building.archetypeId)!;
          return campaignFamily(def);
        }));
        expect(families.size, `${id} seed ${seed} families`).toBeGreaterThanOrEqual(3);
        const town = createTown({ district: 'd30', seed, campaign: level });
        expect(validateTown(town).ok, `${id} seed ${seed} ${validateTown(town).issues.map(issue => issue.detail).join('; ')}`).toBe(true);
        expect(availableTownValue(town)).toBeGreaterThan(level.dollarTarget);
        expect(landmarkShare(town, level.landmark.structureIds)).toBeLessThan(level.dollarTarget);
      }
    }
  }, 180_000);

  it('keeps city public streets next to the lot cluster', () => {
    for (const id of ['city-borough', 'city-downtown'] as const) {
      const level = campaignLevelById(id);
      const town = createTown({ district: 'd30', seed: 19, campaign: level });
      const pad = 16;
      const far = town.network.segments.filter((seg) => {
        if (seg.roadClass === 'driveway' || seg.roadClass === 'ramp') return false;
        return [0, 0.25, 0.5, 0.75, 1].every((t) => {
          const i = Math.min(seg.points.length - 1, Math.round(t * (seg.points.length - 1)));
          const p = seg.points[i]!;
          return town.lots.every((lot) => {
            const dx = Math.max(lot.x - p.x, 0, p.x - lot.x - lot.w);
            const dy = Math.max(lot.y - p.y, 0, p.y - lot.y - lot.d);
            return dx * dx + dy * dy > pad * pad;
          });
        });
      });
      expect(far.length, `${id} unused outer roads`).toBeLessThanOrEqual(1);
      const bMinX = Math.min(...town.buildings.map((building) => building.x));
      const bMinY = Math.min(...town.buildings.map((building) => building.y));
      const bMaxX = Math.max(...town.buildings.map((building) => building.x + building.w * building.cellSize));
      const bMaxY = Math.max(...town.buildings.map((building) => building.y + building.d * building.cellSize));
      const rMinX = Math.min(...town.network.nodes.map((node) => node.x));
      const rMinY = Math.min(...town.network.nodes.map((node) => node.y));
      const rMaxX = Math.max(...town.network.nodes.map((node) => node.x));
      const rMaxY = Math.max(...town.network.nodes.map((node) => node.y));
      expect(rMinX, id).toBeGreaterThan(bMinX - 40);
      expect(rMinY, id).toBeGreaterThan(bMinY - 40);
      expect(rMaxX, id).toBeLessThan(bMaxX + 40);
      expect(rMaxY, id).toBeLessThan(bMaxY + 40);
    }
  });
});
