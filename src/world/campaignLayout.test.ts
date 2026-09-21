import { describe, expect, it } from 'vitest';
import { pumpVitestRpc } from '../sim/benchSupport';
import { CAMPAIGN_LEVELS, campaignLevelById } from '../game/campaign';
import { landmarkDemolitionStatus } from '../game/campaignRun';
import { availableTownValue, landmarkShare } from '../game/campaignValue';
import { campaignEligible } from './campaignPlacement';
import { campaignFamily, evaluateCampaignComposition } from './campaignComposition';
import { generateCampaignLayout } from './campaignLayout';
import { getAsset } from './catalog';
import { DRESS_TEMPLATES } from './dressing';
import { createTown } from './town';
import { validateTown } from './districts';
import { ARCHETYPES } from './archetypes';
import { identityFromBuilding, lotAllowsAgriculture, lotAllowsFuel } from './lotUse';
import type { FieldFeature } from './terrainFeatures';

const AGRICULTURAL_PROPS = new Set([
  'hay-bale-round',
  'hay-bale-square',
  'water-trough',
  'farm-implement',
  'tractor',
  'grain-bin',
]);

function expectLotUseMatchesBuilding(town: ReturnType<typeof createTown>, label: string): void {
  const byLot = new Map(town.lots.map((lot) => [lot.id, lot]));
  for (const building of town.buildings) {
    const lot = byLot.get(building.lotId ?? '');
    if (!lot) continue;
    expect(lot.identity, `${label} ${building.archetypeId} ${lot.id}`).toBe(identityFromBuilding(building));
    if (!lot.templateId) continue;
    const template = DRESS_TEMPLATES.find((entry) => entry.id === lot.templateId);
    expect(template?.identities, `${label} ${lot.id} template`).toContain(lot.identity);
  }
  for (const prop of town.props) {
    if (!prop.lotId) continue;
    const lot = byLot.get(prop.lotId);
    if (!lot) continue;
    if (prop.assetId === 'fuel-pump') {
      expect(lotAllowsFuel(lot.identity), `${label} fuel-pump on ${lot.id}`).toBe(true);
    }
    if (AGRICULTURAL_PROPS.has(prop.assetId)) {
      expect(lotAllowsAgriculture(lot.identity), `${label} ${prop.assetId} on ${lot.id}`).toBe(true);
    }
  }
  for (const feature of town.features) {
    if (feature.kind !== 'field' || !feature.lotId) continue;
    const field = feature as FieldFeature;
    const lot = byLot.get(field.lotId ?? '');
    expect(lotAllowsAgriculture(lot!.identity), `${label} field on ${lot?.id}`).toBe(true);
  }
}

const SEEDS = [19, 0x51a11, 77, 1001];

describe('campaign generation', () => {
  it('builds a deterministic reachable landmark on every level and seed', async () => {
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
        expectLotUseMatchesBuilding(town, `${level.id} seed ${seed}`);
        if (level.id === 'city-downtown' && seed === 19) {
          for (const id of ['apartment-tower', 'laundry-lofts'] as const) {
            for (const building of town.buildings.filter((entry) => entry.archetypeId === id)) {
              const lot = town.lots.find((entry) => entry.id === building.lotId);
              expect(lotAllowsAgriculture(lot!.identity), `${id} ${lot?.id}`).toBe(false);
              expect(town.features.some((feature) => feature.kind === 'field' && feature.lotId === lot!.id)).toBe(false);
            }
          }
        }
        expect(validateTown(town).ok, `${level.id} seed ${seed} ${validateTown(town).issues.map(i => i.detail).join('; ')}`).toBe(true);
        expect(availableTownValue(town)).toBeGreaterThan(level.dollarTarget);
        expect(landmarkShare(town, level.landmark.structureIds)).toBeLessThan(level.dollarTarget);
        await pumpVitestRpc();
      }
    }
  });

  it('only places campaign-eligible buildings and props', async () => {
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
      expectLotUseMatchesBuilding(town, `${level.id} seed 19 eligible`);
      await pumpVitestRpc();
    }
  });

  it('increases density from County through City Downtown', async () => {
    const footprints: { id: string; count: number; coverage: number; setback: number }[] = [];
    for (const level of CAMPAIGN_LEVELS.slice(0, 6)) {
      const town = createTown({ district: 'd30', seed: 19, campaign: level });
      const area = Math.max(1, (town.maxX - town.minX) * (town.maxY - town.minY));
      const covered = town.buildings.reduce((sum, building) => sum + building.w * building.d * building.cellSize * building.cellSize, 0);
      footprints.push({ id: level.id, count: town.buildings.length, coverage: covered / area, setback: town.lots[0]?.setbacks.side ?? 0 });
      await pumpVitestRpc();
    }
    for (let i = 1; i < footprints.length; i++) {
      expect(footprints[i]!.count, `${footprints[i]!.id} count`).toBeGreaterThanOrEqual(footprints[i - 1]!.count);
    }
    expect(footprints[0]!.coverage).toBeLessThan(footprints[5]!.coverage);
    expect(footprints[0]!.setback).toBeGreaterThan(footprints[5]!.setback);
  });

  it('places mid-rise Borough and skyscraper Downtown maps on eight seeds', async () => {
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
          const mid = a.buildings.filter(building => {
            if (building.campaignLandmark) return false;
            const floors = ARCHETYPES.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors;
            return floors >= 2 && floors <= 8;
          }).length;
          expect(mid / report.ordinary).toBeGreaterThanOrEqual(0.65);
        } else {
          const fourPlus = a.buildings.filter(building => !building.campaignLandmark && (
            ARCHETYPES.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors
          ) >= 4).length;
          expect(fourPlus / report.ordinary).toBeGreaterThanOrEqual(0.7);
          expect(report.byClass.skyscraper / report.ordinary).toBeGreaterThanOrEqual(0.22);
        }
        const families = new Set(a.buildings.filter(building => !building.campaignLandmark).map(building => {
          const def = ARCHETYPES.find(entry => entry.id === building.archetypeId)!;
          return campaignFamily(def);
        }));
        expect(families.size, `${id} seed ${seed} families`).toBeGreaterThanOrEqual(3);
        const town = createTown({ district: 'd30', seed, campaign: level });
        expectLotUseMatchesBuilding(town, `${id} seed ${seed}`);
        expect(validateTown(town).ok, `${id} seed ${seed} ${validateTown(town).issues.map(issue => issue.detail).join('; ')}`).toBe(true);
        expect(availableTownValue(town)).toBeGreaterThan(level.dollarTarget);
        expect(landmarkShare(town, level.landmark.structureIds)).toBeLessThan(level.dollarTarget);
        await pumpVitestRpc();
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
