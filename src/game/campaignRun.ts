import type { Building } from '../structure/types';
import type { BiomeId } from '../world/biomes';
import { selectCampaignBiome } from '../world/biomes';
import { climateHazard, defaultClimate, waterFrozen, type ClimateEnvelope, type HazardId } from '../world/climate';
import { resolveSeason, seasonLabel, weatherConditionLabel, type SeasonId, type WeatherConditionId } from '../world/season';
import { COPY } from './constants';
import {
  CAMPAIGN_LEVEL_COUNT,
  campaignLevelAt,
  type CampaignLevelDef,
} from './campaign';

export type CampaignOutcome = 'continue' | 'win' | 'engine' | 'track' | 'clock';

export interface CampaignSnapshot {
  campaignEarned: number;
}

export interface CampaignRun {
  levelIndex: number;
  campaignSeed: number;
  levelSeed: number;
  levelEarned: number;
  campaignEarned: number;
  spendable: number;
  briefing: boolean;
  expired: boolean;
  complete: boolean;
  victory: boolean;
  entry: CampaignSnapshot;
  season: SeasonId;
  biomeId: BiomeId;
  /** Overworld county this level runs; absent on legacy seven-level links. */
  county?: CampaignCounty;
}

export interface CampaignCounty {
  regionId: string;
  index: number;
  weather: WeatherConditionId;
  /** Map-load weather seed, so Next Level rolls the next county's sky the way the map showed it. */
  mapSeed: number;
}

function snapshot(run: Pick<CampaignRun, 'campaignEarned'>): CampaignSnapshot {
  return { campaignEarned: run.campaignEarned };
}

export function startCampaign(seed: number): CampaignRun {
  const run: CampaignRun = {
    levelIndex: 0,
    campaignSeed: seed >>> 0,
    levelSeed: seed >>> 0,
    levelEarned: 0,
    campaignEarned: 0,
    spendable: 0,
    briefing: true,
    expired: false,
    complete: false,
    victory: false,
    entry: { campaignEarned: 0 },
    season: resolveSeason(seed),
    biomeId: selectCampaignBiome(seed).id,
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

function landmarkBuildings(buildings: readonly Building[], level: CampaignLevelDef): Building[] {
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
    levelEarned: 0,
    campaignEarned: run.entry.campaignEarned,
    spendable: 0,
    briefing: true,
    expired: false,
    complete: false,
    victory: false,
  };
}

/**
 * Next level of the run. `target` jumps to a chosen level index (the next overworld county);
 * without it the run steps forward one level.
 */
export function advanceCampaignLevel(run: CampaignRun, nextSeed: number, target?: { levelIndex: number; county?: CampaignCounty }): CampaignRun {
  if (!target && run.levelIndex >= CAMPAIGN_LEVEL_COUNT - 1) {
    return { ...run, victory: true, briefing: false };
  }
  const next: CampaignRun = {
    ...run,
    levelIndex: target?.levelIndex ?? run.levelIndex + 1,
    county: target ? target.county : run.county,
    levelSeed: nextSeed >>> 0,
    levelEarned: 0,
    spendable: 0,
    briefing: true,
    expired: false,
    complete: false,
    victory: false,
    entry: snapshot(run),
  };
  next.entry = snapshot(next);
  return next;
}

/** What the crew is told about each climate hazard before the clock starts. */
const HAZARD_BRIEFINGS: Readonly<Record<HazardId, string>> = {
  haboob: 'Haboob rolling in: short visibility and dust in the air filter.',
  'blowing-dust': 'Blowing dust: grit in the air filter and the running gear.',
  monsoon: 'Monsoon downpour: wet caliche and mud wash are slick off the pavement.',
  squall: 'Coastal squall: driving rain and slick ground off the pavement.',
  heat: 'Extreme heat: the engine runs hot under load.',
  blizzard: 'Blizzard: heavy snow and slick ground off the pavement.',
};

/** The briefing follows the county's climate: no ice line where ponds never freeze, and the zone's own hazards by name. */
export function campaignBriefingText(level: CampaignLevelDef, season: SeasonId = 'summer', county?: { name: string; weather: WeatherConditionId }, climate: ClimateEnvelope = defaultClimate()): string {
  const minutes = Math.floor(level.timeLimit / 60);
  const seconds = level.timeLimit % 60;
  const clock = seconds ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${minutes}:00`;
  const lines = [
    county ? `County ${level.index} · ${county.name}` : `Level ${level.index} · ${level.name}`,
    `Season: ${seasonLabel(season)}. Locked for this run.`,
    ...(county ? [`Weather: ${weatherConditionLabel(season, county.weather, climate)}.`] : []),
    `Landmark: ${level.landmark.label}`,
    `Earn $${level.dollarTarget.toLocaleString('en-US')} and demolish the landmark.`,
    `County clock: ${clock}.`,
  ];
  const hazard = climateHazard(climate, season, county?.weather);
  if (hazard) lines.push(HAZARD_BRIEFINGS[hazard]);
  if (waterFrozen(season, climate)) lines.push('Winter ice is frozen solid. The dozer can cross it.');
  return lines.join('\n');
}

