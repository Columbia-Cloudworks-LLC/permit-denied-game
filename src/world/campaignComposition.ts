import type { CampaignLevelDef } from '../game/campaign';
import type { Building, Lot } from '../structure/types';
import type { Archetype } from './archetypes';
import { campaignEligible, campaignWeight, pickWeighted } from './campaignPlacement';
import { archetypeFootprint } from './parcels';
import type { Rng } from '../game/rng';
import { bandAllowsArchetype } from './urbanGeography';
import type { UrbanBand } from './urbanBands';

const HEIGHT_CLASSES = ['low-rise', 'mid-rise', 'high-rise', 'skyscraper'] as const;
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

function ordinaryBuildings(buildings: readonly Building[]): Building[] {
  return buildings.filter(building => !building.campaignLandmark);
}

type CompositionRules = NonNullable<CampaignLevelDef['composition']>;
type CompositionBand = CompositionRules['bands'][number];
type CompositionTally = Pick<CompositionReport, 'byClass' | 'byVariant' | 'byFamily'>;

function tallyComposition(placed: readonly Building[], archetypes: readonly Archetype[]): CompositionTally {
  const byClass: Record<HeightClass, number> = { 'low-rise': 0, 'mid-rise': 0, 'high-rise': 0, skyscraper: 0 };
  const byVariant: Record<string, number> = {};
  const byFamily: Record<string, number> = {};
  for (const building of placed) {
    const def = archetypes.find(entry => entry.id === building.archetypeId);
    byClass[heightClass(def?.floors ?? building.floors)] += 1;
    byVariant[building.archetypeId] = (byVariant[building.archetypeId] ?? 0) + 1;
    const family = def ? campaignFamily(def) : building.archetypeId;
    byFamily[family] = (byFamily[family] ?? 0) + 1;
  }
  return { byClass, byVariant, byFamily };
}

export function evaluateCampaignComposition(
  buildings: readonly Building[],
  level: CampaignLevelDef,
  archetypes: readonly Archetype[],
): CompositionReport {
  const rules = level.composition;
  const issues: string[] = [];
  if (!rules) return { ok: true, issues, ordinary: 0, ...tallyComposition([], archetypes) };

  const placed = ordinaryBuildings(buildings);
  const ordinary = placed.length;
  const tally = tallyComposition(placed, archetypes);
  if (ordinary === 0) {
    issues.push(`${level.id}: no ordinary buildings were placed`);
    return { ok: false, issues, ordinary, ...tally };
  }
  const target = level.generation.buildingCount - 1;
  if (ordinary < target) {
    issues.push(`${level.id}: placed ${ordinary} ordinary buildings, need ${target}`);
  }
  diversityIssues(level.id, rules, ordinary, tally, issues);
  for (const band of rules.bands) bandShareIssues(level.id, band, placed, archetypes, issues);
  return { ok: issues.length === 0, issues, ordinary, ...tally };
}

function diversityIssues(levelId: string, rules: CompositionRules, ordinary: number, tally: CompositionTally, issues: string[]): void {
  const distinct = Object.keys(tally.byVariant).length;
  if (distinct < rules.minDistinctVariants) {
    issues.push(`${levelId}: ${distinct} ordinary variants, need ${rules.minDistinctVariants}`);
  }
  const maxCount = Math.max(1, Math.floor(ordinary * rules.maxVariantShare));
  for (const [id, count] of Object.entries(tally.byVariant)) {
    if (count > maxCount) issues.push(`${levelId}: ${id} is ${count}/${ordinary}, cap ${maxCount}`);
  }
  const maxFamily = Math.max(1, Math.floor(ordinary * rules.maxFamilyShare));
  for (const [family, count] of Object.entries(tally.byFamily)) {
    if (count > maxFamily) issues.push(`${levelId}: family ${family} is ${count}/${ordinary}, cap ${maxFamily}`);
  }
}

