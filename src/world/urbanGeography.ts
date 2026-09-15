import type { CampaignLevelDef, CampaignLevelId } from '../game/campaign';
import type { Building, Lot } from '../structure/types';
import type { Archetype } from './archetypes';
import {
  CITY_DENSE_BANDS,
  LOW_RISE_PROHIBITED_BANDS,
  ROLE_BANDS,
  RURAL_SUBURBAN_BANDS,
  type DistrictRole,
  type UrbanBand,
} from './urbanBands';
import { polylineLength, type RoadNode, type RoadSegment } from './roads';

export interface UrbanLotInfo {
  lotId: string;
  districtRole: DistrictRole;
  urbanBand: UrbanBand;
  distToCenter: number;
  radius: number;
  corner: boolean;
  roadClass: string;
  openSpace?: UrbanOpenSpace['kind'];
}

export interface UrbanOpenSpace {
  id: string;
  kind: 'plaza' | 'park' | 'civic-square';
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  band: UrbanBand;
}

export interface UrbanBlockInfo {
  id: string;
  x: number;
  y: number;
  w: number;
  d: number;
  lotIds: string[];
  coverage: number;
  role: DistrictRole;
  reserved: boolean;
}

export interface UrbanGeographyReport {
  center: { x: number; y: number };
  extent: number;
  lots: UrbanLotInfo[];
  openSpaces: UrbanOpenSpace[];
  blocks: UrbanBlockInfo[];
  byRole: Record<string, number>;
  byBand: Record<string, number>;
}

export interface UrbanFabricThresholds {
  exactBuildings: number;
  coreMinFourPlus: number;
  coreMinTall: number;
  coreMaxTowers: number;
  coreNoOneStory: boolean;
  minFrontageFill: number;
  minLotCoverage: number;
  minCoreFourPlusShare: number;
}

export const URBAN_FABRIC_THRESHOLDS: Record<'city-borough' | 'city-downtown', UrbanFabricThresholds> = {
  'city-borough': {
    exactBuildings: 32,
    coreMinFourPlus: 2,
    coreMinTall: 1,
    coreMaxTowers: 0,
    coreNoOneStory: true,
    minFrontageFill: 0.4,
    minLotCoverage: 0.18,
    minCoreFourPlusShare: 0.4,
  },
  'city-downtown': {
    exactBuildings: 36,
    coreMinFourPlus: 4,
    coreMinTall: 3,
    coreMaxTowers: 14,
    coreNoOneStory: true,
    minFrontageFill: 0.4,
    minLotCoverage: 0.2,
    minCoreFourPlusShare: 0.6,
  },
};

const OPEN_SPACE_NAMES: Record<UrbanOpenSpace['kind'], readonly string[]> = {
  plaza: ['Market Plaza', 'Station Plaza', 'Founders Plaza'],
  park: ['Borough Green', 'Elm Park', 'Canal Park'],
  'civic-square': ['Civic Square', 'Hall Square', 'Courthouse Square'],
};

export function lotCenter(lot: Pick<Lot, 'x' | 'y' | 'w' | 'd'>): { x: number; y: number } {
  return { x: lot.x + lot.w * 0.5, y: lot.y + lot.d * 0.5 };
}

export function clusterCenter(lots: readonly Pick<Lot, 'x' | 'y' | 'w' | 'd'>[]): { x: number; y: number } {
  if (!lots.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const lot of lots) {
    const c = lotCenter(lot);
    x += c.x;
    y += c.y;
  }
  return { x: x / lots.length, y: y / lots.length };
}

export function isCornerFrontage(
  lot: Pick<Lot, 'frontage'>,
  nodes: readonly RoadNode[],
  segments: readonly RoadSegment[],
): boolean {
  const seg = segments.find(entry => entry.id === lot.frontage.segmentId);
  if (!seg) return false;
  const publicIds = new Set(segments.filter(entry => entry.roadClass !== 'driveway' && entry.roadClass !== 'ramp').map(entry => entry.id));
  const degree = (id: string) => nodes.find(node => node.id === id)?.segmentIds.filter(sid => publicIds.has(sid)).length ?? 1;
  if (lot.frontage.t0 <= 0.14 && degree(seg.startId) >= 3) return true;
  if (lot.frontage.t1 >= 0.86 && degree(seg.endId) >= 3) return true;
  return false;
}

