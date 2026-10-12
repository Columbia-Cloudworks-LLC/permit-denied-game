import { campaignPaintsOpenFields, type CampaignLevelDef } from "../game/campaign";
import { DRESSING } from "../game/constants";
import { aabbOverlap, convexOverlap, len } from "../game/math";
import { Rng } from "../game/rng";
import { DISTRICT_COUNTS, type DistrictId } from "../game/session";
import type { Building, GroundPatch, Lot, Prop } from "../structure/types";
import { selectBiome, type BiomeProfile } from "./biomes";
import { ruralGridDims } from "./terrain";
import type { SeasonId } from "./season";
import { getAsset, spawnAsset } from "./catalog";
import { buildingOccupy, dressLots } from "./dressing";
import { deriveTerrainFeatures, type TerrainFeature } from "./terrainFeatures";
import {
  PARCEL,
  allocateFrontage,
  archetypeFootprint,
  attachDriveway,
  currentParcel,
  expandLotToFit,
  expandStreets,
  placeBuildingInLot,
  runWithParcelProfile,
  type NhoodDebug,
  type NhoodReject,
} from "./parcels";
import { identityFromBuilding } from "./lotUse";
import { campaignEligible, campaignWeight, pickWeighted } from "./campaignPlacement";
import {
  evaluateCampaignComposition,
  legalOrdinaryCandidates,
  planCampaignComposition,
  sameBandCandidates,
} from "./campaignComposition";
import {
  applyUrbanTags,
  classifyUrbanGeography,
  enumerateRoadBlocks,
  reserveNamedOpenSpaces,
  type UrbanGeographyReport,
} from "./urbanGeography";
import type { UrbanBand } from "./urbanBands";
import { ARCHETYPES, archetypeById, type Archetype } from "./archetypes";
import {
  curvePoints,
  aabbOverlapsRoad,
  derivedRoadBoxes,
  emptyTerrain,
  linePoints,
  offsetPoint,
  pointOnRoad,
  polylineLength,
  pt,
  RoadBuilder,
  samplePolyline,
  type RoadNetwork,
  type RoadNode,
  type RoadSegment,
  type TerrainField,
} from "./roads";
import type { Town } from "./town";
import {
  estimateRuralSurfaceBounds,
  enforceOpenCorridors,
  generateSurfaceGrid,
  meanRoadCost,
  sampleSegmentCenterline,
  lotEnvelopeRejected,
  stampDeveloped,
  finalizeStampedSurface,
  traversalAt,
  type SurfaceGrid,
} from "./terrain";

export interface LayoutIssue {
  code: string;
  detail: string;
}

export type TopologyFamily = "county" | "crossroads" | "tjunction" | "curve-farm" | "loop" | "frontage";

export interface RuralLayout {
  buildings: Building[];
  props: Prop[];
  lots: Lot[];
  ground: GroundPatch[];
  network: RoadNetwork;
  terrain: TerrainField;
  roads: Town["roads"];
  spawnX: number;
  spawnY: number;
  spawnHeading: number;
  roadSpawnX: number;
  roadSpawnY: number;
  roadSpawnHeading: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  district: DistrictId;
  seed: number;
  topology: TopologyFamily;
  biome: BiomeProfile;
  surface: SurfaceGrid;
  features: TerrainFeature[];
  campaignLevel?: CampaignLevelDef['id'];
  diagnostic: { ok: boolean; issues: LayoutIssue[] };
  nhood: NhoodDebug;
  urban?: UrbanGeographyReport;
}

function pickTopology(rng: Rng, count: number): TopologyFamily {
  const families: TopologyFamily[] = ["county", "crossroads", "tjunction", "curve-farm", "loop", "frontage"];
  void count;
  return rng.pick(families);
}

export interface LayoutEnvironment {
  season?: SeasonId;
  biome?: BiomeProfile;
}

