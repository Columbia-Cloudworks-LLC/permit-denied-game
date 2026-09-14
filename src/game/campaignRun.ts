import type { Building } from '../structure/types';
import type { Upgrades } from './upgrades';
import { COPY } from './constants';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_LEVEL_COUNT,
  campaignLevelAt,
  type CampaignLevelDef,
  type CampaignLevelId,
} from './campaign';

export type CampaignOutcome = 'continue' | 'win' | 'engine' | 'track' | 'clock';

export interface CampaignSnapshot {
  upgrades: Upgrades;
  nextUpgrade: number;
  campaignEarned: number;
}

export interface CampaignRun {
  levelIndex: number;
  campaignSeed: number;
  levelSeed: number;
  upgrades: Upgrades;
  nextUpgrade: number;
  levelEarned: number;
  campaignEarned: number;
  spendable: number;
  briefing: boolean;
  expired: boolean;
  complete: boolean;
  victory: boolean;
  entry: CampaignSnapshot;
}

export function emptyUpgrades(): Upgrades {
  return { blade: 0, engine: 0, push: 0 };
}

function cloneUpgrades(upgrades: Upgrades): Upgrades {
  return { blade: upgrades.blade, engine: upgrades.engine, push: upgrades.push };
}

function snapshot(run: Pick<CampaignRun, 'upgrades' | 'nextUpgrade' | 'campaignEarned'>): CampaignSnapshot {
  return { upgrades: cloneUpgrades(run.upgrades), nextUpgrade: run.nextUpgrade, campaignEarned: run.campaignEarned };
}

export function startCampaign(seed: number): CampaignRun {
  const run: CampaignRun = {
    levelIndex: 0,
    campaignSeed: seed >>> 0,
    levelSeed: seed >>> 0,
    upgrades: emptyUpgrades(),
    nextUpgrade: 0,
    levelEarned: 0,
    campaignEarned: 0,
    spendable: 0,
    briefing: true,
    expired: false,
    complete: false,
    victory: false,
    entry: { upgrades: emptyUpgrades(), nextUpgrade: 0, campaignEarned: 0 },
  };
  run.entry = snapshot(run);
  return run;
}

export function currentLevel(run: CampaignRun): CampaignLevelDef {
  return campaignLevelAt(run.levelIndex);
}

export function creditCampaignEarnings(run: CampaignRun, amount: number): void {
  if (!(amount > 0) || run.expired || run.complete) return;
  run.levelEarned += amount;
  run.campaignEarned += amount;
  run.spendable += amount;
}

export function spendCampaignCash(run: CampaignRun, amount: number): boolean {
  if (!(amount > 0) || amount > run.spendable) return false;
  run.spendable -= amount;
  return true;
}

export function landmarkBuildings(buildings: readonly Building[], level: CampaignLevelDef): Building[] {
  const ids = new Set(level.landmark.structureIds);
  return buildings.filter(building => building.campaignLandmark || ids.has(building.archetypeId));
}

/** Authoritative structural completion: 90% of original members gone and collapse settled. */
export function landmarkDemolitionStatus(buildings: readonly Building[], level: CampaignLevelDef) {
  const targets = landmarkBuildings(buildings, level);
  const original = targets.flatMap(building => building.cells);
  const gone = original.filter(cell => cell.state === 'gone').length;
  const unsettled = targets.some(building =>
    building.cells.some(cell => cell.state === 'falling') ||
    building.roofs.some(roof => roof.state === 'falling' || roof.state === 'sagging') ||
    building.floorTiles.some(tile => tile.state === 'falling'),
  );
  const need = Math.max(1, Math.ceil(original.length * 0.9));
  const progress = Math.min(1, gone / need);
  return { progress, ready: progress >= 1 && !unsettled && targets.length > 0, remaining: original.length - gone, targets };
}

export function dollarsReady(run: CampaignRun, level: CampaignLevelDef = currentLevel(run)): boolean {
  return run.levelEarned >= level.dollarTarget;
}

export function evaluateCampaignStep(input: {
  timeLeft: number;
  heat: number;
  track: number;
  landmarkReady: boolean;
  dollarsReady: boolean;
  expired: boolean;
  alreadyComplete: boolean;
}): CampaignOutcome {
  if (input.alreadyComplete) return 'win';
  if (input.expired) return input.timeLeft <= 0 ? 'clock' : 'continue';
  if (input.landmarkReady && input.dollarsReady && input.timeLeft > 0) return 'win';
  if (input.heat >= 100) return 'engine';
  if (input.track >= 100) return 'track';
  if (input.timeLeft <= 0) return 'clock';
  return 'continue';
}

export function applyCampaignOutcome(run: CampaignRun, outcome: CampaignOutcome): string | null {
  if (outcome === 'continue') return null;
  if (outcome === 'win') {
    run.complete = true;
    run.victory = run.levelIndex >= CAMPAIGN_LEVEL_COUNT - 1;
    return null;
  }
  run.expired = outcome === 'clock';
  run.complete = false;
  if (outcome === 'engine') return COPY.engineCooked;
  if (outcome === 'track') return COPY.trackThrown;
  return COPY.countyClock;
}

export function retryCampaignLevel(run: CampaignRun): CampaignRun {
  return {
    ...run,
    upgrades: cloneUpgrades(run.entry.upgrades),
    nextUpgrade: run.entry.nextUpgrade,
    levelEarned: 0,
    campaignEarned: run.entry.campaignEarned,
    spendable: 0,
    briefing: true,
    expired: false,
    complete: false,
    victory: false,
  };
}

export function advanceCampaignLevel(run: CampaignRun, nextSeed: number): CampaignRun {
  if (run.levelIndex >= CAMPAIGN_LEVEL_COUNT - 1) {
    return { ...run, victory: true, briefing: false };
  }
  const next: CampaignRun = {
    ...run,
    levelIndex: run.levelIndex + 1,
    levelSeed: nextSeed >>> 0,
    levelEarned: 0,
    spendable: 0,
    briefing: true,
    expired: false,
    complete: false,
    victory: false,
    upgrades: cloneUpgrades(run.upgrades),
    entry: snapshot(run),
  };
  next.entry = snapshot(next);
  return next;
}

export function campaignBriefingText(level: CampaignLevelDef): string {
  const minutes = Math.floor(level.timeLimit / 60);
  const seconds = level.timeLimit % 60;
  const clock = seconds ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${minutes}:00`;
  return [
    `Level ${level.index} · ${level.name}`,
    `Landmark: ${level.landmark.label}`,
    `Earn $${level.dollarTarget.toLocaleString('en-US')} and demolish the landmark.`,
    `County clock: ${clock}.`,
  ].join('\n');
}

export function campaignLevelId(run: CampaignRun): CampaignLevelId {
  return currentLevel(run).id;
}

export { CAMPAIGN_LEVELS };
