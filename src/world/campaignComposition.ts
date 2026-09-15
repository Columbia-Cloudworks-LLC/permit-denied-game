import type { CampaignLevelDef } from '../game/campaign';
import type { Building, Lot } from '../structure/types';
import type { Archetype } from './archetypes';
import { campaignEligible, campaignWeight, pickWeighted } from './campaignPlacement';
import { archetypeFootprint } from './parcels';
import type { Rng } from '../game/rng';
import { bandAllowsArchetype } from './urbanGeography';
import type { UrbanBand } from './urbanBands';

export const HEIGHT_CLASSES = ['low-rise', 'mid-rise', 'high-rise', 'skyscraper'] as const;
export type HeightClass = (typeof HEIGHT_CLASSES)[number];

export function heightClass(floors: number): HeightClass {
  if (floors <= 4) return 'low-rise';
  if (floors <= 12) return 'mid-rise';
  if (floors <= 19) return 'high-rise';
  return 'skyscraper';
}

export function campaignFamily(archetype: Pick<Archetype, 'id' | 'campaign' | 'traits'>): string {
  return archetype.campaign?.family ?? archetype.traits?.use?.[0] ?? archetype.id;
}

export interface CompositionAssignment {
  lotId: string;
  buildingId: string;
}

export interface CompositionReport {
  ok: boolean;
  issues: string[];
  ordinary: number;
  byClass: Record<HeightClass, number>;
  byVariant: Record<string, number>;
  byFamily: Record<string, number>;
}

export function ordinaryBuildings(buildings: readonly Building[]): Building[] {
  return buildings.filter(building => !building.campaignLandmark);
}

export function evaluateCampaignComposition(
  buildings: readonly Building[],
  level: CampaignLevelDef,
  archetypes: readonly Archetype[],
): CompositionReport {
  const rules = level.composition;
  const byClass: Record<HeightClass, number> = { 'low-rise': 0, 'mid-rise': 0, 'high-rise': 0, skyscraper: 0 };
  const byVariant: Record<string, number> = {};
  const byFamily: Record<string, number> = {};
  const issues: string[] = [];
  if (!rules) return { ok: true, issues, ordinary: 0, byClass, byVariant, byFamily };

  const placed = ordinaryBuildings(buildings);
  const ordinary = placed.length;
  for (const building of placed) {
    const def = archetypes.find(entry => entry.id === building.archetypeId);
    const floors = def?.floors ?? building.floors;
    const klass = heightClass(floors);
    byClass[klass] += 1;
    byVariant[building.archetypeId] = (byVariant[building.archetypeId] ?? 0) + 1;
    const family = def ? campaignFamily(def) : building.archetypeId;
    byFamily[family] = (byFamily[family] ?? 0) + 1;
  }

  const target = level.generation.buildingCount - 1;
  if (ordinary === 0) {
    issues.push(`${level.id}: no ordinary buildings were placed`);
    return { ok: false, issues, ordinary, byClass, byVariant, byFamily };
  }
  if (ordinary < target) {
    issues.push(`${level.id}: placed ${ordinary} ordinary buildings, need ${target}`);
  }

  const distinct = Object.keys(byVariant).length;
  if (distinct < rules.minDistinctVariants) {
    issues.push(`${level.id}: ${distinct} ordinary variants, need ${rules.minDistinctVariants}`);
  }
  const maxCount = Math.max(1, Math.floor(ordinary * rules.maxVariantShare));
  for (const [id, count] of Object.entries(byVariant)) {
    if (count > maxCount) issues.push(`${level.id}: ${id} is ${count}/${ordinary}, cap ${maxCount}`);
  }
  const maxFamily = Math.max(1, Math.floor(ordinary * rules.maxFamilyShare));
  for (const [family, count] of Object.entries(byFamily)) {
    if (count > maxFamily) issues.push(`${level.id}: family ${family} is ${count}/${ordinary}, cap ${maxFamily}`);
  }
  for (const band of rules.bands) {
    const count = placed.filter(building => {
      const floors = archetypes.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors;
      return floors >= band.minFloors && floors <= band.maxFloors;
    }).length;
    if (band.forbid && count > 0) issues.push(`${level.id}: forbidden ${band.minFloors}-${band.maxFloors} story buildings placed (${count})`);
    if (band.minShare !== undefined && count / ordinary < band.minShare - 1e-9) {
      issues.push(`${level.id}: ${band.minFloors}-${band.maxFloors}f is ${(count / ordinary * 100).toFixed(1)}%, need ${(band.minShare * 100).toFixed(0)}%`);
    }
    if (band.maxShare !== undefined && count / ordinary > band.maxShare + 1e-9) {
      issues.push(`${level.id}: ${band.minFloors}-${band.maxFloors}f is ${(count / ordinary * 100).toFixed(1)}%, max ${(band.maxShare * 100).toFixed(0)}%`);
    }
  }
  return { ok: issues.length === 0, issues, ordinary, byClass, byVariant, byFamily };
}