function clusterValues(values: readonly number[], gap = 3.2): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || value - last > gap) out.push(value);
    else out[out.length - 1] = (last + value) * 0.5;
  }
  return out;
}

export function enumerateRoadBlocks(
  nodes: readonly RoadNode[],
  minSpan = 10,
): { id: string; x: number; y: number; w: number; d: number }[] {
  const xs = clusterValues(nodes.map(node => node.x));
  const ys = clusterValues(nodes.map(node => node.y));
  const blocks: { id: string; x: number; y: number; w: number; d: number }[] = [];
  let n = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const x = xs[i]!;
      const y = ys[j]!;
      const w = xs[i + 1]! - x;
      const d = ys[j + 1]! - y;
      if (w < minSpan || d < minSpan) continue;
      blocks.push({ id: `block${n++}`, x, y, w, d });
    }
  }
  return blocks;
}

function roleForLevel(
  levelId: CampaignLevelId,
  radius: number,
  roadClass: string,
  corner: boolean,
): DistrictRole {
  if (roadClass === 'service') return 'industrial-service-edge';
  switch (levelId) {
    case 'county':
      return radius <= 0.42 ? 'rural' : 'scattered';
    case 'village':
      return radius <= 0.48 || roadClass === 'rural' ? 'village-main-street' : 'village-edge';
    case 'township':
      if (radius <= 0.28) return 'civic-center';
      if (radius <= 0.72) return 'mixed-neighborhood';
      return 'township-edge';
    case 'suburb':
      if (roadClass === 'commercial' || (roadClass === 'rural' && radius <= 0.62)) return 'commercial-corridor';
      if (radius <= 0.7) return 'suburb-neighborhood';
      return 'suburb-edge';
    case 'city-borough':
      if (roadClass === 'service' && radius > 0.55) return 'industrial-service-edge';
      if (radius <= 0.38) return 'borough-center';
      if ((roadClass === 'rural' || roadClass === 'commercial' || corner) && radius <= 0.6) return 'mixed-use-corridor';
      if (radius <= 0.84) return 'borough-neighborhood';
      return 'industrial-service-edge';
    case 'city-downtown':
      if (roadClass === 'service' && radius > 0.55) return 'industrial-service-edge';
      if (radius <= 0.38) return 'downtown-core';
      if (radius <= 0.64) return 'transition-ring';
      if (radius <= 0.86) return 'borough-edge';
      return 'industrial-service-edge';
    case 'governors-mansion':
      return 'estate';
    default: {
      const _never: never = levelId;
      return _never;
    }
  }
}

function preferredBand(role: DistrictRole): UrbanBand {
  return ROLE_BANDS[role][0]!;
}

export function classifyUrbanGeography(
  level: CampaignLevelDef,
  lots: readonly Lot[],
  segments: readonly RoadSegment[],
  nodes: readonly RoadNode[],
): UrbanGeographyReport {
  const center = clusterCenter(lots);
  const distances = lots.map(lot => {
    const c = lotCenter(lot);
    return Math.hypot(c.x - center.x, c.y - center.y);
  });
  const extent = Math.max(8, ...distances, 1);
  const infos: UrbanLotInfo[] = lots.map((lot, index) => {
    const dist = distances[index]!;
    const radius = dist / extent;
    const seg = segments.find(entry => entry.id === lot.frontage.segmentId);
    const roadClass = seg?.roadClass ?? 'residential';
    const corner = isCornerFrontage(lot, nodes, segments);
    const districtRole = roleForLevel(level.id, radius, roadClass, corner);
    return {
      lotId: lot.id,
      districtRole,
      urbanBand: preferredBand(districtRole),
      distToCenter: dist,
      radius,
      corner,
      roadClass,
    };
  });

  const blocks = enumerateRoadBlocks(nodes).map(block => {
    const inside = lots.filter(lot => {
      const c = lotCenter(lot);
      return c.x >= block.x && c.x <= block.x + block.w && c.y >= block.y && c.y <= block.y + block.d;
    });
    const covered = inside.reduce((sum, lot) => sum + lot.w * lot.d, 0);
    const area = Math.max(1, block.w * block.d);
    const midR = Math.hypot(block.x + block.w * 0.5 - center.x, block.y + block.d * 0.5 - center.y) / extent;
    return {
      ...block,
      lotIds: inside.map(lot => lot.id),
      coverage: covered / area,
      role: roleForLevel(level.id, midR, 'residential', false),
      reserved: false,
    } satisfies UrbanBlockInfo;
  });

  const byRole: Record<string, number> = {};
  const byBand: Record<string, number> = {};
  for (const info of infos) {
    byRole[info.districtRole] = (byRole[info.districtRole] ?? 0) + 1;
    byBand[info.urbanBand] = (byBand[info.urbanBand] ?? 0) + 1;
  }

  return {
    center,
    extent,
    lots: infos,
    openSpaces: [],
    blocks,
    byRole,
    byBand,
  };
}

