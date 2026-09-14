import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS } from '../game/campaign';
import { ARCHETYPES } from './archetypes';
import { BUILDING_SITES, parseBuildingSites, SITE_FILES } from './buildingSites';
import { ASSET_CATALOG } from './catalog';
import { campaignEligible, parseCampaignPlacement } from './campaignPlacement';

describe('campaign placement metadata', () => {
  it('is opt-in and rejects invalid level ids and weights', () => {
    expect(campaignEligible(undefined, 'county')).toBe(false);
    expect(parseCampaignPlacement({ levels: { county: 2 } }, 'ok').levels.county).toBe(2);
    expect(() => parseCampaignPlacement({ levels: { d30: 1 } }, 'bad')).toThrow('invalid campaign level id');
    expect(() => parseCampaignPlacement({ levels: { county: -1 } }, 'bad')).toThrow('weight');
    expect(() => parseCampaignPlacement({ levels: {} }, 'bad')).toThrow('at least one level');
  });

  it('keeps landmarks on their own level and leaves sandbox zoning alone', () => {
    for (const level of CAMPAIGN_LEVELS) {
      const landmark = ARCHETYPES.find(a => a.id === level.landmark.buildingId);
      expect(landmark, level.landmark.buildingId).toBeTruthy();
      expect(landmark!.campaign?.landmarkOnly).toBe(true);
      expect(campaignEligible(landmark!.campaign, level.id, { landmark: true })).toBe(true);
      for (const other of CAMPAIGN_LEVELS) {
        if (other.id === level.id) continue;
        expect(campaignEligible(landmark!.campaign, other.id, { landmark: true })).toBe(false);
      }
      expect(Object.values(landmark!.zones).every(weight => weight === 0)).toBe(true);
    }
    expect(ARCHETYPES.find(a => a.id === 'ranch')!.zones.residential).toBeGreaterThan(0);
    expect(campaignEligible(ARCHETYPES.find(a => a.id === 'ranch')!.campaign, 'county')).toBe(true);
  });

  it('does not let sites bypass constituent building eligibility', () => {
    const files = structuredClone(SITE_FILES);
    const civic = Object.entries(files).find(([, site]) => (site as { id: string }).id === 'civic-block')!;
    (files[civic[0]!] as { campaign?: { levels: Record<string, number> } }).campaign = { levels: { county: 1 } };
    expect(() => parseBuildingSites(files, ARCHETYPES, ASSET_CATALOG)).toThrow(/not eligible for county/);
  });

  it('discovers landmark packages and the estate site', () => {
    for (const id of [
      'county-sheriff-office', 'village-hall', 'township-hall', 'district-police-station',
      'police-headquarters', 'city-hall', 'governors-mansion', 'mansion-gatehouse',
    ]) {
      expect(ARCHETYPES.some(a => a.id === id), id).toBe(true);
    }
    expect(BUILDING_SITES.some(site => site.id === 'governors-estate')).toBe(true);
    expect(ASSET_CATALOG.find(a => a.id === 'mailbox')?.campaign).toBeTruthy();
    expect(ASSET_CATALOG.find(a => a.id === 'tractor')?.campaign?.levels.county).toBeGreaterThan(0);
  });
});
