import { clamp } from '../game/math';
import type { CampaignLevelDef } from '../game/campaign';
import { createBuildingFromArchetype } from '../structure/building';
import type { Building, GroundPatch, Lot, Prop } from '../structure/types';
import { BUILDING_SITES, instantiateBuildingSite } from './buildingSites';
import { getAsset } from './catalog';
import { campaignEligible } from './campaignPlacement';
import { attachDriveway, completeLot } from './parcels';
import {
  derivedRoadBoxes,
  emptyTerrain,
  linePoints,
  projectPointToPolyline,
  pt,
  RoadBuilder,
  samplePolyline,
} from './roads';
import { defaultBiome } from './biomes';
import { DRESSING } from '../game/constants';
import { enforceOpenCorridors, finalizeStampedSurface, generateSurfaceGrid, stampDeveloped } from './terrain';
import { deriveTerrainFeatures } from './terrainFeatures';
import type { RuralLayout } from './rural';
import { generateRuralLayout } from './rural';

export function generateCampaignLayout(level: CampaignLevelDef, seed: number): RuralLayout {
  if (level.generation.topology === 'estate') return generateEstateLayout(level, seed);
  return generateRuralLayout('d30', seed, level.generation.topology, level);
}

function generateEstateLayout(level: CampaignLevelDef, seed: number): RuralLayout {
  const site = BUILDING_SITES.find(entry => entry.id === 'governors-estate');
  if (!site) throw new Error('Missing governors-estate site package');
  const originX = 8;
  const originY = 8;
  const placed = instantiateBuildingSite(site, originX + 6, originY + 8);
  const mansion = placed.buildings.find(building => building.archetypeId === 'governors-mansion');
  if (mansion) {
    mansion.campaignLandmark = true;
    mansion.name = level.landmark.label.toUpperCase();
  }

  const b = new RoadBuilder();
  const left = originX;
  const top = originY;
  const right = originX + site.w + 10;
  const bottom = originY + site.d + 10;
  const nw = b.node(left, top, 0);
  const ne = b.node(right, top, 0);
  const se = b.node(right, bottom, 0);
  const sw = b.node(left, bottom, 0);
  const midN = b.node((left + right) * 0.5, top, 0);
  const midS = b.node((left + right) * 0.5, bottom, 0);
  const midW = b.node(left, (top + bottom) * 0.5, 0);
  const midE = b.node(right, (top + bottom) * 0.5, 0);
  b.segment(nw, midN, linePoints(pt(nw), pt(midN)), { roadClass: 'rural' });
  b.segment(midN, ne, linePoints(pt(midN), pt(ne)), { roadClass: 'rural' });
  b.segment(ne, midE, linePoints(pt(ne), pt(midE)), { roadClass: 'residential' });
  b.segment(midE, se, linePoints(pt(midE), pt(se)), { roadClass: 'residential' });
  b.segment(se, midS, linePoints(pt(se), pt(midS)), { roadClass: 'rural' });
  b.segment(midS, sw, linePoints(pt(midS), pt(sw)), { roadClass: 'rural' });
  b.segment(sw, midW, linePoints(pt(sw), pt(midW)), { roadClass: 'residential' });
  b.segment(midW, nw, linePoints(pt(midW), pt(nw)), { roadClass: 'residential' });
  const approach = b.node((left + right) * 0.5, bottom + 16, 0);
  b.segment(midS, approach, linePoints(pt(midS), pt(approach)), { roadClass: 'rural' });
  b.normalizeJunctions();
  const biome = defaultBiome();
  const surface = generateSurfaceGrid({
    seed,
    biome,
    minX: left - 4,
    minY: top - 4,
    maxX: right + 8,
    maxY: bottom + 20,
    spawnBand: { x: (left + right) * 0.5 - 4, y: bottom + 8, w: 8, d: 10 },
  });

  const buildings: Building[] = [];
  const props: Prop[] = placed.props.filter(prop => campaignEligible(getAsset(prop.assetId).campaign, level.id));
  const lots: Lot[] = [];
  for (const building of placed.buildings) {
    const lot = estateLotFor(building, lots.length);
    if (!attachEstateAccess(b, lot, building, lots)) {
      if (!building.campaignLandmark) continue;
    }
    building.lotId = lot.id;
    buildings.push(building);
    lots.push(lot);
  }

  const extraIds = ['colonial', 'detached-garage', 'pump-house', 'colonial', 'detached-garage', 'pump-house', 'colonial'];
  const extraSlots = [
    { x: left + 6, y: bottom + 5 },
    { x: left + 18, y: bottom + 5 },
    { x: left + 30, y: bottom + 5 },
    { x: left + 48, y: bottom + 5 },
    { x: left + 62, y: bottom + 5 },
    { x: right + 5, y: top + 16 },
    { x: right + 5, y: top + 32 },
  ];
  for (let i = 0; i < extraIds.length && buildings.length < level.generation.buildingCount; i++) {
    const slot = extraSlots[i]!;
    const building = createBuildingFromArchetype(extraIds[i]!, extraIds[i]!.toUpperCase(), slot.x, slot.y);
    if (buildings.some(other =>
      building.x < other.x + other.w * other.cellSize + 1.2 &&
      building.x + building.w * building.cellSize + 1.2 > other.x &&
      building.y < other.y + other.d * other.cellSize + 1.2 &&
      building.y + building.d * building.cellSize + 1.2 > other.y)) {
      continue;
    }
    const lot = estateLotFor(building, lots.length);
    if (!attachEstateAccess(b, lot, building, lots)) continue;
    building.lotId = lot.id;
    buildings.push(building);
    lots.push(lot);
  }

  const network = b.finish({ normalize: false });
  for (const lot of lots) {
    const acc = network.accesses.find(access => access.id === lot.accessId || access.lotId === lot.id);
    if (acc) {
      lot.accessId = acc.id;
      lot.frontage.segmentId = acc.segmentId;
    }
  }

  let minX = left - 4;
  let minY = top - 4;
  let maxX = right + 4;
  let maxY = bottom + 20;
  for (const building of buildings) {
    minX = Math.min(minX, building.x - 1);
    minY = Math.min(minY, building.y - 1);
    maxX = Math.max(maxX, building.x + building.w * building.cellSize + 1);
    maxY = Math.max(maxY, building.y + building.d * building.cellSize + 1);
  }

  const ground: GroundPatch[] = [];
  enforceOpenCorridors(surface, network, lots, buildings);
  stampDeveloped(surface, network, lots, ground);
  finalizeStampedSurface(surface, biome, seed, { network, lots, buildings });
  const spawn = samplePolyline(network.segments.find(seg => seg.roadClass === 'rural')?.points ?? network.segments[0]!.points, 0.2);
  const features = deriveTerrainFeatures({
    biome,
    seed,
    minX,
    minY,
    maxX,
    maxY,
    network,
    lots,
    buildings,
    props,
    ground,
    spawnX: spawn.x,
    spawnY: spawn.y,
    roadSpawnX: spawn.x,
    roadSpawnY: spawn.y,
    propBudget: level.generation.dressingBudget ?? DRESSING.districtMax.d30,
    surface,
  });

  return {
    buildings,
    props,
    lots,
    ground,
    network,
    terrain: emptyTerrain(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4),
    roads: derivedRoadBoxes(network),
    spawnX: spawn.x,
    spawnY: spawn.y,
    spawnHeading: spawn.heading,
    roadSpawnX: spawn.x,
    roadSpawnY: spawn.y,
    roadSpawnHeading: spawn.heading,
    minX,
    minY,
    maxX,
    maxY,
    district: 'd30',
    seed,
    topology: 'loop',
    biome,
    surface,
    features,
    campaignLevel: level.id,
    diagnostic: { ok: !!mansion, issues: mansion ? [] : [{ code: 'landmark', detail: 'estate missing mansion' }] },
    nhood: {
      rejected: [],
      urban: {
        center: { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 },
        extent: Math.max(8, maxX - minX, maxY - minY),
        lots: lots.map(lot => ({
          lotId: lot.id,
          districtRole: 'estate' as const,
          urbanBand: 'estate' as const,
          distToCenter: 0,
          radius: 0,
          corner: false,
          roadClass: 'residential',
        })),
        openSpaces: [],
        blocks: [],
        byRole: { estate: lots.length },
        byBand: { estate: lots.length },
      },
    },
    urban: {
      center: { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 },
      extent: Math.max(8, maxX - minX, maxY - minY),
      lots: lots.map(lot => ({
        lotId: lot.id,
        districtRole: 'estate' as const,
        urbanBand: 'estate' as const,
        distToCenter: 0,
        radius: 0,
        corner: false,
        roadClass: 'residential',
      })),
      openSpaces: [],
      blocks: [],
      byRole: { estate: lots.length },
      byBand: { estate: lots.length },
    },
  };
}