function applyLotTags(lots: readonly Lot[], report: UrbanGeographyReport): void {
  const byId = new Map(report.lots.map(info => [info.lotId, info]));
  for (const lot of lots) {
    const info = byId.get(lot.id);
    if (!info) continue;
    lot.districtRole = info.districtRole;
    lot.urbanBand = info.urbanBand;
    lot.cornerLot = info.corner;
    if (info.openSpace) lot.openSpaceName = report.openSpaces.find(space => space.kind === info.openSpace)?.name;
  }
}

export function reserveNamedOpenSpaces(
  level: CampaignLevelDef,
  lots: Lot[],
  report: UrbanGeographyReport,
): UrbanGeographyReport {
  if (level.id !== 'city-borough' && level.id !== 'city-downtown') {
    applyLotTags(lots, report);
    return report;
  }
  const vacant = report.blocks
    .filter(block => block.lotIds.length === 0 && block.w * block.d >= 80)
    .sort((a, b) => b.w * b.d - a.w * a.d);
  const kind: UrbanOpenSpace['kind'] = level.id === 'city-downtown'
    ? (vacant[0] && (vacant[0].role === 'downtown-core' || vacant[0].role === 'transition-ring') ? 'civic-square' : 'plaza')
    : 'park';
  const names = OPEN_SPACE_NAMES[kind];
  const openSpaces: UrbanOpenSpace[] = [];
  const take = vacant.slice(0, level.id === 'city-downtown' ? 2 : 1);
  take.forEach((block, index) => {
    block.reserved = true;
    block.role = kind;
    openSpaces.push({
      id: block.id,
      kind,
      name: names[index % names.length]!,
      x: block.x,
      y: block.y,
      w: block.w,
      d: block.d,
      band: kind === 'park' ? 'borough-mixed' : 'downtown-core',
    });
  });
  const next = { ...report, openSpaces, blocks: report.blocks };
  applyLotTags(lots, next);
  return next;
}

export function applyUrbanTags(lots: readonly Lot[], report: UrbanGeographyReport): void {
  applyLotTags(lots, report);
}

export function frontageFillRatio(
  lots: readonly Lot[],
  segments: readonly RoadSegment[],
  nodes: readonly RoadNode[],
): number {
  const publicSegs = segments.filter(seg => seg.roadClass !== 'driveway' && seg.roadClass !== 'ramp');
  if (!publicSegs.length) return 0;
  const publicIds = new Set(publicSegs.map(seg => seg.id));
  let usable = 0;
  let filled = 0;
  for (const seg of publicSegs) {
    const path = polylineLength(seg.points);
    const startDeg = nodes.find(node => node.id === seg.startId)?.segmentIds.filter(id => publicIds.has(id)).length ?? 1;
    const endDeg = nodes.find(node => node.id === seg.endId)?.segmentIds.filter(id => publicIds.has(id)).length ?? 1;
    const clear = (startDeg >= 3 ? 2.4 : 1.2) + (endDeg >= 3 ? 2.4 : 1.2);
    const onSeg = lots.filter(lot => lot.frontage.segmentId === seg.id && !lot.openSpaceName);
    if (!onSeg.length) continue;
    const avail = Math.max(0, path - clear);
    if (avail < 4) continue;
    usable += avail;
    filled += onSeg.reduce((sum, lot) => sum + Math.max(0, (lot.frontage.t1 - lot.frontage.t0) * path), 0);
  }
  return usable > 0 ? Math.min(1, filled / usable) : 1;
}

