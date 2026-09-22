import { campaignPaintsOpenFields, type CampaignLevelDef } from "../game/campaign";
import { DRESSING } from "../game/constants";
import { aabbOverlap, len } from "../game/math";
import { Rng } from "../game/rng";
import { DISTRICT_COUNTS, type DistrictId } from "../game/session";
import type { Building, GroundPatch, Lot, Prop } from "../structure/types";
import { selectBiome, type BiomeProfile } from "./biomes";
import type { SeasonId } from "./season";
import { getAsset, spawnAsset } from "./catalog";
import { buildingOccupy, dressLot } from "./dressing";
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
  convexOverlap,
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

export function pickTopology(rng: Rng, count: number): TopologyFamily {
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
  const issues: LayoutIssue[] = [];
  const rejected: NhoodReject[] = [];
  const blockW = campaign?.generation.parcel.blockW ?? 40;
  const blockD = campaign?.generation.parcel.blockD ?? 36;
  const bounds = estimateRuralSurfaceBounds(count, originX, originY, blockW, blockD);
  const spawnBand = { x: originX + 2, y: originY + 8, w: 18, d: 18 };
  const surface = generateSurfaceGrid({
    seed,
    biome,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    spawnBand,
    openFields: campaign ? campaignPaintsOpenFields(campaign.id) : true,
  });

  const { builder: b, originX: usedOx, originY: usedOy } = pickSkeleton(surface, topology, count, originX, originY, seed, campaign);
  void usedOx;
  void usedOy;

  for (let pass = 0; pass <= (campaign?.generation.parcel.maxExpand ?? PARCEL.maxExpand); pass++) {
    const slots = estimateSlots(b.segments, b.nodes);
    if (slots >= count * 1.7) break;
    if (!expandStreets(b, rng, pass, surface) && !expandStreets(b, rng, pass)) {
      if (slots >= count) break;
      continue;
    }
    b.normalizeJunctions();
  }

  const clusterRng = new Rng(seed ^ 0x51a11);
  const developed = selectStreetCluster(
    b.segments,
    b.nodes,
    campaign ? Math.ceil(count * 2.4) + 4 : Math.ceil(count * 1.7) + 6,
    clusterRng,
  );
  const alloc = allocateFrontage(developed, b.nodes, campaign ? count * 4 : count * 3, new Rng(seed ^ 0x51a11), [], b.segments, surface);
  const pool = campaign
    ? selectLotCluster(alloc.lots, Math.min(alloc.lots.length, count * 3), new Rng(seed ^ 0xc1a55))
    : selectLotCluster(alloc.lots, count * 2, new Rng(seed ^ 0xc1a55));
  rejected.push(...alloc.rejected);
  let urban = campaign ? classifyUrbanGeography(campaign, pool, b.segments, b.nodes) : undefined;
  if (campaign && urban) {
    urban = reserveNamedOpenSpaces(campaign, pool, urban);
    applyUrbanTags(pool, urban);
  }

  const buildings: Building[] = [];
  const kept: Lot[] = [];
  const corridors: { x: number; y: number }[][] = [];
  const used = new Map<string, number>();
  const publicSegs = () => b.segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  const pick = campaign ? campaignPicker(campaign, used, buildings) : undefined;

  if (campaign) placeCampaignLandmark(campaign, pool, rng, buildings, kept, corridors, publicSegs, b, used, surface);

  let ordinaryLots = pool.filter(lot => !kept.some(keptLot => keptLot.id === lot.id));
  let assignedId = new Map<string, string>();
  if (campaign?.composition) {
    const plan = planCampaignComposition(campaign, ordinaryLots, count - buildings.length, ARCHETYPES, rng);
    for (const detail of plan.issues.filter(text => !text.includes('planned'))) {
      issues.push({ code: 'composition-plan', detail });
    }
    assignedId = new Map(plan.assignments.map(entry => [entry.lotId, entry.buildingId]));
    ordinaryLots = [...ordinaryLots].sort((a, c) => {
      const ai = plan.assignments.findIndex(entry => entry.lotId === a.id);
      const bi = plan.assignments.findIndex(entry => entry.lotId === c.id);
      return (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi);
    });
  }

  for (const lot of ordinaryLots) {
    if (kept.length >= count) break;
    if (lot.openSpaceName) continue;
    if (kept.some(k => k.id === lot.id)) continue;
    if (!placeCampaignLot(campaign, lot, rng, buildings, kept, corridors, publicSegs, b, used, pick, assignedId.get(lot.id), pool, rejected, count, surface)) {
      continue;
    }
  }

  if (kept.length < count) {
    const extraSegs = selectStreetCluster(b.segments, b.nodes, Math.ceil(count * 3.2), new Rng(seed ^ 0x222));
    const extra = allocateFrontage(extraSegs, b.nodes, count * 3, new Rng(seed ^ 0x222), kept, b.segments, surface);
    rejected.push(...extra.rejected);
    if (campaign && extra.lots.length) {
      const extraFresh = extra.lots.filter(lot => !kept.some(keptLot => keptLot.id === lot.id));
      const extraUrban = classifyUrbanGeography(campaign, extraFresh, b.segments, b.nodes);
      applyUrbanTags(extraFresh, extraUrban);
    }
    for (const lot of extra.lots) {
      if (kept.length >= count) break;
      if (kept.some((k) => k.id === lot.id)) continue;
      if (!placeCampaignLot(campaign, lot, rng, buildings, kept, corridors, publicSegs, b, used, pick, undefined, extra.lots, rejected, count, surface)) {
        continue;
      }
    }
  }

  if (kept.length < count) {
    for (const lot of ordinaryLots) {
      if (kept.length >= count) break;
      if (lot.openSpaceName) continue;
      if (kept.some((k) => k.id === lot.id)) continue;
      if (!placeCampaignLot(campaign, lot, rng, buildings, kept, corridors, publicSegs, b, used, pick, assignedId.get(lot.id), pool, rejected, count, surface)) {
        continue;
      }
    }
  }

  if (kept.length < count) {
    issues.push({
      code: "capacity",
      detail: `placed ${kept.length} of ${count} after bounded expansion (${rejected.length} rejected)`,
    });
  }

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
  if (campaign) nudgeBuildingsOffStreets(buildings, kept, network);

  const occBoxes = buildings.flatMap(buildingOccupy);
  const props: Prop[] = [];
  const ground: GroundPatch[] = [];
  const perLot = campaign?.generation.propsPerLot ?? (count >= 80 ? 8 : 10);
  const eligible = campaign
    ? (assetId: string) => campaignEligible(getAsset(assetId).campaign, campaign.id)
    : undefined;
  for (let i = 0; i < kept.length; i++) {
    const lot = kept[i]!;
    const dressed = dressLot(lot, buildings[i], rng, { boxes: occBoxes }, perLot, corridors, eligible);
    props.push(...dressed.props);
    ground.push(...dressed.patches);
    for (const p of dressed.props) occBoxes.push({ x: p.x, y: p.y, w: p.w, d: p.d });
  }

  placeRoadside(network, kept, buildings, props, rng, count, corridors);
  for (let i = props.length - 1; i >= 0; i--) {
    const p = props[i]!;
    const def = getAsset(p.assetId);
    if (campaign && !campaignEligible(def.campaign, campaign.id)) { props.splice(i, 1); continue; }
    if (def.roadsideOk) continue;
    if (propTouchesPavement(network, p)) props.splice(i, 1);
  }

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

  const terrain = emptyTerrain(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
  applyTerrain(terrain, topology, minX, maxX);
  enforceOpenCorridors(surface, network, kept, buildings);
  stampDeveloped(surface, network, kept, ground);
  finalizeStampedSurface(surface, biome, seed, { network, lots: kept, buildings });

  if (campaign && urban) {
    const keptIds = new Set(kept.map(lot => lot.id));
    urban.lots = urban.lots.filter(info => keptIds.has(info.lotId));
    urban.blocks = enumerateRoadBlocks(network.nodes).map(block => {
      const inside = kept.filter(lot => {
        const c = { x: lot.x + lot.w * 0.5, y: lot.y + lot.d * 0.5 };
        return c.x >= block.x && c.x <= block.x + block.w && c.y >= block.y && c.y <= block.y + block.d;
      });
      const prior = urban!.openSpaces.find(space => Math.abs(space.x - block.x) < 3 && Math.abs(space.y - block.y) < 3);
      const empty = inside.length === 0 && block.w * block.d >= 80;
      if (empty && !prior && (campaign.id === 'city-borough' || campaign.id === 'city-downtown')) {
        const kind = campaign.id === 'city-downtown' ? 'plaza' : 'park';
        const names = kind === 'plaza'
          ? ['Market Plaza', 'Station Plaza', 'Founders Plaza']
          : ['Borough Green', 'Elm Park', 'Canal Park'];
        const used = new Set(urban!.openSpaces.map(space => space.name));
        const name = names.find(entry => !used.has(entry)) ?? names[urban!.openSpaces.length % names.length]!;
        urban!.openSpaces.push({
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
      return {
        ...block,
        lotIds: inside.map(lot => lot.id),
        coverage: inside.reduce((sum, lot) => sum + lot.w * lot.d, 0) / Math.max(1, block.w * block.d),
        role: prior?.kind ?? (empty ? (campaign.id === 'city-downtown' ? 'plaza' : 'park') : 'borough-neighborhood'),
        reserved: !!(prior || empty),
      };
    });
    const byRole: Record<string, number> = {};
    const byBand: Record<string, number> = {};
    for (const info of urban.lots) {
      byRole[info.districtRole] = (byRole[info.districtRole] ?? 0) + 1;
      byBand[info.urbanBand] = (byBand[info.urbanBand] ?? 0) + 1;
    }
    urban.byRole = byRole;
    urban.byBand = byBand;
  }

  const roads = derivedRoadBoxes(network);
  const cluster = buildings.length
    ? {
      x: buildings.reduce((sum, building) => sum + building.x + building.w * building.cellSize * 0.5, 0) / buildings.length,
      y: buildings.reduce((sum, building) => sum + building.y + building.d * building.cellSize * 0.5, 0) / buildings.length,
    }
    : undefined;
  const spawn = pickSpawn(network, buildings, props, 0, undefined, campaign ? cluster : undefined, surface);
  const roadSpawn = pickSpawn(network, buildings, props, 1, spawn, campaign ? cluster : undefined, surface);
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
    diagnostic: { ok: issues.length === 0 && kept.length === count, issues },
    nhood: { rejected, urban },
    urban,
  };
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

function gridDims(count: number): { ew: number; ns: number } {
  const minSlots = count <= 12 ? count * 2.2 : count <= 36 ? count * 2.0 : count * 2.15;
  const target = count <= 12 ? count * 2.6 : count * 2.3;
  let best = { ew: 2, ns: 2 };
  let bestScore = Infinity;
  for (let ew = 2; ew <= 7; ew++) {
    for (let ns = 2; ns <= 7; ns++) {
      const segs = ew * ns + (ns + 1) * (ew - 1);
      const slots = segs * 6;
      if (slots < minSlots) continue;
      const score = Math.abs(slots - target) + Math.abs(ew - ns) * 3 + ew * ns * 0.15;
      if (score < bestScore) {
        best = { ew, ns };
        bestScore = score;
      }
    }
  }
  return best;
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

  const neighborsOf = (id: string): RoadSegment[] => {
    const seg = byId.get(id);
    if (!seg) return [];
    const out: RoadSegment[] = [];
    for (const nid of [seg.startId, seg.endId]) {
      const node = nodes.find((n) => n.id === nid);
      if (!node) continue;
      for (const sid of node.segmentIds) {
        if (selected.has(sid)) continue;
        const other = byId.get(sid);
        if (other) out.push(other);
      }
    }
    return out;
  };

  while (estimateSlots(selectedList(), nodes) < needSlots) {
    const frontier: RoadSegment[] = [];
    for (const id of selected) frontier.push(...neighborsOf(id));
    if (!frontier.length) {
      const leftover = publicSegs.find((s) => !selected.has(s.id));
      if (!leftover) break;
      selected.add(leftover.id);
      continue;
    }
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const s of selectedList()) {
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
      const mid = samplePolyline(s.points, 0.5);
      let d = (mid.x - cx) * (mid.x - cx) + (mid.y - cy) * (mid.y - cy);
      if (grid) {
        const cost = meanRoadCost(grid, sampleSegmentCenterline(s));
        d = d * 0.25 + (Number.isFinite(cost.mean) ? cost.mean : 8) * 40 + cost.reject * 12;
      }
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    selected.add(best.id);
  }
  return selectedList();
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
  const { ew, ns } = gridDims(count);
  const rows: ReturnType<RoadBuilder["node"]>[][] = [];
  for (let r = 0; r < ew; r++) {
    const y = oy + 12 + r * blockD + rng.range(-0.3, 0.3);
    const row = [];
    for (let c = 0; c <= ns; c++) {
      row.push(b.node(ox + 2 + c * blockW, y, r * 0.02));
    }
    for (let c = 0; c < ns; c++) {
      b.segment(row[c]!, row[c + 1]!, linePoints(pt(row[c]!), pt(row[c + 1]!)), {
        roadClass: r === 0 ? "rural" : "residential",
      });
    }
    rows.push(row);
  }
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


function pickSkeleton(
  grid: SurfaceGrid,
  topology: TopologyFamily,
  count: number,
  originX: number,
  originY: number,
  seed: number,
  campaign: CampaignLevelDef | undefined,
): { builder: RoadBuilder; originX: number; originY: number } {
  const shifts: { dx: number; dy: number }[] = [];
  for (const dy of [0, -1, 1, -2, 2]) {
    for (const dx of [0, -1, 1, -2, 2]) shifts.push({ dx, dy });
  }
  let best: { builder: RoadBuilder; originX: number; originY: number; reject: number; mean: number } | undefined;
  for (const shift of shifts) {
    const ox = originX + shift.dx;
    const oy = originY + shift.dy;
    const b = new RoadBuilder();
    buildSkeleton(b, topology, count, ox, oy, new Rng(seed), campaign);
    b.normalizeJunctions();
    const samples: { x: number; y: number }[] = [];
    for (const seg of b.segments) {
      if (seg.roadClass === "driveway" || seg.roadClass === "ramp") continue;
      samples.push(...sampleSegmentCenterline(seg));
    }
    const score = meanRoadCost(grid, samples);
    if (
      !best ||
      score.reject < best.reject ||
      (score.reject === best.reject && score.mean < best.mean)
    ) {
      best = { builder: b, originX: ox, originY: oy, reject: score.reject, mean: score.mean };
    }
    if (score.reject === 0 && estimateSlots(b.segments, b.nodes) >= count * 1.5) break;
  }
  return best ?? { builder: new RoadBuilder(), originX, originY };
}

function buildSkeleton(
  b: RoadBuilder,
  topology: TopologyFamily,
  count: number,
  ox: number,
  oy: number,
  rng: Rng,
  campaign?: CampaignLevelDef,
): RoadSegment[] {
  const pairPitch = 14.2 * 2 + 9.5;
  const collectors = Math.max(2, Math.ceil(count / 14));
  const slotsPerSide = Math.ceil(count / (collectors * 2)) + 4;
  const spineLen = Math.max(80, slotsPerSide * 12.8 + 18);
  const branch = Math.max(pairPitch * 0.6, 20 + count * 0.14);

  if (count >= 8) {
    buildBlockGrid(b, campaign?.composition ? count + 8 : count, ox, oy, rng, campaign?.generation.parcel.blockW, campaign?.generation.parcel.blockD);
    addTopologyFlavor(b, topology, ox, oy, rng);
    return b.segments.filter((s) => s.roadClass !== "driveway");
  }

  if (topology === "county") {
    const spines: RoadSegment[] = [];
    for (let r = 0; r < collectors; r++) {
      const y = oy + 16 + r * pairPitch + rng.range(-1.0, 1.0);
      const elev = r * 0.08;
      const a = b.node(ox, y, elev);
      const m = b.node(ox + spineLen * 0.5, y + rng.range(-1.6, 1.6), elev + 0.1);
      const c = b.node(ox + spineLen, y + rng.range(-1.0, 1.0), elev + 0.2);
      b.segment(a, m, linePoints(pt(a), pt(m)), { roadClass: "rural" });
      spines.push(b.segment(m, c, linePoints(pt(m), pt(c)), { roadClass: "rural" }));
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
  } else if (topology === "crossroads") {
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
  } else if (topology === "tjunction") {
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
  } else if (topology === "curve-farm") {
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
  } else if (topology === "loop") {
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
  } else {
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
  if (count >= 24) {
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
  return b.segments.filter((s) => s.roadClass !== "driveway");
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
  const ids = ["stop-sign", "power-pole", "fire-hydrant", "guardrail", "traffic-barrel", "billboard", "light"];
  let placed = 0;
  const cap = Math.min(count + 8, 4 + Math.floor(count * 0.35));
  for (const seg of network.segments) {
    if (seg.roadClass === "driveway") continue;
    const path = Math.max(8, polylineLength(seg.points));
    const n = path > 30 ? 2 : 1;
    for (let i = 0; i < n && placed < cap; i++) {
      const t = 0.18 + i * 0.38 + rng.range(0, 0.08);
      const p = samplePolyline(seg.points, Math.min(0.86, t));
      const side = i % 2 === 0 ? 1 : -1;
      const pos = offsetPoint(p.x, p.y, p.heading, (seg.width * 0.5 + 0.55) * side);
      const id = rng.pick(ids);
      const asset = spawnAsset(id, pos.x - 0.15, pos.y - 0.15, p.heading + (side > 0 ? 0 : Math.PI), rng.int(0, 2));
      if (occ.some((box) => aabbOverlap(asset.x, asset.y, asset.w, asset.d, box.x, box.y, box.w, box.d))) continue;
      if (corridors.some((poly) => pointNearPoly(asset.x + asset.w * 0.5, asset.y + asset.d * 0.5, poly))) continue;
      props.push(asset);
      occ.push({ x: asset.x, y: asset.y, w: asset.w, d: asset.d });
      placed++;
    }
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
  const tries = [0.2, 0.35, 0.5, 0.65, 0.8];
  const candidates: { x: number; y: number; heading: number }[] = [];
  for (const seg of pool) {
    for (const t of tries) {
      const p = samplePolyline(seg.points, t);
      if (avoid && len(p.x - avoid.x, p.y - avoid.y) < 6) continue;
      if (grid && traversalAt(grid, p.x, p.y) !== "open") continue;
      if (clear(buildings, props, p.x, p.y)) candidates.push(p);
    }
  }
  if (prefer && candidates.length) {
    candidates.sort((a, b) => len(a.x - prefer.x, a.y - prefer.y) - len(b.x - prefer.x, b.y - prefer.y));
  }
  const chosen = candidates[Math.min(pick, Math.max(0, candidates.length - 1))];
  if (chosen) return chosen;
  if (grid) {
    for (const seg of pool) {
      for (let t = 0.05; t <= 0.95; t += 0.05) {
        const p = samplePolyline(seg.points, t);
        if (avoid && len(p.x - avoid.x, p.y - avoid.y) < 6) continue;
        if (traversalAt(grid, p.x, p.y) !== "open") continue;
        if (clear(buildings, props, p.x, p.y)) return p;
      }
    }
  }
  const fallback = samplePolyline(pool[0]!.points, 0.4);
  return { x: fallback.x, y: fallback.y, heading: fallback.heading };
}

function clear(buildings: Building[], props: Prop[], x: number, y: number): boolean {
  const rad = 1.4;
  for (const b of buildings) {
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, b.x, b.y, b.w * b.cellSize, b.d * b.cellSize)) return false;
  }
  for (const p of props) {
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

function placeCampaignLot(
  campaign: CampaignLevelDef | undefined,
  lot: Lot,
  rng: Rng,
  buildings: Building[],
  kept: Lot[],
  corridors: { x: number; y: number }[][],
  publicSegs: () => RoadSegment[],
  b: RoadBuilder,
  used: Map<string, number>,
  pick: ((lot: Lot, rng: Rng, tried: ReadonlySet<string>) => Archetype | undefined) | undefined,
  assignedId: string | undefined,
  neighbors: Lot[],
  rejected: NhoodReject[],
  targetCount: number,
  surface: SurfaceGrid,
): boolean {
  lot.zone = zoneForIndex(kept.length, targetCount, lot.frontage.segmentId, b.segments);
  if (lot.boundary.length >= 3 && kept.some((k) => k.boundary.length >= 3 && convexOverlap(lot.boundary, k.boundary))) {
    rejected.push({ kind: "lot", reason: "overlap", points: lot.boundary });
    return false;
  }
  if (campaign && assignedId) {
    const assigned = archetypeById(assignedId);
    const size = archetypeFootprint(assigned);
    if (lot.buildable.w + 0.08 < size.w || lot.buildable.d + 0.08 < size.d) {
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
      const evicted = expandLotToFit(lot, size.w, size.d, publicSegs(), [...neighbors, ...kept], surface);
      const hitsKept = !!evicted?.some(id => kept.some(entry => entry.id === id));
      if (!evicted || hitsKept) {
        lot.frontage = snapshot.frontage;
        lot.boundary = snapshot.boundary;
        lot.buildable = snapshot.buildable;
        lot.x = snapshot.x;
        lot.y = snapshot.y;
        lot.w = snapshot.w;
        lot.d = snapshot.d;
        lot.heading = snapshot.heading;
      } else {
        for (const id of evicted) {
          const index = neighbors.findIndex(entry => entry.id === id);
          if (index >= 0) neighbors.splice(index, 1);
        }
      }
    }
  }
  const ordinaryTarget = campaign ? campaign.generation.buildingCount - 1 : 0;
  const picker = campaign && assignedId ? assignedPicker(campaign, used, assignedId, ordinaryTarget) : pick;
  const building = placeBuildingInLot(lot, rng, buildings, publicSegs(), corridors, picker);
  if (!building) {
    rejected.push({ kind: "building", reason: assignedId ? `no-fit:${assignedId}` : "no-fit", points: lot.boundary });
    return false;
  }
  if (lotEnvelopeRejected(surface, lot)) {
    rejected.push({ kind: "lot", reason: "terrain", points: lot.boundary });
    return false;
  }
  lot.identity = identityFromBuilding(building);
  lot.templateId = "";
  const drive = attachDriveway(b, lot, building, [...kept, ...neighbors]);
  if (!drive || drive.reject) {
    rejected.push(drive?.reject ?? { kind: "driveway", reason: "failed", points: lot.boundary });
    return false;
  }
  buildings.push(building);
  kept.push(lot);
  corridors.push(drive.corridor);
  used.set(building.archetypeId, (used.get(building.archetypeId) ?? 0) + 1);
  return true;
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

function placeCampaignLandmark(
  campaign: CampaignLevelDef,
  pool: Lot[],
  rng: Rng,
  buildings: Building[],
  kept: Lot[],
  corridors: { x: number; y: number }[][],
  publicSegs: () => RoadSegment[],
  b: RoadBuilder,
  used: Map<string, number>,
  surface: SurfaceGrid,
): void {
  const landmark = archetypeById(campaign.landmark.buildingId);
  const size = archetypeFootprint(landmark);
  const civicRank = (lot: Lot) => {
    const role = lot.districtRole;
    if (role === 'downtown-core' || role === 'borough-center' || role === 'civic-center' || role === 'village-main-street') return 3;
    if (role === 'transition-ring' || role === 'mixed-use-corridor' || role === 'commercial-corridor') return 2;
    return 1;
  };
  const ranked = [...pool]
    .filter(lot => !lot.openSpaceName)
    .sort((a, c) => civicRank(c) - civicRank(a) || c.w * c.d - a.w * a.d || (c.x + c.w * 0.5) - (a.x + a.w * 0.5));
  const pickLandmark = (_lot: Lot, _rng: Rng, tried: ReadonlySet<string>) => tried.has(landmark.id) ? undefined : landmark;
  for (const lot of ranked) {
    lot.zone = 'commercial';
    lot.identity = 'shop';
    if (lotEnvelopeRejected(surface, lot)) continue;
    const needGrow = lot.buildable.w + 0.08 < size.w || lot.buildable.d + 0.08 < size.d;
    if (needGrow) {
      const evicted = expandLotToFit(lot, size.w, size.d, publicSegs(), pool, surface);
      if (!evicted) continue;
      for (let i = pool.length - 1; i >= 0; i--) {
        if (evicted.includes(pool[i]!.id)) pool.splice(i, 1);
      }
    }
    const building = placeBuildingInLot(lot, rng, buildings, publicSegs(), corridors, pickLandmark);
    if (!building) continue;
    lot.identity = identityFromBuilding(building);
    lot.templateId = "";
    const drive = attachDriveway(b, lot, building, [...kept, ...pool]);
    if (!drive || drive.reject) continue;
    building.campaignLandmark = true;
    building.name = campaign.landmark.label.toUpperCase();
    buildings.push(building);
    kept.push(lot);
    corridors.push(drive.corridor);
    used.set(building.archetypeId, 1);
    return;
  }
}

function nudgeBuildingsOffStreets(buildings: Building[], lots: readonly Lot[], network: RoadNetwork): void {
  const byId = new Map(lots.map(lot => [lot.id, lot]));
  const dirs = (heading: number): readonly [number, number][] => {
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    return [
      [fx, fy],
      [-fy, fx],
      [fy, -fx],
      [-fx, -fy],
    ];
  };
  for (const building of buildings) {
    const lot = byId.get(building.lotId ?? '');
    if (!lot) continue;
    const footprint0 = { x: building.x, y: building.y, w: building.w * building.cellSize, d: building.d * building.cellSize };
    if (![footprint0, ...building.decorBoxes].some(box => aabbOverlapsRoad(network, box.x, box.y, box.w, box.d))) {
      continue;
    }
    let cleared = false;
    for (const [dx, dy] of dirs(lot.heading)) {
      if (cleared) break;
      const originX = building.x;
      const originY = building.y;
      const originDecor = building.decorBoxes.map(box => ({ ...box }));
      for (let step = 0; step < 10; step++) {
        const next = {
          x: building.x + dx * 0.28,
          y: building.y + dy * 0.28,
          w: footprint0.w,
          d: footprint0.d,
        };
        if (!aabbContained(next, lot.buildable)) break;
        building.x = next.x;
        building.y = next.y;
        for (const box of building.decorBoxes) {
          box.x += dx * 0.28;
          box.y += dy * 0.28;
        }
        const occupy = [
          { x: building.x, y: building.y, w: footprint0.w, d: footprint0.d },
          ...building.decorBoxes,
        ];
        if (!occupy.some(box => aabbOverlapsRoad(network, box.x, box.y, box.w, box.d))) {
          cleared = true;
          break;
        }
      }
      if (!cleared) {
        building.x = originX;
        building.y = originY;
        for (let i = 0; i < building.decorBoxes.length; i++) {
          building.decorBoxes[i] = originDecor[i]!;
        }
      }
    }
  }
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