function estateLotFor(building: Building, index: number): Lot {
  const boxes = [
    { x: building.x, y: building.y, w: building.w * building.cellSize, d: building.d * building.cellSize },
    ...building.decorBoxes,
  ];
  const minX = Math.min(...boxes.map(box => box.x));
  const minY = Math.min(...boxes.map(box => box.y));
  const maxX = Math.max(...boxes.map(box => box.x + box.w));
  const maxY = Math.max(...boxes.map(box => box.y + box.d));
  const setbacks = { front: 1.6, side: 1.2, rear: 1.6 };
  return completeLot({
    id: `estate-${index}`,
    x: minX - setbacks.side,
    y: minY - setbacks.front,
    w: maxX - minX + setbacks.side * 2,
    d: maxY - minY + setbacks.front + setbacks.rear,
    heading: Math.PI / 2,
    zone: building.archetypeId === 'governors-mansion' ? 'commercial' : building.kind === 'house' ? 'residential' : 'commercial',
    identity: building.archetypeId === 'governors-mansion' ? 'shop' : 'service',
    accessId: '',
    templateId: '',
    urbanBand: 'estate',
    districtRole: 'estate',
    setbacks,
    buildable: { x: minX, y: minY, w: maxX - minX, d: maxY - minY },
  });
}

function attachEstateAccess(b: RoadBuilder, lot: Lot, building: Building, others: Lot[]): boolean {
  const cx = building.x + building.w * building.cellSize * 0.5;
  const cy = building.y + building.d * building.cellSize * 0.5;
  const ranked = b.segments
    .filter(seg => seg.roadClass !== 'driveway' && seg.roadClass !== 'ramp')
    .map(seg => {
      const hit = projectPointToPolyline(seg.points, cx, cy);
      return { seg, hit, dist: Math.hypot(hit.x - cx, hit.y - cy) };
    })
    .sort((a, c) => a.dist - c.dist);
  for (const candidate of ranked.slice(0, 5)) {
    const live = b.segments.find(seg => seg.id === candidate.seg.id) ?? candidate.seg;
    const t = clamp(candidate.hit.t, 0.08, 0.92);
    lot.frontage = { segmentId: live.id, side: 1, t0: clamp(t - 0.05, 0, 1), t1: clamp(t + 0.05, 0, 1) };
    const curb = samplePolyline(live.points, t);
    lot.heading = Math.atan2(cy - curb.y, cx - curb.x);
    const drive = attachDriveway(b, lot, building, others);
    if (drive && !drive.reject) return true;
  }
  return false;
}