export function lotCoverageRatio(buildings: readonly Building[], lots: readonly Lot[]): number {
  const developed = lots.filter(lot => !lot.openSpaceName);
  const area = developed.reduce((sum, lot) => sum + lot.w * lot.d, 0);
  if (area <= 0) return 0;
  const covered = buildings.reduce((sum, building) => sum + building.w * building.d * building.cellSize * building.cellSize, 0);
  return covered / area;
}

export interface UrbanFabricReport {
  ok: boolean;
  issues: string[];
  geography: UrbanGeographyReport;
  frontageFill: number;
  lotCoverage: number;
  coreFourPlus: number;
  coreOneStory: number;
  coreTall: number;
  coreTowers: number;
}

function floorsOf(building: Building, archetypes: readonly Archetype[]): number {
  return archetypes.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors;
}

export function evaluateUrbanFabric(
  level: CampaignLevelDef,
  buildings: readonly Building[],
  lots: readonly Lot[],
  geography: UrbanGeographyReport,
  archetypes: readonly Archetype[],
  segments: readonly RoadSegment[],
  nodes: readonly RoadNode[],
): UrbanFabricReport {
  const issues: string[] = [];
  const thresholds = level.id === 'city-borough' || level.id === 'city-downtown'
    ? URBAN_FABRIC_THRESHOLDS[level.id]
    : undefined;
  const lotById = new Map(lots.map(lot => [lot.id, lot]));
  const infoById = new Map(geography.lots.map(info => [info.lotId, info]));
  const ordinary = buildings.filter(building => !building.campaignLandmark);

  if (thresholds && buildings.length !== thresholds.exactBuildings) {
    issues.push(`${level.id}: ${buildings.length} buildings, need ${thresholds.exactBuildings}`);
  }

  const coreLots = lots.filter(lot => {
    const role = lot.districtRole ?? infoById.get(lot.id)?.districtRole;
    return role === 'downtown-core' || role === 'borough-center';
  });
  const coreBuildings = ordinary.filter(building => {
    const lot = lotById.get(building.lotId ?? '');
    const role = lot?.districtRole ?? infoById.get(building.lotId ?? '')?.districtRole;
    return role === 'downtown-core' || role === 'borough-center';
  });
  const coreFourPlus = coreBuildings.filter(building => floorsOf(building, archetypes) >= 4).length;
  const coreOneStory = coreBuildings.filter(building => floorsOf(building, archetypes) <= 1).length;
  const coreTall = coreBuildings.filter(building => floorsOf(building, archetypes) >= 8).length;
  const coreTowers = coreBuildings.filter(building => floorsOf(building, archetypes) >= 20).length;

  if (thresholds) {
    if (thresholds.coreNoOneStory && coreOneStory > 0) {
      issues.push(`${level.id}: ${coreOneStory} one-story buildings in core`);
    }
    if (coreFourPlus < thresholds.coreMinFourPlus) {
      issues.push(`${level.id}: core 4+ story count ${coreFourPlus}, need ${thresholds.coreMinFourPlus}`);
    }
    if (coreTall < thresholds.coreMinTall) {
      issues.push(`${level.id}: core 8+ story count ${coreTall}, need ${thresholds.coreMinTall}`);
    }
    if (thresholds.coreMaxTowers === 0 && coreTowers > 0) {
      issues.push(`${level.id}: ${coreTowers} towers in borough core`);
    }
    if (thresholds.coreMaxTowers > 0 && coreTowers > thresholds.coreMaxTowers) {
      issues.push(`${level.id}: ${coreTowers} core towers, cap ${thresholds.coreMaxTowers}`);
    }
    if (coreBuildings.length && coreFourPlus / coreBuildings.length < thresholds.minCoreFourPlusShare - 1e-9) {
      issues.push(`${level.id}: core 4+ share ${(coreFourPlus / coreBuildings.length * 100).toFixed(1)}%`);
    }
  }

  for (const building of ordinary) {
    const def = archetypes.find(entry => entry.id === building.archetypeId);
    const lot = lotById.get(building.lotId ?? '');
    const band = (lot?.urbanBand ?? infoById.get(building.lotId ?? '')?.urbanBand) as UrbanBand | undefined;
    const floors = floorsOf(building, archetypes);
    if (band && LOW_RISE_PROHIBITED_BANDS.includes(band) && floors <= 1 && !def?.campaign?.exception) {
      issues.push(`${level.id}: one-story ${building.archetypeId} in ${band}`);
    }
    if (band && CITY_DENSE_BANDS.includes(band)) {
      const tags = def?.campaign?.urbanBands ?? [];
      if (tags.some(tag => RURAL_SUBURBAN_BANDS.includes(tag)) && !tags.some(tag => CITY_DENSE_BANDS.includes(tag))) {
        issues.push(`${level.id}: rural/suburban ${building.archetypeId} in ${band}`);
      }
    }
    if (floors <= 1 && band === 'downtown-core') {
      issues.push(`${level.id}: one-story ${building.archetypeId} in downtown-core`);
    }
    if (band === 'downtown-core' && def?.campaign?.urbanBands?.length && !def.campaign.urbanBands.includes('downtown-core') && floors < 4) {
      issues.push(`${level.id}: ${building.archetypeId} tagged ${def.campaign.urbanBands.join(',')} but placed in ${band}`);
    }
  }

  const developed = lots.filter(lot => !lot.openSpaceName);
  const minX = Math.min(...developed.map(lot => lot.x));
  const minY = Math.min(...developed.map(lot => lot.y));
  const maxX = Math.max(...developed.map(lot => lot.x + lot.w));
  const maxY = Math.max(...developed.map(lot => lot.y + lot.d));
  const vacant = geography.blocks.filter(block =>
    !block.reserved
    && block.lotIds.length === 0
    && block.w * block.d >= 90
    && block.x >= minX - 4
    && block.y >= minY - 4
    && block.x + block.w <= maxX + 4
    && block.y + block.d <= maxY + 4,
  );
  if ((level.id === 'city-borough' || level.id === 'city-downtown') && vacant.length) {
    issues.push(`${level.id}: ${vacant.length} unclassified vacant blocks`);
  }

  const frontageFill = frontageFillRatio(lots, segments, nodes);
  const lotCoverage = lotCoverageRatio(buildings, lots);
  if (thresholds && frontageFill < thresholds.minFrontageFill) {
    issues.push(`${level.id}: frontage fill ${(frontageFill * 100).toFixed(1)}%, need ${(thresholds.minFrontageFill * 100).toFixed(0)}%`);
  }
  if (thresholds && lotCoverage < thresholds.minLotCoverage) {
    issues.push(`${level.id}: lot coverage ${(lotCoverage * 100).toFixed(1)}%, need ${(thresholds.minLotCoverage * 100).toFixed(0)}%`);
  }

  void coreLots;
  return {
    ok: issues.length === 0,
    issues,
    geography,
    frontageFill,
    lotCoverage,
    coreFourPlus,
    coreOneStory,
    coreTall,
    coreTowers,
  };
}