export function eligibleOrdinary(
  level: CampaignLevelDef,
  archetypes: readonly Archetype[],
  used: ReadonlyMap<string, number> = new Map(),
): Archetype[] {
  return archetypes.filter(archetype =>
    campaignEligible(archetype.campaign, level.id, { used: used.get(archetype.id) ?? 0 }),
  );
}

function allowedForBand(archetype: Archetype, level: CampaignLevelDef): boolean {
  if (!level.composition) return true;
  for (const band of level.composition.bands) {
    if (!band.forbid) continue;
    if (archetype.floors >= band.minFloors && archetype.floors <= band.maxFloors && !archetype.campaign?.exception) {
      return false;
    }
  }
  return true;
}

function matchesLotBand(archetype: Archetype, lot: Lot): boolean {
  const band = lot.urbanBand as UrbanBand | undefined;
  if (!band) return true;
  if (archetype.campaign?.urbanBands?.length) return bandAllowsArchetype(archetype, band);
  return true;
}

function inBand(archetype: Archetype, minFloors: number, maxFloors: number): boolean {
  return archetype.floors >= minFloors && archetype.floors <= maxFloors;
}

export function planCampaignComposition(
  level: CampaignLevelDef,
  lots: readonly Lot[],
  needed: number,
  archetypes: readonly Archetype[],
  rng: Rng,
): { assignments: CompositionAssignment[]; issues: string[] } {
  const rules = level.composition;
  const issues: string[] = [];
  if (!rules || needed <= 0) return { assignments: [], issues };

  const pool = eligibleOrdinary(level, archetypes).filter(archetype => allowedForBand(archetype, level));
  if (pool.length < rules.minDistinctVariants) {
    issues.push(`${level.id}: only ${pool.length} eligible ordinary buildings, need ${rules.minDistinctVariants} variants`);
    return { assignments: [], issues };
  }

  const maxEach = Math.max(1, Math.floor(needed * rules.maxVariantShare));
  const maxFamily = Math.max(1, Math.floor(needed * rules.maxFamilyShare));
  const counts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const queue: string[] = [];

  const canTake = (archetype: Archetype): boolean => {
    if ((counts.get(archetype.id) ?? 0) >= maxEach) return false;
    if ((familyCounts.get(campaignFamily(archetype)) ?? 0) >= maxFamily) return false;
    if (archetype.campaign?.maxRepeats !== undefined && (counts.get(archetype.id) ?? 0) >= archetype.campaign.maxRepeats) {
      return false;
    }
    return true;
  };

  const take = (archetype: Archetype): void => {
    queue.push(archetype.id);
    counts.set(archetype.id, (counts.get(archetype.id) ?? 0) + 1);
    const family = campaignFamily(archetype);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  };

  const pickFrom = (candidates: readonly Archetype[]): Archetype | undefined => {
    const open = candidates.filter(canTake);
    if (!open.length) return undefined;
    const unusedFamily = open.filter(archetype => !familyCounts.has(campaignFamily(archetype)));
    const unusedId = open.filter(archetype => !counts.has(archetype.id));
    const prefer = unusedFamily.length ? unusedFamily : unusedId.length ? unusedId : open;
    return pickWeighted(prefer, a => campaignWeight(a.campaign, level.id) || 1, (min, max) => rng.range(min, max));
  };

  const requiredBands = [...rules.bands]
    .filter(band => !band.forbid && band.minShare)
    .sort((a, b) => b.minFloors - a.minFloors);
  for (const band of requiredBands) {
    const want = Math.ceil(needed * (band.minShare ?? 0));
    const candidates = pool.filter(archetype => inBand(archetype, band.minFloors, band.maxFloors));
    let have = queue.filter(id => {
      const def = pool.find(entry => entry.id === id);
      return def && inBand(def, band.minFloors, band.maxFloors);
    }).length;
    while (have < want) {
      const next = pickFrom(candidates);
      if (!next) {
        issues.push(`${level.id}: could not fill ${band.minFloors}-${band.maxFloors}f quota (${have}/${want})`);
        break;
      }
      take(next);
      have += 1;
    }
  }

  const remainingAllowed = pool.filter(archetype => {
    if (archetype.campaign?.exception) return true;
    if (level.id === 'city-downtown' && archetype.floors <= 1) return false;
    if (level.id === 'city-borough' && archetype.campaign?.urbanBands?.length === 1 && archetype.campaign.urbanBands[0] === 'service-industrial') {
      return false;
    }
    return !rules.bands.some(band => band.forbid && inBand(archetype, band.minFloors, band.maxFloors));
  });
  while (queue.length < needed) {
    const next = pickFrom(remainingAllowed);
    if (!next) {
      issues.push(`${level.id}: ran out of diversity-legal buildings at ${queue.length}/${needed}`);
      break;
    }
    take(next);
  }

  const distinct = new Set(queue).size;
  if (distinct < rules.minDistinctVariants) {
    for (let i = queue.length - 1; i >= 0 && new Set(queue).size < rules.minDistinctVariants; i--) {
      const unused = pool.filter(archetype => !counts.has(archetype.id) && canTake(archetype));
      const next = unused[0];
      if (!next) break;
      const prev = pool.find(entry => entry.id === queue[i]);
      if (prev) {
        counts.set(prev.id, (counts.get(prev.id) ?? 1) - 1);
        familyCounts.set(campaignFamily(prev), (familyCounts.get(campaignFamily(prev)) ?? 1) - 1);
      }
      queue[i] = next.id;
      counts.set(next.id, (counts.get(next.id) ?? 0) + 1);
      familyCounts.set(campaignFamily(next), (familyCounts.get(campaignFamily(next)) ?? 0) + 1);
    }
  }

  const roleRank = (lot: Lot) => {
    const role = lot.districtRole;
    if (role === 'downtown-core' || role === 'borough-center' || role === 'civic-center') return 4;
    if (role === 'transition-ring' || role === 'mixed-use-corridor' || role === 'village-main-street') return 3;
    if (role === 'borough-neighborhood' || role === 'borough-edge') return 2;
    if (role === 'industrial-service-edge') return 0;
    return 1;
  };
  const rankedLots = [...lots].filter(lot => !lot.openSpaceName).sort((a, b) => {
    const towerBias = (id: string | undefined) => id === 'tower' ? 1 : id === 'standard' ? 0 : -1;
    return roleRank(b) - roleRank(a)
      || (b.cornerLot === a.cornerLot ? 0 : b.cornerLot ? 1 : -1)
      || towerBias(b.templateId) - towerBias(a.templateId)
      || b.buildable.w * b.buildable.d - a.buildable.w * a.buildable.d
      || a.id.localeCompare(b.id);
  });
  const rankedIds = [...queue].sort((a, b) => {
    const left = pool.find(entry => entry.id === a)!;
    const right = pool.find(entry => entry.id === b)!;
    const leftSize = archetypeFootprint(left);
    const rightSize = archetypeFootprint(right);
    const cornerBias = (entry: Archetype) => entry.campaign?.streetRole === 'corner' ? 1 : 0;
    return right.floors - left.floors || cornerBias(right) - cornerBias(left) || rightSize.w * rightSize.d - leftSize.w * leftSize.d || a.localeCompare(b);
  });

  const assignments: CompositionAssignment[] = [];
  const takenLots = new Set<string>();
  const familyOnSegment = new Map<string, string>();
  for (const buildingId of rankedIds) {
    const def = pool.find(entry => entry.id === buildingId)!;
    const size = archetypeFootprint(def);
    const bandFit = rankedLots.filter(lot => !takenLots.has(lot.id) && matchesLotBand(def, lot));
    const preferCorner = def.campaign?.streetRole === 'corner';
    const preferRun = def.campaign?.streetRole === 'run' || campaignFamily(def) === 'mixed-use';
    const rankedFits = [...bandFit].sort((a, b) => {
      const cornerScore = (lot: Lot) => (preferCorner && lot.cornerLot ? 0 : preferCorner ? 2 : lot.cornerLot && def.floors <= 3 ? 1 : 0);
      const runKey = (lot: Lot) => `${lot.frontage?.segmentId ?? lot.id}:${lot.frontage?.side ?? 0}`;
      const runScore = (lot: Lot) => {
        const existing = familyOnSegment.get(runKey(lot));
        if (!preferRun) return 0;
        if (existing === campaignFamily(def)) return -1;
        if (existing) return 1;
        return 0;
      };
      const alreadyFits = (lot: Lot) => lot.buildable.w + 0.08 >= size.w && lot.buildable.d + 0.08 >= size.d ? 0 : 1;
      return roleRank(b) - roleRank(a)
        || cornerScore(a) - cornerScore(b)
        || runScore(a) - runScore(b)
        || alreadyFits(a) - alreadyFits(b)
        || a.id.localeCompare(b.id);
    });
    const serviceOnly = def.campaign?.urbanBands?.length === 1 && def.campaign.urbanBands[0] === 'service-industrial';
    const fit = rankedFits[0]
      ?? rankedLots.find(lot => !takenLots.has(lot.id) && matchesLotBand(def, lot))
      ?? (serviceOnly ? undefined : rankedLots.find(lot => !takenLots.has(lot.id)));
    if (!fit) continue;
    takenLots.add(fit.id);
    familyOnSegment.set(`${fit.frontage.segmentId}:${fit.frontage.side}`, campaignFamily(def));
    assignments.push({ lotId: fit.id, buildingId });
  }
  if (assignments.length < needed) {
    issues.push(`${level.id}: planned ${assignments.length} of ${needed} ordinary lots`);
  }
  return { assignments, issues };
}

