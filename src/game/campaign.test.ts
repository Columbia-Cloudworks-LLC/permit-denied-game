import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS, CAMPAIGN_LEVEL_COUNT, campaignLevelAt, isCampaignLevelId } from './campaign';
import {
  applyCampaignOutcome,
  advanceCampaignLevel,
  creditCampaignEarnings,
  dollarsReady,
  evaluateCampaignStep,
  retryCampaignLevel,
  spendCampaignCash,
  startCampaign,
} from './campaignRun';
import { COPY } from './constants';

describe('campaign configuration', () => {
  it('orders seven distinct levels with City Borough spelling', () => {
    expect(CAMPAIGN_LEVEL_COUNT).toBe(7);
    expect(CAMPAIGN_LEVELS.map(level => level.id)).toEqual([
      'county', 'village', 'township', 'suburb', 'city-borough', 'city-downtown', 'governors-mansion',
    ]);
    expect(CAMPAIGN_LEVELS[4]!.name).toBe('City Borough');
    expect(CAMPAIGN_LEVELS.map(level => level.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(CAMPAIGN_LEVELS.map(level => level.landmark.buildingId)).toEqual([
      'county-sheriff-office', 'village-hall', 'township-hall', 'district-police-station',
      'police-headquarters', 'city-hall', 'governors-mansion',
    ]);
    for (const level of CAMPAIGN_LEVELS) {
      expect(level.dollarTarget).toBeGreaterThan(0);
      expect(level.timeLimit).toBeGreaterThan(60);
      expect(level.landmark.structureIds).toContain(level.landmark.buildingId);
    }
    expect(isCampaignLevelId('city-borough')).toBe(true);
    expect(isCampaignLevelId('d30')).toBe(false);
    expect(campaignLevelAt(0).id).toBe('county');
  });
});

describe('campaign objectives', () => {
  it('requires both objectives and accepts either completion order', () => {
    const base = { timeLeft: 20, heat: 0, track: 0, expired: false, alreadyComplete: false };
    expect(evaluateCampaignStep({ ...base, landmarkReady: true, dollarsReady: false })).toBe('continue');
    expect(evaluateCampaignStep({ ...base, landmarkReady: false, dollarsReady: true })).toBe('continue');
    expect(evaluateCampaignStep({ ...base, landmarkReady: true, dollarsReady: true })).toBe('win');
  });

  it('never wins after expiry even if both objectives later complete', () => {
    expect(evaluateCampaignStep({
      timeLeft: 0, heat: 0, track: 0, landmarkReady: true, dollarsReady: true, expired: true, alreadyComplete: false,
    })).toBe('clock');
    expect(evaluateCampaignStep({
      timeLeft: 0, heat: 0, track: 0, landmarkReady: true, dollarsReady: true, expired: false, alreadyComplete: false,
    })).toBe('clock');
  });

  it('resolves vehicle failure after a live success check', () => {
    expect(evaluateCampaignStep({
      timeLeft: 10, heat: 100, track: 0, landmarkReady: true, dollarsReady: true, expired: false, alreadyComplete: false,
    })).toBe('win');
    expect(evaluateCampaignStep({
      timeLeft: 10, heat: 100, track: 0, landmarkReady: false, dollarsReady: false, expired: false, alreadyComplete: false,
    })).toBe('engine');
    expect(evaluateCampaignStep({
      timeLeft: 10, heat: 0, track: 100, landmarkReady: false, dollarsReady: false, expired: false, alreadyComplete: false,
    })).toBe('track');
  });
});

describe('campaign run flow', () => {
  it('starts at County, carries upgrades, and restores retry entry state', () => {
    const run = startCampaign(19);
    expect(run.levelIndex).toBe(0);
    expect(run.briefing).toBe(true);
    creditCampaignEarnings(run, 500);
    run.upgrades.blade = 1;
    run.nextUpgrade = 1;
    expect(spendCampaignCash(run, 80)).toBe(true);
    expect(run.levelEarned).toBe(500);
    expect(run.spendable).toBe(420);
    expect(dollarsReady(run)).toBe(false);

    const retried = retryCampaignLevel(run);
    expect(retried.levelIndex).toBe(0);
    expect(retried.levelSeed).toBe(19);
    expect(retried.upgrades).toEqual({ blade: 0, engine: 0, push: 0 });
    expect(retried.levelEarned).toBe(0);
    expect(retried.campaignEarned).toBe(0);
    expect(retried.spendable).toBe(0);

    run.complete = true;
    const next = advanceCampaignLevel(run, 99);
    expect(next.levelIndex).toBe(1);
    expect(next.levelSeed).toBe(99);
    expect(next.upgrades.blade).toBe(1);
    expect(next.levelEarned).toBe(0);
    expect(next.campaignEarned).toBe(500);
    expect(next.briefing).toBe(true);
  });

  it('maps outcomes to copy and campaign victory on the mansion', () => {
    const run = startCampaign(1);
    run.levelIndex = 6;
    expect(applyCampaignOutcome(run, 'win')).toBeNull();
    expect(run.victory).toBe(true);
    expect(applyCampaignOutcome(startCampaign(1), 'engine')).toBe(COPY.engineCooked);
    expect(applyCampaignOutcome(startCampaign(1), 'track')).toBe(COPY.trackThrown);
    expect(applyCampaignOutcome(startCampaign(1), 'clock')).toBe(COPY.countyClock);
  });
});