export function urbanDebugDump(
  level: CampaignLevelDef,
  seed: number,
  buildings: readonly Building[],
  lots: readonly Lot[],
  geography: UrbanGeographyReport,
  archetypes: readonly Archetype[],
): Record<string, unknown> {
  return {
    level: level.id,
    seed,
    buildings: buildings.length,
    byRole: geography.byRole,
    byBand: geography.byBand,
    openSpaces: geography.openSpaces.map(space => ({ name: space.name, kind: space.kind })),
    lots: geography.lots.map(info => ({
      id: info.lotId,
      role: info.districtRole,
      band: info.urbanBand,
      r: Number(info.radius.toFixed(3)),
      corner: info.corner,
    })),
    placed: buildings.map(building => ({
      id: building.archetypeId,
      floors: archetypes.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors,
      floorsClass: (() => {
        const floors = archetypes.find(entry => entry.id === building.archetypeId)?.floors ?? building.floors;
        if (floors <= 4) return 'low-rise';
        if (floors <= 12) return 'mid-rise';
        if (floors <= 19) return 'high-rise';
        return 'skyscraper';
      })(),
      lot: building.lotId,
      landmark: !!building.campaignLandmark,
      band: lots.find(lot => lot.id === building.lotId)?.urbanBand,
      role: lots.find(lot => lot.id === building.lotId)?.districtRole,
    })),
  };
}

export function bandAllowsArchetype(archetype: Archetype, band: UrbanBand | undefined): boolean {
  if (!band) return true;
  const tags = archetype.campaign?.urbanBands;
  if (!tags?.length) return false;
  return tags.includes(band);
}