function bandShareIssues(levelId: string, band: CompositionBand, placed: readonly Building[], archetypes: readonly Archetype[], issues: string[]): void {
  const ordinary = placed.length;
  const count = placed.filter(building => {
    const floors = archetypes.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors;
    return floors >= band.minFloors && floors <= band.maxFloors;
  }).length;
  const span = `${band.minFloors}-${band.maxFloors}`, share = `${(count / ordinary * 100).toFixed(1)}%`;
  if (band.forbid && count > 0) issues.push(`${levelId}: forbidden ${span} story buildings placed (${count})`);
  if (band.minShare !== undefined && count / ordinary < band.minShare - 1e-9) {
    issues.push(`${levelId}: ${span}f is ${share}, need ${(band.minShare * 100).toFixed(0)}%`);
  }
  if (band.maxShare !== undefined && count / ordinary > band.maxShare + 1e-9) {
    issues.push(`${levelId}: ${span}f is ${share}, max ${(band.maxShare * 100).toFixed(0)}%`);
  }
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

const serviceIndustrialOnly = (archetype: Archetype): boolean =>
  archetype.campaign?.urbanBands?.length === 1 && archetype.campaign.urbanBands[0] === 'service-industrial';

/** Running variant and family counts while one level's ordinary buildings are picked. */
interface CompositionPlan {
  levelId: CampaignLevelDef['id'];
  rng: Rng;
  maxEach: number;
  maxFamily: number;
  counts: Map<string, number>;
  familyCounts: Map<string, number>;
  queue: string[];
}

function canTake(plan: CompositionPlan, archetype: Archetype): boolean {
  const count = plan.counts.get(archetype.id) ?? 0;
  if (count >= plan.maxEach) return false;
  if ((plan.familyCounts.get(campaignFamily(archetype)) ?? 0) >= plan.maxFamily) return false;
  const maxRepeats = archetype.campaign?.maxRepeats;
  return maxRepeats === undefined || count < maxRepeats;
}

function bumpCount(counts: Map<string, number>, key: string, delta: number, missing: number): void {
  counts.set(key, (counts.get(key) ?? missing) + delta);
}

function take(plan: CompositionPlan, archetype: Archetype): void {
  plan.queue.push(archetype.id);
  bumpCount(plan.counts, archetype.id, 1, 0);
  bumpCount(plan.familyCounts, campaignFamily(archetype), 1, 0);
}

function pickFrom(plan: CompositionPlan, candidates: readonly Archetype[]): Archetype | undefined {
  const open = candidates.filter(archetype => canTake(plan, archetype));
  if (!open.length) return undefined;
  const unusedFamily = open.filter(archetype => !plan.familyCounts.has(campaignFamily(archetype)));
  const unusedId = open.filter(archetype => !plan.counts.has(archetype.id));
  const prefer = unusedFamily.length ? unusedFamily : unusedId.length ? unusedId : open;
  return pickWeighted(prefer, a => campaignWeight(a.campaign, plan.levelId) || 1, (min, max) => plan.rng.range(min, max));
}

/** Take from `candidates` until `have` reaches `want` or the pool runs dry; returns the count reached. */
function fillTo(plan: CompositionPlan, candidates: readonly Archetype[], have: number, want: number): number {
  for (; have < want; have++) {
    const next = pickFrom(plan, candidates);
    if (!next) break;
    take(plan, next);
  }
  return have;
}

function fillRequiredBands(plan: CompositionPlan, rules: CompositionRules, pool: readonly Archetype[], needed: number, issues: string[]): void {
  const requiredBands = [...rules.bands]
    .filter(band => !band.forbid && band.minShare)
    .sort((a, b) => b.minFloors - a.minFloors);
  for (const band of requiredBands) {
    const want = Math.ceil(needed * (band.minShare ?? 0));
    const candidates = pool.filter(archetype => inBand(archetype, band.minFloors, band.maxFloors));
    const have = plan.queue.filter(id => {
      const def = pool.find(entry => entry.id === id);
      return def && inBand(def, band.minFloors, band.maxFloors);
    }).length;
    const reached = fillTo(plan, candidates, have, want);
    if (reached < want) issues.push(`${plan.levelId}: could not fill ${band.minFloors}-${band.maxFloors}f quota (${reached}/${want})`);
  }
}

/** Ordinary fill outside the required bands: no forbidden heights, sheds downtown, or service-only infill in the borough. */
function remainingAllowed(archetype: Archetype, levelId: string, rules: CompositionRules): boolean {
  if (archetype.campaign?.exception) return true;
  if (levelId === 'city-downtown' && archetype.floors <= 1) return false;
  if (levelId === 'city-borough' && serviceIndustrialOnly(archetype)) return false;
  return !rules.bands.some(band => band.forbid && inBand(archetype, band.minFloors, band.maxFloors));
}

/** Swap repeats for unused variants, from the end of the queue, until the variant floor is met. */
function enforceDistinctVariants(plan: CompositionPlan, pool: readonly Archetype[], minDistinct: number): void {
  const { queue, counts, familyCounts } = plan;
  for (let i = queue.length - 1; i >= 0 && new Set(queue).size < minDistinct; i--) {
    const next = pool.find(archetype => !counts.has(archetype.id) && canTake(plan, archetype));
    if (!next) break;
    const prev = pool.find(entry => entry.id === queue[i]);
    if (prev) {
      bumpCount(counts, prev.id, -1, 1);
      bumpCount(familyCounts, campaignFamily(prev), -1, 1);
    }
    queue[i] = next.id;
    bumpCount(counts, next.id, 1, 0);
    bumpCount(familyCounts, campaignFamily(next), 1, 0);
  }
}

const ROLE_RANK: Readonly<Record<string, number>> = {
  'downtown-core': 4, 'borough-center': 4, 'civic-center': 4,
  'transition-ring': 3, 'mixed-use-corridor': 3, 'village-main-street': 3,
  'borough-neighborhood': 2, 'borough-edge': 2,
  'industrial-service-edge': 0,
};
const roleRank = (lot: Lot): number => ROLE_RANK[lot.districtRole ?? ''] ?? 1;
const towerBias = (id: string | undefined): number => id === 'tower' ? 1 : id === 'standard' ? 0 : -1;
const cornerFirst = (a: Lot, b: Lot): number => b.cornerLot === a.cornerLot ? 0 : b.cornerLot ? 1 : -1;
const cornerBias = (entry: Archetype): number => entry.campaign?.streetRole === 'corner' ? 1 : 0;

/** Central, corner, tower-template and roomy lots first. */
function rankLots(lots: readonly Lot[]): Lot[] {
  return [...lots].filter(lot => !lot.openSpaceName).sort((a, b) => roleRank(b) - roleRank(a)
    || cornerFirst(a, b)
    || towerBias(b.templateId) - towerBias(a.templateId)
    || b.buildable.w * b.buildable.d - a.buildable.w * a.buildable.d
    || a.id.localeCompare(b.id));
}

/** Tallest, corner-seeking and largest buildings choose lots first. */
function rankBuildings(queue: readonly string[], pool: readonly Archetype[]): string[] {
  return [...queue].sort((a, b) => {
    const left = pool.find(entry => entry.id === a)!;
    const right = pool.find(entry => entry.id === b)!;
    const leftSize = archetypeFootprint(left);
    const rightSize = archetypeFootprint(right);
    return right.floors - left.floors || cornerBias(right) - cornerBias(left) || rightSize.w * rightSize.d - leftSize.w * leftSize.d || a.localeCompare(b);
  });
}

/** Lot preferences for one building: role, corner wish, family runs along a frontage, then fit. */
interface LotPreference {
  def: Archetype;
  family: string;
  size: { w: number; d: number };
  preferCorner: boolean;
  preferRun: boolean;
  familyOnSegment: ReadonlyMap<string, string>;
}

function cornerScore(pref: LotPreference, lot: Lot): number {
  if (pref.preferCorner) return lot.cornerLot ? 0 : 2;
  return lot.cornerLot && pref.def.floors <= 3 ? 1 : 0;
}

function runScore(pref: LotPreference, lot: Lot): number {
  if (!pref.preferRun) return 0;
  const existing = pref.familyOnSegment.get(`${lot.frontage?.segmentId ?? lot.id}:${lot.frontage?.side ?? 0}`);
  if (existing === pref.family) return -1;
  return existing ? 1 : 0;
}

const alreadyFits = (pref: LotPreference, lot: Lot): number => lot.buildable.w + 0.08 >= pref.size.w && lot.buildable.d + 0.08 >= pref.size.d ? 0 : 1;

function compareLotsFor(pref: LotPreference, a: Lot, b: Lot): number {
  return roleRank(b) - roleRank(a)
    || cornerScore(pref, a) - cornerScore(pref, b)
    || runScore(pref, a) - runScore(pref, b)
    || alreadyFits(pref, a) - alreadyFits(pref, b)
    || a.id.localeCompare(b.id);
}

function chooseLot(def: Archetype, rankedLots: readonly Lot[], takenLots: ReadonlySet<string>, familyOnSegment: ReadonlyMap<string, string>): Lot | undefined {
  const family = campaignFamily(def);
  const pref: LotPreference = {
    def, family, size: archetypeFootprint(def), familyOnSegment,
    preferCorner: def.campaign?.streetRole === 'corner',
    preferRun: def.campaign?.streetRole === 'run' || family === 'mixed-use',
  };
  const bandFit = rankedLots.filter(lot => !takenLots.has(lot.id) && matchesLotBand(def, lot));
  return [...bandFit].sort((a, b) => compareLotsFor(pref, a, b))[0]
    ?? rankedLots.find(lot => !takenLots.has(lot.id) && matchesLotBand(def, lot))
    ?? (serviceIndustrialOnly(def) ? undefined : rankedLots.find(lot => !takenLots.has(lot.id)));
}

function assignLots(rankedIds: readonly string[], pool: readonly Archetype[], rankedLots: readonly Lot[]): CompositionAssignment[] {
  const assignments: CompositionAssignment[] = [];
  const takenLots = new Set<string>();
  const familyOnSegment = new Map<string, string>();
  for (const buildingId of rankedIds) {
    const def = pool.find(entry => entry.id === buildingId)!;
    const fit = chooseLot(def, rankedLots, takenLots, familyOnSegment);
    if (!fit) continue;
    takenLots.add(fit.id);
    familyOnSegment.set(`${fit.frontage.segmentId}:${fit.frontage.side}`, campaignFamily(def));
    assignments.push({ lotId: fit.id, buildingId });
  }
  return assignments;
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

  const plan: CompositionPlan = {
    levelId: level.id, rng,
    maxEach: Math.max(1, Math.floor(needed * rules.maxVariantShare)),
    maxFamily: Math.max(1, Math.floor(needed * rules.maxFamilyShare)),
    counts: new Map(), familyCounts: new Map(), queue: [],
  };
  fillRequiredBands(plan, rules, pool, needed, issues);
  if (fillTo(plan, pool.filter(archetype => remainingAllowed(archetype, level.id, rules)), plan.queue.length, needed) < needed) {
    issues.push(`${level.id}: ran out of diversity-legal buildings at ${plan.queue.length}/${needed}`);
  }
  enforceDistinctVariants(plan, pool, rules.minDistinctVariants);

  const assignments = assignLots(rankBuildings(plan.queue, pool), pool, rankLots(lots));
  if (assignments.length < needed) {
    issues.push(`${level.id}: planned ${assignments.length} of ${needed} ordinary lots`);
  }
  return { assignments, issues };
}
function compositionCaps(level: CampaignLevelDef, ordinaryTarget: number): { maxEach: number; maxFamily: number } {
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