export function generateRuralLayout(
  id: Exclude<DistrictId, "classic">,
  seed: number,
  topologyOverride?: TopologyFamily,
  campaign?: CampaignLevelDef,
  environment?: LayoutEnvironment,
): RuralLayout {
  const generate = (attemptSeed: number): RuralLayout => generateRuralLayoutInner(id, attemptSeed, topologyOverride, campaign, environment);
  if (!campaign) return generate(seed);
  return runWithParcelProfile(campaign.generation.parcel, campaign.generation.parcel, () => {
    if (!campaign.composition) return withCampaignSeed(generate(seed), seed);
    const attempts = campaign.composition.placementAttempts;
    const errors: string[] = [];
    for (let attempt = 0; attempt < attempts; attempt++) {
      const attemptSeed = seed ^ (attempt * 0x9e3779b9);
      try {
        const layout = withCampaignSeed(generate(attemptSeed), seed);
        const report = evaluateCampaignComposition(layout.buildings, campaign, ARCHETYPES);
        if (report.ok && layout.buildings.filter(building => building.campaignLandmark).length === 1) return layout;
        errors.push(`attempt ${attempt}: ${report.issues.join('; ') || 'landmark or count failed'}`);
      } catch (err) {
        errors.push(`attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(`Campaign composition failed for ${campaign.id} seed ${seed}. ${errors.join(' | ')}`);
  });
}

function withCampaignSeed(layout: RuralLayout, seed: number): RuralLayout {
  layout.seed = seed;
  return layout;
}

type ArchetypePick = (lot: Lot, rng: Rng, tried: ReadonlySet<string>) => Archetype | undefined;

/** Placement state shared by every phase of one rural or campaign layout attempt. */
interface RuralPlacement {
  campaign: CampaignLevelDef | undefined;
  count: number;
  rng: Rng;
  b: RoadBuilder;
  surface: SurfaceGrid;
  issues: LayoutIssue[];
  rejected: NhoodReject[];
  buildings: Building[];
  kept: Lot[];
  corridors: { x: number; y: number }[][];
  used: Map<string, number>;
  publicSegs: () => RoadSegment[];
  pick: ArchetypePick | undefined;
}

function generateRuralLayoutInner(
  id: Exclude<DistrictId, "classic">,
  seed: number,
  topologyOverride: TopologyFamily | undefined,
  campaign: CampaignLevelDef | undefined,
  environment: LayoutEnvironment | undefined,
): RuralLayout {
  const count = campaign?.generation.buildingCount ?? DISTRICT_COUNTS[id];
  const rng = new Rng(seed);
  const topology = (campaign && campaign.generation.topology !== 'estate'
    ? campaign.generation.topology
    : topologyOverride) ?? pickTopology(rng, count);
  const biome = environment?.biome ?? selectBiome(id, seed, topology);
  const season = environment?.season ?? "summer";
  const originX = 4;
  const originY = 4;
  const surface = ruralSurface(seed, biome, count, campaign, originX, originY);
  const b = pickSkeleton(surface, topology, count, originX, originY, seed, campaign).builder;
  growStreets(b, rng, count, campaign, surface);

  const buildings: Building[] = [];
  const used = new Map<string, number>();
  const run: RuralPlacement = {
    campaign, count, rng, b, surface,
    issues: [], rejected: [], buildings, kept: [], corridors: [], used,
    publicSegs: () => b.segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp"),
    pick: campaign ? campaignPicker(campaign, used, buildings) : undefined,
  };
  const { pool, urban } = ruralLotPool(run, seed);
  placeRuralBuildings(run, pool, seed);
  const network = finishRuralNetwork(run, urban);
  const kept = run.kept;
  const { props, ground } = dressRuralLots(run, network);
  const { minX, minY, maxX, maxY } = ruralBounds(originX, originY, network, kept, surface);

  const terrain = emptyTerrain(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
  applyTerrain(terrain, topology, minX, maxX);
  enforceOpenCorridors(surface, network, kept, buildings);
  stampDeveloped(surface, network, kept, ground);
  finalizeStampedSurface(surface, biome, seed, { network, lots: kept, buildings });
  if (campaign && urban) finalizeUrbanReport(campaign, urban, kept, network);

  const roads = derivedRoadBoxes(network);
  const { spawn, roadSpawn } = ruralSpawns(network, buildings, props, campaign, surface);
  const propBudget = campaign?.generation.dressingBudget ?? DRESSING.districtMax[id];
  const features = deriveTerrainFeatures({
    biome,
    seed,
    minX,
    minY,
    maxX,
    maxY,
    network,
    lots: kept,
    buildings,
    props,
    ground,
    spawnX: spawn.x,
    spawnY: spawn.y,
    roadSpawnX: roadSpawn.x,
    roadSpawnY: roadSpawn.y,
    propBudget,
    surface,
    season,
  });

  return {
    buildings,
    props,
    lots: kept,
    ground,
    network,
    terrain,
    roads,
    spawnX: spawn.x,
    spawnY: spawn.y,
    spawnHeading: spawn.heading,
    roadSpawnX: roadSpawn.x,
    roadSpawnY: roadSpawn.y,
    roadSpawnHeading: roadSpawn.heading,
    minX,
    minY,
    maxX,
    maxY,
    district: id,
    seed,
    topology,
    biome,
    surface,
    features,
    campaignLevel: campaign?.id,
    diagnostic: { ok: run.issues.length === 0 && kept.length === count, issues: run.issues },
    nhood: { rejected: run.rejected, urban },
    urban,
  };
}

function ruralSurface(seed: number, biome: BiomeProfile, count: number, campaign: CampaignLevelDef | undefined, originX: number, originY: number): SurfaceGrid {
  const blockW = campaign?.generation.parcel.blockW ?? 40;
  const blockD = campaign?.generation.parcel.blockD ?? 36;
  const bounds = estimateRuralSurfaceBounds(count, originX, originY, blockW, blockD);
  return generateSurfaceGrid({
    seed,
    biome,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    spawnBand: { x: originX + 2, y: originY + 8, w: 18, d: 18 },
    openFields: campaign ? campaignPaintsOpenFields(campaign.id) : true,
  });
}

/** Add side streets until the frontage can hold the town, trying terrain-aware routing first. */
function growStreets(b: RoadBuilder, rng: Rng, count: number, campaign: CampaignLevelDef | undefined, surface: SurfaceGrid): void {
  const maxExpand = campaign?.generation.parcel.maxExpand ?? PARCEL.maxExpand;
  for (let pass = 0; pass <= maxExpand; pass++) {
    const slots = estimateSlots(b.segments, b.nodes);
    if (slots >= count * 1.7) break;
    if (!expandStreets(b, rng, pass, surface) && !expandStreets(b, rng, pass)) {
      if (slots >= count) break;
      continue;
    }
    b.normalizeJunctions();
  }
}

/** Cut lots along a compact street cluster; campaign lots also get urban roles and reserved open spaces. */
function ruralLotPool(run: RuralPlacement, seed: number): { pool: Lot[]; urban: UrbanGeographyReport | undefined } {
  const { b, campaign, count } = run;
  const developed = selectStreetCluster(
    b.segments,
    b.nodes,
    campaign ? Math.ceil(count * 2.4) + 4 : Math.ceil(count * 1.7) + 6,
    new Rng(seed ^ 0x51a11),
  );
  const alloc = allocateFrontage(developed, b.nodes, campaign ? count * 4 : count * 3, new Rng(seed ^ 0x51a11), [], b.segments, run.surface);
  const pool = selectLotCluster(alloc.lots, campaign ? Math.min(alloc.lots.length, count * 3) : count * 2, new Rng(seed ^ 0xc1a55));
  run.rejected.push(...alloc.rejected);
  if (!campaign) return { pool, urban: undefined };
  const urban = reserveNamedOpenSpaces(campaign, pool, classifyUrbanGeography(campaign, pool, b.segments, b.nodes));
  applyUrbanTags(pool, urban);
  return { pool, urban };
}

function placeRuralBuildings(run: RuralPlacement, pool: Lot[], seed: number): void {
  const { campaign, count, kept } = run;
  if (campaign) placeCampaignLandmark(run, campaign, pool);
  const { lots, assignedId } = planOrdinaryLots(run, pool);
  placeOrdinaryLots(run, lots, assignedId, pool);
  if (kept.length < count) placeExtraFrontage(run, seed);
  if (kept.length < count) placeOrdinaryLots(run, lots, assignedId, pool);
  if (kept.length < count) {
    run.issues.push({
      code: "capacity",
      detail: `placed ${kept.length} of ${count} after bounded expansion (${run.rejected.length} rejected)`,
    });
  }
}

/** Lots left after the landmark; with composition rules, planned lots come first with their assigned buildings. */
function planOrdinaryLots(run: RuralPlacement, pool: readonly Lot[]): { lots: Lot[]; assignedId: Map<string, string> } {
  const { campaign, kept } = run;
  const lots = pool.filter(lot => !kept.some(keptLot => keptLot.id === lot.id));
  if (!campaign?.composition) return { lots, assignedId: new Map() };
  const plan = planCampaignComposition(campaign, lots, run.count - run.buildings.length, ARCHETYPES, run.rng);
  for (const detail of plan.issues.filter(text => !text.includes('planned'))) {
    run.issues.push({ code: 'composition-plan', detail });
  }
  const order = (lot: Lot) => {
    const index = plan.assignments.findIndex(entry => entry.lotId === lot.id);
    return index < 0 ? 1e9 : index;
  };
  return {
    lots: [...lots].sort((a, c) => order(a) - order(c)),
    assignedId: new Map(plan.assignments.map(entry => [entry.lotId, entry.buildingId])),
  };
}

function placeOrdinaryLots(run: RuralPlacement, lots: readonly Lot[], assignedId: ReadonlyMap<string, string>, pool: Lot[]): void {
  for (const lot of lots) {
    if (run.kept.length >= run.count) break;
    if (lot.openSpaceName || run.kept.some((k) => k.id === lot.id)) continue;
    placeCampaignLot(run, lot, assignedId.get(lot.id), pool);
  }
}

/** Second chance: frontage from a wider street cluster around the lots already kept. */
function placeExtraFrontage(run: RuralPlacement, seed: number): void {
  const { b, campaign, count, kept } = run;
  const extraSegs = selectStreetCluster(b.segments, b.nodes, Math.ceil(count * 3.2), new Rng(seed ^ 0x222));
  const extra = allocateFrontage(extraSegs, b.nodes, count * 3, new Rng(seed ^ 0x222), kept, b.segments, run.surface);
  run.rejected.push(...extra.rejected);
  if (campaign && extra.lots.length) {
    const extraFresh = extra.lots.filter(lot => !kept.some(keptLot => keptLot.id === lot.id));
    applyUrbanTags(extraFresh, classifyUrbanGeography(campaign, extraFresh, b.segments, b.nodes));
  }
  for (const lot of extra.lots) {
    if (kept.length >= count) break;
    if (kept.some((k) => k.id === lot.id)) continue;
    placeCampaignLot(run, lot, undefined, extra.lots);
  }
}

/** Trim the network to the kept lots, re-home their accesses, and push campaign buildings off the pavement. */
function finishRuralNetwork(run: RuralPlacement, urban: UrbanGeographyReport | undefined): RoadNetwork {
  const { b, kept, campaign } = run;
  b.dropAccessesForLots(new Set(kept.map((l) => l.id)));
  if (campaign?.composition) {
    const keepPads = [
      ...kept,
      ...(urban?.openSpaces ?? []).map(space => ({ x: space.x, y: space.y, w: space.w, d: space.d })),
    ];
    b.dropPublicRoadsAwayFromLots(keepPads, 12);
  }
  const network = b.finish({ normalize: false });
  for (const lot of kept) {
    const acc = network.accesses.find((a) => a.id === lot.accessId || a.lotId === lot.id);
    if (acc) {
      lot.accessId = acc.id;
      lot.frontage.segmentId = acc.segmentId;
    }
  }
  if (campaign) nudgeBuildingsOffStreets(run.buildings, kept, network);
  return network;
}

function dressRuralLots(run: RuralPlacement, network: RoadNetwork): { props: Prop[]; ground: GroundPatch[] } {
  const { buildings, kept, campaign, count, rng, corridors } = run;
  const occBoxes = buildings.flatMap(buildingOccupy);
  const perLot = campaign?.generation.propsPerLot ?? (count >= 80 ? 8 : 10);
  const eligible = campaign
    ? (assetId: string) => campaignEligible(getAsset(assetId).campaign, campaign.id)
    : undefined;
  const dressed = dressLots(kept, buildings, rng, occBoxes, perLot, corridors, eligible);
  const props: Prop[] = [...dressed.props];
  const ground: GroundPatch[] = [...dressed.patches];
  placeRoadside(network, kept, buildings, props, rng, count, corridors);
  for (let i = props.length - 1; i >= 0; i--) {
    if (!propAllowed(props[i]!, network, campaign)) props.splice(i, 1);
  }
  return { props, ground };
}

function propAllowed(p: Prop, network: RoadNetwork, campaign: CampaignLevelDef | undefined): boolean {
  const def = getAsset(p.assetId);
  if (campaign && !campaignEligible(def.campaign, campaign.id)) return false;
  return def.roadsideOk || !propTouchesPavement(network, p);
}

/** World bounds: the origin pad, every node and lot with margin, and the whole surface grid. */
function ruralBounds(originX: number, originY: number, network: RoadNetwork, kept: readonly Lot[], surface: SurfaceGrid): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = originX - 2;
  let minY = originY - 2;
  let maxX = originX + 20;
  let maxY = originY + 20;
  for (const n of network.nodes) {
    minX = Math.min(minX, n.x - 6);
    minY = Math.min(minY, n.y - 6);
    maxX = Math.max(maxX, n.x + 6);
    maxY = Math.max(maxY, n.y + 6);
  }
  for (const lot of kept) {
    minX = Math.min(minX, lot.x - 1);
    minY = Math.min(minY, lot.y - 1);
    maxX = Math.max(maxX, lot.x + lot.w + 1);
    maxY = Math.max(maxY, lot.y + lot.d + 1);
  }
  minX = Math.min(minX, surface.ox);
  minY = Math.min(minY, surface.oy);
  maxX = Math.max(maxX, surface.ox + surface.cols * surface.cell);
  maxY = Math.max(maxY, surface.oy + surface.rows * surface.cell);
  return { minX, minY, maxX, maxY };
}

type RoadBlock = ReturnType<typeof enumerateRoadBlocks>[number];
const BLOCK_OPEN_SPACE_NAMES = {
  plaza: ['Market Plaza', 'Station Plaza', 'Founders Plaza'],
  park: ['Borough Green', 'Elm Park', 'Canal Park'],
} as const;

/** Drop lots that were not kept, classify every road block, and recount roles and bands. */
function finalizeUrbanReport(campaign: CampaignLevelDef, urban: UrbanGeographyReport, kept: readonly Lot[], network: RoadNetwork): void {
  const keptIds = new Set(kept.map(lot => lot.id));
  urban.lots = urban.lots.filter(info => keptIds.has(info.lotId));
  urban.blocks = enumerateRoadBlocks(network.nodes).map(block => classifyBlock(campaign, urban, kept, block));
  const byRole: Record<string, number> = {};
  const byBand: Record<string, number> = {};
  for (const info of urban.lots) {
    byRole[info.districtRole] = (byRole[info.districtRole] ?? 0) + 1;
    byBand[info.urbanBand] = (byBand[info.urbanBand] ?? 0) + 1;
  }
  urban.byRole = byRole;
  urban.byBand = byBand;
}

const lotCentreIn = (lot: Lot, block: RoadBlock): boolean => {
  const cx = lot.x + lot.w * 0.5, cy = lot.y + lot.d * 0.5;
  return cx >= block.x && cx <= block.x + block.w && cy >= block.y && cy <= block.y + block.d;
};

/** City blocks left empty become a named plaza (downtown) or park (borough). */
function classifyBlock(campaign: CampaignLevelDef, urban: UrbanGeographyReport, kept: readonly Lot[], block: RoadBlock): UrbanGeographyReport['blocks'][number] {
  const inside = kept.filter(lot => lotCentreIn(lot, block));
  const prior = urban.openSpaces.find(space => Math.abs(space.x - block.x) < 3 && Math.abs(space.y - block.y) < 3);
  const empty = inside.length === 0 && block.w * block.d >= 80;
  const kind = campaign.id === 'city-downtown' ? 'plaza' : 'park';
  if (empty && !prior && (campaign.id === 'city-borough' || campaign.id === 'city-downtown')) reserveBlock(urban, block, kind);
  return {
    ...block,
    lotIds: inside.map(lot => lot.id),
    coverage: inside.reduce((sum, lot) => sum + lot.w * lot.d, 0) / Math.max(1, block.w * block.d),
    role: prior?.kind ?? (empty ? kind : 'borough-neighborhood'),
    reserved: !!(prior || empty),
  };
}

function reserveBlock(urban: UrbanGeographyReport, block: RoadBlock, kind: 'plaza' | 'park'): void {
  const names = BLOCK_OPEN_SPACE_NAMES[kind];
  const used = new Set(urban.openSpaces.map(space => space.name));
  const name = names.find(entry => !used.has(entry)) ?? names[urban.openSpaces.length % names.length]!;
  urban.openSpaces.push({
    id: block.id,
    kind,
    name,
    x: block.x,
    y: block.y,
    w: block.w,
    d: block.d,
    band: kind === 'park' ? 'borough-mixed' : 'downtown-core',
  });
}

/** Dozer spawn first, then a separate test-car spawn; campaign spawns lean toward the building cluster. */
function ruralSpawns(network: RoadNetwork, buildings: Building[], props: Prop[], campaign: CampaignLevelDef | undefined, surface: SurfaceGrid): { spawn: { x: number; y: number; heading: number }; roadSpawn: { x: number; y: number; heading: number } } {
  const cluster = campaign && buildings.length
    ? {
      x: buildings.reduce((sum, building) => sum + building.x + building.w * building.cellSize * 0.5, 0) / buildings.length,
      y: buildings.reduce((sum, building) => sum + building.y + building.d * building.cellSize * 0.5, 0) / buildings.length,
    }
    : undefined;
  const spawn = pickSpawn(network, buildings, props, 0, undefined, cluster, surface);
  const roadSpawn = pickSpawn(network, buildings, props, 1, spawn, cluster, surface);
  return { spawn, roadSpawn };
}

function addTopologyFlavor(b: RoadBuilder, topology: TopologyFamily, ox: number, oy: number, rng: Rng): void {
  const host = b.segments.find((s) => s.roadClass === "rural") ?? b.segments[0];
  if (!host) return;
  if (topology === "loop") {
    const p = samplePolyline(host.points, 0.35);
    const j = b.joinAt(p.x, p.y, p.elev, host.layer);
    const r = 14;
    const ring = [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + 0.2;
      return b.node(j.x + 16 + Math.cos(a) * r, j.y + Math.sin(a) * r, p.elev);
    });
    for (let i = 0; i < ring.length; i++) {
      b.segment(ring[i]!, ring[(i + 1) % ring.length]!, linePoints(pt(ring[i]!), pt(ring[(i + 1) % ring.length]!)), {
        roadClass: "residential",
      });
    }
    b.segment(j, ring[0]!, linePoints(pt(j), pt(ring[0]!)), { roadClass: "residential" });
    b.segment(ring[0]!, ring[2]!, linePoints(pt(ring[0]!), pt(ring[2]!)), { roadClass: "residential" });
  } else if (topology === "curve-farm") {
    const p = samplePolyline(host.points, 0.6);
    const j = b.joinAt(p.x, p.y, p.elev, host.layer);
    const end = b.node(p.x + 22, p.y + 18, p.elev + 0.3);
    b.segment(j, end, curvePoints(pt(j), { x: p.x + 8, y: p.y + 16, elev: p.elev + 0.15 }, pt(end)), { roadClass: "rural" });
  } else if (topology === "tjunction" || topology === "frontage") {
    const p = samplePolyline(host.points, 0.45);
    const j = b.joinAt(p.x, p.y, p.elev, host.layer);
    const dead = b.node(p.x + rng.range(10, 16), p.y + (topology === "tjunction" ? 20 : -14), p.elev);
    b.segment(j, dead, linePoints(pt(j), pt(dead)), { roadClass: topology === "frontage" ? "service" : "residential" });
  }
  void ox;
  void oy;
}

function selectStreetCluster(
  segments: readonly RoadSegment[],
  nodes: readonly RoadNode[],
  needSlots: number,
  rng: Rng,
  grid?: SurfaceGrid,
): RoadSegment[] {
  const publicSegs = segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  if (!publicSegs.length) return [];
  const byId = new Map(publicSegs.map((s) => [s.id, s]));
  const start = publicSegs[rng.int(0, publicSegs.length - 1)]!;
  const selected = new Set<string>([start.id]);
  const selectedList = () => publicSegs.filter((s) => selected.has(s.id));
  while (estimateSlots(selectedList(), nodes) < needSlots) {
    const frontier = clusterFrontier(selected, byId, nodes);
    if (!frontier.length) {
      const leftover = publicSegs.find((s) => !selected.has(s.id));
      if (!leftover) break;
      selected.add(leftover.id);
      continue;
    }
    selected.add(closestToCluster(frontier, selectedList(), grid).id);
  }
  return selectedList();
}

/** Unselected segments touching the selection, once per touching end. */
function clusterFrontier(selected: ReadonlySet<string>, byId: ReadonlyMap<string, RoadSegment>, nodes: readonly RoadNode[]): RoadSegment[] {
  const frontier: RoadSegment[] = [];
  for (const id of selected) {
    const seg = byId.get(id);
    if (seg) pushUnselectedNeighbours(seg, selected, byId, nodes, frontier);
  }
  return frontier;
}

function pushUnselectedNeighbours(seg: RoadSegment, selected: ReadonlySet<string>, byId: ReadonlyMap<string, RoadSegment>, nodes: readonly RoadNode[], out: RoadSegment[]): void {
  for (const nid of [seg.startId, seg.endId]) {
    const node = nodes.find((n) => n.id === nid);
    if (!node) continue;
    for (const sid of node.segmentIds) {
      const other = selected.has(sid) ? undefined : byId.get(sid);
      if (other) out.push(other);
    }
  }
}

/** Frontier segment nearest the selection's endpoint centroid; with a grid, cheap terrain outweighs distance. */
function closestToCluster(frontier: readonly RoadSegment[], selected: readonly RoadSegment[], grid: SurfaceGrid | undefined): RoadSegment {
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (const s of selected) {
    const a = s.points[0]!;
    const b = s.points[s.points.length - 1]!;
    cx += a.x + b.x;
    cy += a.y + b.y;
    n += 2;
  }
  cx /= Math.max(1, n);
  cy /= Math.max(1, n);
  let best = frontier[0]!;
  let bestD = Infinity;
  for (const s of frontier) {
    const d = clusterDistance(s, cx, cy, grid);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function clusterDistance(s: RoadSegment, cx: number, cy: number, grid: SurfaceGrid | undefined): number {
  const mid = samplePolyline(s.points, 0.5);
  const d = (mid.x - cx) * (mid.x - cx) + (mid.y - cy) * (mid.y - cy);
  if (!grid) return d;
  const cost = meanRoadCost(grid, sampleSegmentCenterline(s));
  return d * 0.25 + (Number.isFinite(cost.mean) ? cost.mean : 8) * 40 + cost.reject * 12;
}

function selectLotCluster(lots: readonly Lot[], want: number, rng: Rng): Lot[] {
  if (lots.length <= want) return [...lots];
  const origin = lots[rng.int(0, lots.length - 1)]!;
  const picked: Lot[] = [origin];
  const remaining = lots.filter((l) => l.id !== origin.id);
  while (picked.length < want && remaining.length) {
    const cx = picked.reduce((s, l) => s + l.x + l.w * 0.5, 0) / picked.length;
    const cy = picked.reduce((s, l) => s + l.y + l.d * 0.5, 0) / picked.length;
    let bi = 0;
    let best = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const l = remaining[i]!;
      let score = (l.x + l.w * 0.5 - cx) ** 2 + (l.y + l.d * 0.5 - cy) ** 2;
      if (picked.some((p) => p.frontage.segmentId === l.frontage.segmentId)) score *= 0.4;
      if (score < best) {
        best = score;
        bi = i;
      }
    }
    picked.push(remaining.splice(bi, 1)[0]!);
  }
  return picked;
}

function buildBlockGrid(b: RoadBuilder, count: number, ox: number, oy: number, rng: Rng, blockW = 40, blockD = 36): void {
  const { ew, ns } = ruralGridDims(count);
  const rows: ReturnType<RoadBuilder["node"]>[][] = [];
  for (let r = 0; r < ew; r++) rows.push(blockGridRow(b, r, ns, ox + 2, oy + 12 + r * blockD + rng.range(-0.3, 0.3), blockW));
  for (let c = 0; c <= ns; c++) {
    for (let r = 0; r < ew - 1; r++) {
      b.segment(rows[r]![c]!, rows[r + 1]![c]!, linePoints(pt(rows[r]![c]!), pt(rows[r + 1]![c]!)), {
        roadClass: c === 0 || c === ns ? "rural" : "residential",
      });
    }
  }
  if (blockW >= 34) {
    const dead = rows[0]![0]!;
    const spur = b.node(dead.x - 18, dead.y + rng.range(-1, 1), dead.elev);
    b.segment(dead, spur, linePoints(pt(dead), pt(spur)), { roadClass: "service" });
  }
}

/** One east-west street of the block grid: `ns + 1` nodes joined left to right. */
function blockGridRow(b: RoadBuilder, r: number, ns: number, x0: number, y: number, blockW: number): ReturnType<RoadBuilder["node"]>[] {
  const row = [];
  for (let c = 0; c <= ns; c++) {
    row.push(b.node(x0 + c * blockW, y, r * 0.02));
  }
  for (let c = 0; c < ns; c++) {
    b.segment(row[c]!, row[c + 1]!, linePoints(pt(row[c]!), pt(row[c + 1]!)), {
      roadClass: r === 0 ? "rural" : "residential",
    });
  }
  return row;
}

function pickSkeleton(
  grid: SurfaceGrid,
  topology: TopologyFamily,
  count: number,
  originX: number,
  originY: number,
  seed: number,
  campaign: CampaignLevelDef | undefined,
): { builder: RoadBuilder; originX: number; originY: number } {
  let best: { builder: RoadBuilder; originX: number; originY: number; reject: number; mean: number } | undefined;
  for (const dy of [0, -1, 1, -2, 2]) {
    for (const dx of [0, -1, 1, -2, 2]) {
      const ox = originX + dx;
      const oy = originY + dy;
      const b = new RoadBuilder();
      buildSkeleton(b, topology, count, ox, oy, new Rng(seed), campaign);
      b.normalizeJunctions();
      const score = skeletonCost(b, grid);
      if (!best || score.reject < best.reject || (score.reject === best.reject && score.mean < best.mean)) {
        best = { builder: b, originX: ox, originY: oy, reject: score.reject, mean: score.mean };
      }
      if (score.reject === 0 && estimateSlots(b.segments, b.nodes) >= count * 1.5) return best;
    }
  }
  return best ?? { builder: new RoadBuilder(), originX, originY };
}

/** Terrain cost along every public street centreline. */
function skeletonCost(b: RoadBuilder, grid: SurfaceGrid): ReturnType<typeof meanRoadCost> {
  const samples: { x: number; y: number }[] = [];
  for (const seg of b.segments) {
    if (seg.roadClass === "driveway" || seg.roadClass === "ramp") continue;
    samples.push(...sampleSegmentCenterline(seg));
  }
  return meanRoadCost(grid, samples);
}

/** Street spacing for the small hand-shaped skeletons. */
interface SkeletonPlan {
  count: number;
  ox: number;
  oy: number;
  rng: Rng;
  pairPitch: number;
  collectors: number;
  spineLen: number;
  branch: number;
}

const SKELETONS: Record<TopologyFamily, (b: RoadBuilder, plan: SkeletonPlan) => void> = {
  county: countySkeleton,
  crossroads: crossroadsSkeleton,
  tjunction: tjunctionSkeleton,
  "curve-farm": curveFarmSkeleton,
  loop: loopSkeleton,
  frontage: frontageSkeleton,
};

function buildSkeleton(
  b: RoadBuilder,
  topology: TopologyFamily,
  count: number,
  ox: number,
  oy: number,
  rng: Rng,
  campaign?: CampaignLevelDef,
): RoadSegment[] {
  if (count >= 8) {
    buildBlockGrid(b, campaign?.composition ? count + 8 : count, ox, oy, rng, campaign?.generation.parcel.blockW, campaign?.generation.parcel.blockD);
    addTopologyFlavor(b, topology, ox, oy, rng);
    return b.segments.filter((s) => s.roadClass !== "driveway");
  }
  const pairPitch = 14.2 * 2 + 9.5;
  const collectors = Math.max(2, Math.ceil(count / 14));
  const slotsPerSide = Math.ceil(count / (collectors * 2)) + 4;
  const spineLen = Math.max(80, slotsPerSide * 12.8 + 18);
  const branch = Math.max(pairPitch * 0.6, 20 + count * 0.14);
  SKELETONS[topology](b, { count, ox, oy, rng, pairPitch, collectors, spineLen, branch });
  if (count >= 24) addSpurStreets(b, count);
  return b.segments.filter((s) => s.roadClass !== "driveway");
}

function countySkeleton(b: RoadBuilder, { count, ox, oy, rng, pairPitch, collectors, spineLen, branch }: SkeletonPlan): void {
  for (let r = 0; r < collectors; r++) {
    const y = oy + 16 + r * pairPitch + rng.range(-1.0, 1.0);
    const elev = r * 0.08;
    const a = b.node(ox, y, elev);
    const m = b.node(ox + spineLen * 0.5, y + rng.range(-1.6, 1.6), elev + 0.1);
    const c = b.node(ox + spineLen, y + rng.range(-1.0, 1.0), elev + 0.2);
    b.segment(a, m, linePoints(pt(a), pt(m)), { roadClass: "rural" });
    b.segment(m, c, linePoints(pt(m), pt(c)), { roadClass: "rural" });
  }
  const crosses = Math.max(1, collectors + (count >= 30 ? 2 : 0));
  const main = b.segments[0]!;
  for (let i = 0; i < crosses; i++) {
    const t = 0.16 + (i / Math.max(1, crosses)) * 0.68 + rng.range(-0.015, 0.015);
    const p = samplePolyline(main.points, Math.min(0.9, t));
    const at = b.joinAt(p.x, p.y, p.elev, 0);
    const n0 = b.node(p.x, oy + 4, p.elev);
    const n1 = b.node(p.x + rng.range(-0.8, 0.8), oy + 16 + (collectors - 1) * pairPitch + branch * 0.4, p.elev);
    b.segment(n0, at, linePoints(pt(n0), pt(at)), { roadClass: "residential" });
    b.segment(at, n1, linePoints(pt(at), pt(n1)), { roadClass: "residential" });
  }
}

function crossroadsSkeleton(b: RoadBuilder, { count, ox, oy, rng, spineLen, branch }: SkeletonPlan): void {
  const cx = ox + spineLen * 0.42;
  const cy = oy + branch * 0.55;
  const c = b.node(cx, cy, 0.1);
  const w = b.node(ox, cy + rng.range(-1, 1), 0);
  const e = b.node(ox + spineLen, cy + rng.range(-1, 1), 0.25);
  const n = b.node(cx + rng.range(-1, 1), oy + branch * 1.15, 0.15);
  const s = b.node(cx + rng.range(-1, 1), oy, 0);
  b.segment(w, c, linePoints(pt(w), pt(c)), { roadClass: "rural" });
  b.segment(c, e, linePoints(pt(c), pt(e)), { roadClass: "rural" });
  b.segment(n, c, linePoints(pt(n), pt(c)), { roadClass: "residential" });
  b.segment(c, s, linePoints(pt(c), pt(s)), { roadClass: "residential" });
  if (count >= 24) {
    const svc = b.node(cx + 8, cy + 7, 0.1);
    b.segment(c, svc, linePoints(pt(c), pt(svc)), { roadClass: "service" });
  }
  if (count >= 16) {
    const mid = samplePolyline(b.segments[0]!.points, 0.55);
    const j = b.joinAt(mid.x, mid.y, mid.elev, 0);
    const spur = b.node(mid.x, mid.y + branch * 0.35, mid.elev);
    b.segment(j, spur, linePoints(pt(j), pt(spur)), { roadClass: "residential" });
  }
}

function tjunctionSkeleton(b: RoadBuilder, { ox, oy, rng, spineLen, branch }: SkeletonPlan): void {
  const c = b.node(ox + spineLen * 0.4, oy + 16, 0.1);
  const w = b.node(ox, oy + 16, 0);
  const e = b.node(ox + spineLen, oy + 16, 0.2);
  const n = b.node(ox + spineLen * 0.4, oy + 16 + branch, 0.15);
  b.segment(w, c, linePoints(pt(w), pt(c)), { roadClass: "rural" });
  b.segment(c, e, linePoints(pt(c), pt(e)), { roadClass: "rural" });
  b.segment(c, n, linePoints(pt(c), pt(n)), { roadClass: "residential" });
  const stem = samplePolyline(b.segments[2]!.points, 0.58);
  const j = b.joinAt(stem.x, stem.y, stem.elev, 0);
  const dead = b.node(stem.x + branch * 0.42, stem.y + rng.range(-1.2, 1.2), stem.elev);
  b.segment(j, dead, linePoints(pt(j), pt(dead)), { roadClass: "residential" });
}

function curveFarmSkeleton(b: RoadBuilder, { count, ox, oy, rng, spineLen, branch }: SkeletonPlan): void {
  const a = b.node(ox, oy + 10, 0);
  const ctrl = { x: ox + spineLen * 0.45, y: oy + 10 + branch * 0.55, elev: 0.4 };
  const c = b.node(ox + spineLen, oy + 12 + rng.range(-2, 4), 0.7);
  const mid = b.node(ctrl.x, ctrl.y, ctrl.elev);
  b.segment(a, mid, curvePoints(pt(a), ctrl, pt(mid)), { roadClass: "rural" });
  b.segment(mid, c, curvePoints(pt(mid), { x: (ctrl.x + c.x) * 0.5, y: ctrl.y - 4, elev: 0.55 }, pt(c)), {
    roadClass: "rural",
  });
  const spur = b.node(ctrl.x + 6, ctrl.y + branch * 0.35, 0.4);
  b.segment(mid, spur, linePoints(pt(mid), pt(spur)), { roadClass: "service" });
  if (count >= 20) {
    const p = samplePolyline(b.segments[0]!.points, 0.48);
    const j = b.joinAt(p.x, p.y, p.elev, 0);
    const local = b.node(p.x - 4, p.y + 16, p.elev);
    b.segment(j, local, linePoints(pt(j), pt(local)), { roadClass: "residential" });
  }
}

function loopSkeleton(b: RoadBuilder, { count, ox, oy }: SkeletonPlan): void {
  const r = Math.max(18, 14 + count * 0.28);
  const cx = ox + r + 8;
  const cy = oy + r + 8;
  const nodes = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2;
    return b.node(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.05);
  });
  for (let i = 0; i < nodes.length; i++) {
    b.segment(nodes[i]!, nodes[(i + 1) % nodes.length]!, linePoints(pt(nodes[i]!), pt(nodes[(i + 1) % nodes.length]!)), {
      roadClass: "residential",
    });
  }
  const stem = b.node(cx + r + 16, cy, 0);
  b.segment(nodes[0]!, stem, linePoints(pt(nodes[0]!), pt(stem)), { roadClass: "rural" });
  b.segment(nodes[2]!, nodes[5]!, linePoints(pt(nodes[2]!), pt(nodes[5]!)), { roadClass: "residential" });
}

function frontageSkeleton(b: RoadBuilder, { count, ox, oy, spineLen }: SkeletonPlan): void {
  const a = b.node(ox, oy + 20, 0);
  const c = b.node(ox + spineLen, oy + 20, 0.15);
  b.segment(a, c, linePoints(pt(a), pt(c)), { roadClass: "rural" });
  const s0 = b.node(ox + 6, oy + 12, 0);
  const s1 = b.node(ox + spineLen - 6, oy + 12, 0.1);
  b.segment(s0, s1, linePoints(pt(s0), pt(s1)), { roadClass: "service" });
  const links = count >= 20 ? 3 : 2;
  for (let i = 0; i < links; i++) {
    const t = 0.2 + (i / Math.max(1, links - 1)) * 0.6;
    const p = samplePolyline(b.segments[0]!.points, t);
    const q = samplePolyline(b.segments[1]!.points, t);
    const n0 = b.joinAt(p.x, p.y, p.elev, 0);
    const n1 = b.joinAt(q.x, q.y, q.elev, 0);
    b.segment(n0, n1, linePoints(pt(n0), pt(n1)), { roadClass: "residential" });
  }
}

/** Perpendicular residential spurs off the first streets, one per ten buildings. */
function addSpurStreets(b: RoadBuilder, count: number): void {
  const extras = Math.ceil(count / 10);
  for (let i = 0; i < extras; i++) {
    const host = b.segments.filter((s) => s.roadClass !== "driveway")[i % Math.max(1, b.segments.length)]!;
    const t = 0.28 + (i * 0.19) % 0.5;
    const p = samplePolyline(host.points, t);
    const j = b.joinAt(p.x, p.y, p.elev, host.layer);
    const heading = p.heading + (i % 2 === 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    const reach = 28 + count * 0.08;
    const end = b.node(j.x + Math.cos(heading) * reach, j.y + Math.sin(heading) * reach, p.elev, undefined, host.layer);
    b.segment(j, end, linePoints(pt(j), pt(end)), { roadClass: "residential", layer: host.layer });
  }
}

function estimateSlots(segments: readonly RoadSegment[], nodes: readonly { id: string; segmentIds: string[] }[]): number {
  const publicSegs = segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  const publicIds = new Set(publicSegs.map((s) => s.id));
  let n = 0;
  for (const seg of publicSegs) {
    const path = polylineLength(seg.points);
    const start = (nodes.find((x) => x.id === seg.startId)?.segmentIds.filter((id) => publicIds.has(id)).length ?? 1) >= 3 ? 3.6 : 1.4;
    const end = (nodes.find((x) => x.id === seg.endId)?.segmentIds.filter((id) => publicIds.has(id)).length ?? 1) >= 3 ? 3.6 : 1.4;
    const parcel = currentParcel();
    const pitch = parcel === PARCEL ? 9 : Math.max(6, parcel.minFront + parcel.lotGap);
    n += Math.max(0, Math.floor((path - start - end) / pitch)) * 2;
  }
  return n;
}

function zoneForIndex(i: number, count: number, segmentId: string, segs: readonly RoadSegment[]): Lot["zone"] {
  const seg = segs.find((s) => s.id === segmentId);
  const roadClass = seg?.roadClass ?? "residential";
  if (roadClass === "service" || roadClass === "commercial") return i % 3 === 0 ? "industrial" : "commercial";
  if (i === 0) return "commercial";
  if (i >= count - 2) return "industrial";
  return i % 6 === 0 ? "commercial" : "residential";
}


function placeRoadside(
  network: RoadNetwork,
  lots: Lot[],
  buildings: Building[],
  props: Prop[],
  rng: Rng,
  count: number,
  corridors: readonly { x: number; y: number }[][],
): void {
  const occ = [...buildings.flatMap(buildingOccupy), ...lots.map((l) => ({ x: l.x, y: l.y, w: l.w, d: l.d }))];
  for (const p of props) occ.push({ x: p.x, y: p.y, w: p.w, d: p.d });
  const roadside = { occ, props, corridors, placed: 0, cap: Math.min(count + 8, 4 + Math.floor(count * 0.35)) };
  for (const seg of network.segments) {
    if (seg.roadClass !== "driveway") placeAlongSegment(seg, rng, roadside);
  }
}

const ROADSIDE_IDS = ["stop-sign", "power-pole", "fire-hydrant", "guardrail", "traffic-barrel", "billboard", "light"];

/** One or two roadside props on alternating sides of a segment, skipping spots that are taken. */
function placeAlongSegment(
  seg: RoadSegment,
  rng: Rng,
  roadside: { occ: { x: number; y: number; w: number; d: number }[]; props: Prop[]; corridors: readonly { x: number; y: number }[][]; placed: number; cap: number },
): void {
  const path = Math.max(8, polylineLength(seg.points));
  const n = path > 30 ? 2 : 1;
  for (let i = 0; i < n && roadside.placed < roadside.cap; i++) {
    const t = 0.18 + i * 0.38 + rng.range(0, 0.08);
    const p = samplePolyline(seg.points, Math.min(0.86, t));
    const side = i % 2 === 0 ? 1 : -1;
    const pos = offsetPoint(p.x, p.y, p.heading, (seg.width * 0.5 + 0.55) * side);
    const id = rng.pick(ROADSIDE_IDS);
    const asset = spawnAsset(id, pos.x - 0.15, pos.y - 0.15, p.heading + (side > 0 ? 0 : Math.PI), rng.int(0, 2));
    if (roadside.occ.some((box) => aabbOverlap(asset.x, asset.y, asset.w, asset.d, box.x, box.y, box.w, box.d))) continue;
    if (roadside.corridors.some((poly) => pointNearPoly(asset.x + asset.w * 0.5, asset.y + asset.d * 0.5, poly))) continue;
    roadside.props.push(asset);
    roadside.occ.push({ x: asset.x, y: asset.y, w: asset.w, d: asset.d });
    roadside.placed++;
  }
}

function pointNearPoly(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const c = poly[(i + 1) % poly.length]!;
    const abx = c.x - a.x;
    const aby = c.y - a.y;
    const t = clamp01(((x - a.x) * abx + (y - a.y) * aby) / (abx * abx + aby * aby + 1e-8));
    if (len(x - (a.x + abx * t), y - (a.y + aby * t)) < 1.1) return true;
  }
  return false;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function propTouchesPavement(network: RoadNetwork, p: Prop): boolean {
  return pointOnRoad(network, p.x + p.w * 0.5, p.y + p.d * 0.5);
}

/** Clear of `avoid` by 6 units, on open terrain, and with room for a vehicle. */
function spawnOpen(p: { x: number; y: number }, buildings: Building[], props: Prop[], avoid: { x: number; y: number } | undefined, grid: SurfaceGrid | undefined): boolean {
  if (avoid && len(p.x - avoid.x, p.y - avoid.y) < 6) return false;
  if (grid && traversalAt(grid, p.x, p.y) !== "open") return false;
  return spawnPointClear(buildings, props, p.x, p.y, 1.4);
}

function pickSpawn(
  network: RoadNetwork,
  buildings: Building[],
  props: Prop[],
  pick: number,
  avoid?: { x: number; y: number },
  prefer?: { x: number; y: number },
  grid?: SurfaceGrid,
): { x: number; y: number; heading: number } {
  const segs = network.segments.filter((s) => s.roadClass === "rural" || s.roadClass === "residential");
  const pool = segs.length ? segs : network.segments.filter((s) => s.roadClass !== "driveway");
  const candidates: { x: number; y: number; heading: number }[] = [];
  for (const seg of pool) {
    for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const p = samplePolyline(seg.points, t);
      if (spawnOpen(p, buildings, props, avoid, grid)) candidates.push(p);
    }
  }
  if (prefer && candidates.length) {
    candidates.sort((a, b) => len(a.x - prefer.x, a.y - prefer.y) - len(b.x - prefer.x, b.y - prefer.y));
  }
  const chosen = candidates[Math.min(pick, Math.max(0, candidates.length - 1))];
  if (chosen) return chosen;
  const scanned = grid ? scanForSpawn(pool, buildings, props, avoid, grid) : undefined;
  if (scanned) return scanned;
  const fallback = samplePolyline(pool[0]!.points, 0.4);
  return { x: fallback.x, y: fallback.y, heading: fallback.heading };
}

/** Finer 5% walk along each segment for the first open spot. */
function scanForSpawn(pool: readonly RoadSegment[], buildings: Building[], props: Prop[], avoid: { x: number; y: number } | undefined, grid: SurfaceGrid): { x: number; y: number; heading: number } | undefined {
  for (const seg of pool) {
    for (let t = 0.05; t <= 0.95; t += 0.05) {
      const p = samplePolyline(seg.points, t);
      if (spawnOpen(p, buildings, props, avoid, grid)) return p;
    }
  }
  return undefined;
}

/** No building or unbroken prop within the `rad` square around the point. */
export function spawnPointClear(buildings: readonly Building[], props: readonly Prop[], x: number, y: number, rad: number): boolean {
  for (const b of buildings) {
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, b.x, b.y, b.w * b.cellSize, b.d * b.cellSize)) return false;
  }
  for (const p of props) {
    if (p.broken) continue;
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, p.x, p.y, p.w, p.d)) return false;
  }
  return true;
}

function assignedPicker(
  campaign: CampaignLevelDef,
  used: Map<string, number>,
  assignedId: string,
  ordinaryTarget: number,
) {
  const assigned = archetypeById(assignedId);
  return (lot: Lot, rng: Rng, tried: ReadonlySet<string>) => {
    if (!tried.has(assigned.id) && campaignEligible(assigned.campaign, campaign.id, { used: used.get(assigned.id) ?? 0 })) {
      const size = archetypeFootprint(assigned);
      if (size.w + 0.08 <= lot.buildable.w && size.d + 0.08 <= lot.buildable.d) return assigned;
    }
    const fallbacks = sameBandCandidates(assigned, campaign, ARCHETYPES, used, ordinaryTarget)
      .filter(entry => !tried.has(entry.id))
      .sort((a, b) => {
        if (assigned.floors >= 8) {
          const prefer = (entry: Archetype) => entry.floors >= 8 ? 0 : 1;
          const ranked = prefer(a) - prefer(b);
          if (ranked) return ranked;
        }
        return Math.abs(a.floors - assigned.floors) - Math.abs(b.floors - assigned.floors);
      });
    const fitting = fallbacks.filter(entry => {
      const size = archetypeFootprint(entry);
      return size.w + 0.08 <= lot.buildable.w && size.d + 0.08 <= lot.buildable.d;
    });
    return fitting[0] ?? pickWeighted(fitting, entry => campaignWeight(entry.campaign, campaign.id) || 1, (min, max) => rng.range(min, max));
  };
}

function placeCampaignLot(run: RuralPlacement, lot: Lot, assignedId: string | undefined, neighbors: Lot[]): boolean {
  const { campaign, kept, rejected } = run;
  lot.zone = zoneForIndex(kept.length, run.count, lot.frontage.segmentId, run.b.segments);
  if (lot.boundary.length >= 3 && kept.some((k) => k.boundary.length >= 3 && convexOverlap(lot.boundary, k.boundary))) {
    rejected.push({ kind: "lot", reason: "overlap", points: lot.boundary });
    return false;
  }
  if (campaign && assignedId) growLotForAssigned(run, lot, archetypeFootprint(archetypeById(assignedId)), neighbors);
  const ordinaryTarget = campaign ? campaign.generation.buildingCount - 1 : 0;
  const picker = campaign && assignedId ? assignedPicker(campaign, run.used, assignedId, ordinaryTarget) : run.pick;
  const building = placeBuildingInLot(lot, run.rng, run.buildings, run.publicSegs(), run.corridors, picker);
  if (!building) {
    rejected.push({ kind: "building", reason: assignedId ? `no-fit:${assignedId}` : "no-fit", points: lot.boundary });
    return false;
  }
  if (lotEnvelopeRejected(run.surface, lot)) {
    rejected.push({ kind: "lot", reason: "terrain", points: lot.boundary });
    return false;
  }
  lot.identity = identityFromBuilding(building);
  lot.templateId = "";
  const drive = attachDriveway(run.b, lot, building, [...kept, ...neighbors]);
  if (!drive || drive.reject) {
    rejected.push(drive?.reject ?? { kind: "driveway", reason: "failed", points: lot.boundary });
    return false;
  }
  run.buildings.push(building);
  kept.push(lot);
  run.corridors.push(drive.corridor);
  run.used.set(building.archetypeId, (run.used.get(building.archetypeId) ?? 0) + 1);
  return true;
}

/** Grow a lot too small for its assigned building; undo the growth if it fails or would evict a kept lot. */
function growLotForAssigned(run: RuralPlacement, lot: Lot, size: { w: number; d: number }, neighbors: Lot[]): void {
  if (!(lot.buildable.w + 0.08 < size.w || lot.buildable.d + 0.08 < size.d)) return;
  const { kept } = run;
  const snapshot = {
    frontage: { ...lot.frontage },
    boundary: lot.boundary.map(point => ({ ...point })),
    buildable: { ...lot.buildable },
    x: lot.x,
    y: lot.y,
    w: lot.w,
    d: lot.d,
    heading: lot.heading,
  };
  const evicted = expandLotToFit(lot, size.w, size.d, run.publicSegs(), [...neighbors, ...kept], run.surface);
  if (!evicted || evicted.some(id => kept.some(entry => entry.id === id))) {
    Object.assign(lot, snapshot);
    return;
  }
  for (const id of evicted) {
    const index = neighbors.findIndex(entry => entry.id === id);
    if (index >= 0) neighbors.splice(index, 1);
  }
}

function neighborSharesArchetype(buildings: readonly Building[], lot: Lot, id: string): boolean {
  const cx = lot.x + lot.w * 0.5;
  const cy = lot.y + lot.d * 0.5;
  for (const building of buildings) {
    if (building.archetypeId !== id) continue;
    const bx = building.x + building.w * building.cellSize * 0.5;
    const by = building.y + building.d * building.cellSize * 0.5;
    if (Math.hypot(bx - cx, by - cy) < 28) return true;
  }
  return false;
}

function campaignPicker(campaign: CampaignLevelDef, used: Map<string, number>, buildings: readonly Building[]) {
  return (lot: Lot, rng: Rng, tried: ReadonlySet<string>) => {
    const ordinaryTarget = campaign.generation.buildingCount - 1;
    const legal = campaign.composition
      ? legalOrdinaryCandidates(campaign, ARCHETYPES, used, ordinaryTarget)
      : ARCHETYPES.filter(a => campaignEligible(a.campaign, campaign.id, { zone: lot.zone, used: used.get(a.id) ?? 0 }));
    const pool = legal.filter(a =>
      !tried.has(a.id) &&
      campaignEligible(a.campaign, campaign.id, {
        zone: lot.zone,
        used: used.get(a.id) ?? 0,
        urbanBand: lot.urbanBand as UrbanBand | undefined,
      }),
    );
    const fitting = pool.filter(a => {
      const size = archetypeFootprint(a);
      return size.w + 0.08 <= lot.buildable.w && size.d + 0.08 <= lot.buildable.d;
    });
    const zoned = (fitting.length ? fitting : pool).filter(a =>
      (a.campaign?.zones ? a.campaign.zones.includes(lot.zone) : a.zones[lot.zone] > 0) || !a.campaign?.zones,
    );
    const pickFrom = zoned.length ? zoned : (fitting.length ? fitting : pool);
    return pickWeighted(pickFrom, (a) => {
      const base = campaignWeight(a.campaign, campaign.id) || 1;
      return neighborSharesArchetype(buildings, lot, a.id) ? base * 0.12 : base;
    }, (min, max) => rng.range(min, max));
  };
}

const CIVIC_RANK: Readonly<Record<string, number>> = {
  'downtown-core': 3, 'borough-center': 3, 'civic-center': 3, 'village-main-street': 3,
  'transition-ring': 2, 'mixed-use-corridor': 2, 'commercial-corridor': 2,
};
const civicRank = (lot: Lot): number => CIVIC_RANK[lot.districtRole ?? ''] ?? 1;

function placeCampaignLandmark(run: RuralPlacement, campaign: CampaignLevelDef, pool: Lot[]): void {
  const landmark = archetypeById(campaign.landmark.buildingId);
  const ranked = [...pool]
    .filter(lot => !lot.openSpaceName)
    .sort((a, c) => civicRank(c) - civicRank(a) || c.w * c.d - a.w * a.d || (c.x + c.w * 0.5) - (a.x + a.w * 0.5));
  for (const lot of ranked) {
    const building = landmarkOnLot(run, landmark, lot, pool);
    if (!building) continue;
    building.campaignLandmark = true;
    building.name = campaign.landmark.label.toUpperCase();
    return;
  }
}

/** Try the landmark on one lot, growing the lot (and evicting pool lots) when it is too small. */
function landmarkOnLot(run: RuralPlacement, landmark: Archetype, lot: Lot, pool: Lot[]): Building | null {
  const size = archetypeFootprint(landmark);
  lot.zone = 'commercial';
  lot.identity = 'shop';
  if (lotEnvelopeRejected(run.surface, lot)) return null;
  if (lot.buildable.w + 0.08 < size.w || lot.buildable.d + 0.08 < size.d) {
    const evicted = expandLotToFit(lot, size.w, size.d, run.publicSegs(), pool, run.surface);
    if (!evicted) return null;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (evicted.includes(pool[i]!.id)) pool.splice(i, 1);
    }
  }
  const pickLandmark = (_lot: Lot, _rng: Rng, tried: ReadonlySet<string>) => tried.has(landmark.id) ? undefined : landmark;
  const building = placeBuildingInLot(lot, run.rng, run.buildings, run.publicSegs(), run.corridors, pickLandmark);
  if (!building) return null;
  lot.identity = identityFromBuilding(building);
  lot.templateId = "";
  const drive = attachDriveway(run.b, lot, building, [...run.kept, ...pool]);
  if (!drive || drive.reject) return null;
  run.buildings.push(building);
  run.kept.push(lot);
  run.corridors.push(drive.corridor);
  run.used.set(building.archetypeId, 1);
  return building;
}

/** Forward, left, right, back relative to the lot's street heading. */
function lotDirections(heading: number): readonly [number, number][] {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  return [
    [fx, fy],
    [-fy, fx],
    [fy, -fx],
    [-fx, -fy],
  ];
}

const boxesTouchRoad = (network: RoadNetwork, boxes: readonly { x: number; y: number; w: number; d: number }[]): boolean =>
  boxes.some(box => aabbOverlapsRoad(network, box.x, box.y, box.w, box.d));

function nudgeBuildingsOffStreets(buildings: Building[], lots: readonly Lot[], network: RoadNetwork): void {
  const byId = new Map(lots.map(lot => [lot.id, lot]));
  for (const building of buildings) {
    const lot = byId.get(building.lotId ?? '');
    if (!lot) continue;
    const footprint = { w: building.w * building.cellSize, d: building.d * building.cellSize };
    if (!boxesTouchRoad(network, [{ x: building.x, y: building.y, ...footprint }, ...building.decorBoxes])) continue;
    for (const [dx, dy] of lotDirections(lot.heading)) {
      if (slideOffStreet(building, footprint, lot, network, dx, dy)) break;
    }
  }
}

/** Step the building up to ten 0.28-unit moves along (dx, dy) inside its envelope; restore it unless it clears the road. */
function slideOffStreet(building: Building, footprint: { w: number; d: number }, lot: Lot, network: RoadNetwork, dx: number, dy: number): boolean {
  const originX = building.x;
  const originY = building.y;
  const originDecor = building.decorBoxes.map(box => ({ ...box }));
  for (let step = 0; step < 10; step++) {
    const next = { x: building.x + dx * 0.28, y: building.y + dy * 0.28, ...footprint };
    if (!aabbContained(next, lot.buildable)) break;
    building.x = next.x;
    building.y = next.y;
    for (const box of building.decorBoxes) {
      box.x += dx * 0.28;
      box.y += dy * 0.28;
    }
    if (!boxesTouchRoad(network, [{ x: building.x, y: building.y, ...footprint }, ...building.decorBoxes])) return true;
  }
  building.x = originX;
  building.y = originY;
  for (let i = 0; i < building.decorBoxes.length; i++) {
    building.decorBoxes[i] = originDecor[i]!;
  }
  return false;
}

function aabbContained(
  box: { x: number; y: number; w: number; d: number },
  env: { x: number; y: number; w: number; d: number },
): boolean {
  return box.x >= env.x - 0.02
    && box.y >= env.y - 0.02
    && box.x + box.w <= env.x + env.w + 0.02
    && box.y + box.d <= env.y + env.d + 0.02;
}

function applyTerrain(field: TerrainField, topology: TopologyFamily, minX: number, maxX: number): void {
  if (topology !== "curve-farm" && topology !== "county") return;
  const w = Math.max(1, maxX - minX);
  for (let iy = 0; iy < field.rows; iy++) {
    for (let ix = 0; ix < field.cols; ix++) {
      const x = field.ox + ix * field.cell;
      const t = (x - minX) / w;
      field.height[iy * field.cols + ix] = topology === "curve-farm" ? Math.sin(t * Math.PI) * 0.7 : t * 0.35;
    }
  }
}