export function compositionCaps(level: CampaignLevelDef, ordinaryTarget: number): { maxEach: number; maxFamily: number } {
  const rules = level.composition;
  if (!rules) return { maxEach: ordinaryTarget, maxFamily: ordinaryTarget };
  return {
    maxEach: Math.max(1, Math.floor(ordinaryTarget * rules.maxVariantShare)),
    maxFamily: Math.max(1, Math.floor(ordinaryTarget * rules.maxFamilyShare)),
  };
}

export function legalOrdinaryCandidates(
  level: CampaignLevelDef,
  archetypes: readonly Archetype[],
  used: ReadonlyMap<string, number>,
  ordinaryTarget: number,
): Archetype[] {
  const { maxEach, maxFamily } = compositionCaps(level, ordinaryTarget);
  const familyUsed = new Map<string, number>();
  for (const [id, count] of used) {
    const def = archetypes.find(entry => entry.id === id);
    if (!def) continue;
    familyUsed.set(campaignFamily(def), (familyUsed.get(campaignFamily(def)) ?? 0) + count);
  }
  return eligibleOrdinary(level, archetypes, used)
    .filter(archetype => allowedForBand(archetype, level))
    .filter(archetype => (used.get(archetype.id) ?? 0) < maxEach)
    .filter(archetype => (familyUsed.get(campaignFamily(archetype)) ?? 0) < maxFamily);
}

export function legalOrdinaryForLot(
  level: CampaignLevelDef,
  lot: Lot,
  archetypes: readonly Archetype[],
  used: ReadonlyMap<string, number>,
  ordinaryTarget: number,
): Archetype[] {
  return legalOrdinaryCandidates(level, archetypes, used, ordinaryTarget)
    .filter(archetype => matchesLotBand(archetype, lot));
}

export function sameBandCandidates(
  assigned: Archetype,
  level: CampaignLevelDef,
  archetypes: readonly Archetype[],
  used: ReadonlyMap<string, number>,
  ordinaryTarget = 31,
): Archetype[] {
  const klass = heightClass(assigned.floors);
  return legalOrdinaryCandidates(level, archetypes, used, ordinaryTarget)
    .filter(archetype => heightClass(archetype.floors) === klass)
    .sort((a, b) => {
      const familyBias = (campaignFamily(a) === campaignFamily(assigned) ? 0 : 1) - (campaignFamily(b) === campaignFamily(assigned) ? 0 : 1);
      return familyBias || archetypeFootprint(a).w * archetypeFootprint(a).d - archetypeFootprint(b).w * archetypeFootprint(b).d;
    });
}
