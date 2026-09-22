import type { TopologyFamily } from '../world/rural';

/** Campaign levels are the playable districts for Sandbox and Time Challenge. */
export const CAMPAIGN_LEVEL_IDS = [
  'county',
  'village',
  'township',
  'suburb',
  'city-borough',
  'city-downtown',
  'governors-mansion',
] as const;

export type CampaignLevelId = (typeof CAMPAIGN_LEVEL_IDS)[number];

export function isCampaignLevelId(value: string): value is CampaignLevelId {
  return (CAMPAIGN_LEVEL_IDS as readonly string[]).includes(value);
}

export interface CampaignLotClass {
  id: string;
  weight: number;
  minFront: number;
  maxFront: number;
  minDepth: number;
  maxDepth: number;
}

export interface CampaignParcelProfile {
  minFront: number;
  maxFront: number;
  minDepth: number;
  maxDepth: number;
  lotGap: number;
  roadGap: number;
  junctionClear: number;
  driveWidth: number;
  maxExpand: number;
  setbackFront: [number, number];
  setbackSide: [number, number];
  setbackRear: [number, number];
  blockW: number;
  blockD: number;
  lotClasses?: readonly CampaignLotClass[];
  contiguousFrontage?: boolean;
}

export interface CampaignBandRule {
  minFloors: number;
  maxFloors: number;
  minShare?: number;
  maxShare?: number;
  forbid?: boolean;
}

export interface CampaignComposition {
  minDistinctVariants: number;
  maxVariantShare: number;
  maxFamilyShare: number;
  placementAttempts: number;
  bands: readonly CampaignBandRule[];
}

export interface CampaignGenerationProfile {
  buildingCount: number;
  topology: TopologyFamily | 'estate';
  parcel: CampaignParcelProfile;
  dressingBudget: number;
  propsPerLot: number;
}

export interface CampaignLandmarkSpec {
  buildingId: string;
  label: string;
  /** Archetype IDs that count toward landmark demolition. */
  structureIds: readonly string[];
}

export interface CampaignLevelDef {
  id: CampaignLevelId;
  index: number;
  name: string;
  landmark: CampaignLandmarkSpec;
  dollarTarget: number;
  timeLimit: number;
  generation: CampaignGenerationProfile;
  composition?: CampaignComposition;
}

function parcel(
  minFront: number,
  maxFront: number,
  minDepth: number,
  maxDepth: number,
  lotGap: number,
  setbacks: { front: [number, number]; side: [number, number]; rear: [number, number] },
  block: { w: number; d: number },
  lotClasses?: readonly CampaignLotClass[],
  extras?: { contiguousFrontage?: boolean; junctionClear?: number; maxExpand?: number },
): CampaignParcelProfile {
  return {
    minFront,
    maxFront,
    minDepth,
    maxDepth,
    lotGap,
    roadGap: 0.85,
    junctionClear: extras?.junctionClear ?? 3.8,
    driveWidth: 2.05,
    maxExpand: extras?.maxExpand ?? 16,
    setbackFront: setbacks.front,
    setbackSide: setbacks.side,
    setbackRear: setbacks.rear,
    blockW: block.w,
    blockD: block.d,
    lotClasses,
    contiguousFrontage: extras?.contiguousFrontage,
  };
}

const CITY_COMPOSITION_BASE = {
  minDistinctVariants: 6,
  maxVariantShare: 0.2,
  maxFamilyShare: 0.4,
  placementAttempts: 8,
} as const;

export const CAMPAIGN_LEVELS: readonly CampaignLevelDef[] = [
  {
    id: 'county',
    index: 1,
    name: 'County',
    landmark: { buildingId: 'county-sheriff-office', label: "County Sheriff's Office", structureIds: ['county-sheriff-office'] },
    dollarTarget: 4200,
    timeLimit: 180,
    generation: {
      buildingCount: 12,
      topology: 'county',
      parcel: parcel(16, 22, 18, 24, 2.4, { front: [2.4, 3.4], side: [1.8, 2.6], rear: [2.2, 3.2] }, { w: 56, d: 50 }),
      dressingBudget: 170,
      propsPerLot: 8,
    },
  },
  {
    id: 'village',
    index: 2,
    name: 'Village',
    landmark: { buildingId: 'village-hall', label: 'Village Hall', structureIds: ['village-hall'] },
    dollarTarget: 3600,
    timeLimit: 180,
    generation: {
      buildingCount: 16,
      topology: 'loop',
      parcel: parcel(11.2, 15.5, 12.5, 16.5, 0.95, { front: [1.6, 2.2], side: [1.1, 1.6], rear: [1.4, 2.0] }, { w: 46, d: 42 }),
      dressingBudget: 220,
      propsPerLot: 8,
    },
  },
  {
    id: 'township',
    index: 3,
    name: 'Township',
    landmark: { buildingId: 'township-hall', label: 'Township Hall', structureIds: ['township-hall'] },
    dollarTarget: 4500,
    timeLimit: 195,
    generation: {
      buildingCount: 22,
      topology: 'crossroads',
      parcel: parcel(10, 13.5, 11.5, 15, 0.85, { front: [1.3, 1.8], side: [0.85, 1.2], rear: [1.1, 1.6] }, { w: 42, d: 38 }),
      dressingBudget: 300,
      propsPerLot: 8,
    },
  },
  {
    id: 'suburb',
    index: 4,
    name: 'Suburb',
    landmark: { buildingId: 'district-police-station', label: 'District Police Station', structureIds: ['district-police-station'] },
    dollarTarget: 4800,
    timeLimit: 210,
    generation: {
      buildingCount: 28,
      topology: 'frontage',
      parcel: parcel(8.6, 11.4, 10.2, 13.2, 0.45, { front: [1.0, 1.4], side: [0.55, 0.85], rear: [0.85, 1.2] }, { w: 38, d: 34 }),
      dressingBudget: 380,
      propsPerLot: 7,
    },
  },
  {
    id: 'city-borough',
    index: 5,
    name: 'City Borough',
    landmark: { buildingId: 'police-headquarters', label: 'Police Headquarters', structureIds: ['police-headquarters'] },
    dollarTarget: 12500,
    timeLimit: 225,
    generation: {
      buildingCount: 32,
      topology: 'tjunction',
      parcel: parcel(8.2, 14.2, 9.6, 14.6, 0.18, { front: [0.7, 1.05], side: [0.35, 0.6], rear: [0.6, 0.95] }, { w: 38, d: 34 }, [
        { id: 'compact', weight: 5, minFront: 8.4, maxFront: 10.0, minDepth: 10.4, maxDepth: 12.0 },
        { id: 'standard', weight: 5, minFront: 10.0, maxFront: 12.2, minDepth: 11.2, maxDepth: 13.2 },
        { id: 'tower', weight: 2, minFront: 12.2, maxFront: 14.4, minDepth: 12.6, maxDepth: 14.8 },
      ], { contiguousFrontage: true, junctionClear: 2.8, maxExpand: 12 }),
      dressingBudget: 480,
      propsPerLot: 7,
    },
    composition: {
      ...CITY_COMPOSITION_BASE,
      bands: [
        { minFloors: 2, maxFloors: 8, minShare: 0.65 },
        { minFloors: 5, maxFloors: 12, minShare: 0.45 },
        { minFloors: 20, maxFloors: 64, forbid: true },
      ],
    },
  },
  {
    id: 'city-downtown',
    index: 6,
    name: 'City Downtown',
    landmark: { buildingId: 'city-hall', label: 'City Hall', structureIds: ['city-hall'] },
    dollarTarget: 9500,
    timeLimit: 240,
    generation: {
      buildingCount: 36,
      topology: 'crossroads',
      parcel: parcel(8.4, 14.6, 9.4, 14.8, 0.16, { front: [0.45, 0.75], side: [0.22, 0.42], rear: [0.4, 0.7] }, { w: 40, d: 36 }, [
        { id: 'compact', weight: 3, minFront: 8.6, maxFront: 10.2, minDepth: 10.2, maxDepth: 11.8 },
        { id: 'standard', weight: 3, minFront: 10.2, maxFront: 12.0, minDepth: 11.0, maxDepth: 13.0 },
        { id: 'tower', weight: 5, minFront: 12.4, maxFront: 14.8, minDepth: 12.8, maxDepth: 15.0 },
      ], { contiguousFrontage: true, junctionClear: 2.6, maxExpand: 12 }),
      dressingBudget: 620,
      propsPerLot: 6,
    },
    composition: {
      ...CITY_COMPOSITION_BASE,
      bands: [
        { minFloors: 4, maxFloors: 64, minShare: 0.7 },
        { minFloors: 20, maxFloors: 64, minShare: 0.22, maxShare: 0.45 },
      ],
    },
  },
  {
    id: 'governors-mansion',
    index: 7,
    name: "Governor's Mansion",
    landmark: { buildingId: 'governors-mansion', label: "Governor's Mansion", structureIds: ['governors-mansion'] },
    dollarTarget: 5600,
    timeLimit: 240,
    generation: {
      buildingCount: 14,
      topology: 'estate',
      parcel: parcel(14, 20, 16, 22, 1.6, { front: [2.0, 2.8], side: [1.6, 2.4], rear: [2.0, 2.8] }, { w: 52, d: 48 }),
      dressingBudget: 240,
      propsPerLot: 7,
    },
  },
];

export function campaignLevelById(id: CampaignLevelId): CampaignLevelDef {
  const found = CAMPAIGN_LEVELS.find(level => level.id === id);
  if (!found) throw new Error(`Unknown campaign level ${id}`);
  return found;
}

export function campaignLevelAt(index: number): CampaignLevelDef {
  const found = CAMPAIGN_LEVELS[index];
  if (!found) throw new Error(`Campaign level index ${index} is out of range`);
  return found;
}

export const CAMPAIGN_LEVEL_COUNT = CAMPAIGN_LEVELS.length;

/** Open crop sheets belong on rural levels. Urban and estate districts keep lot yards instead. */
export function campaignPaintsOpenFields(id: CampaignLevelId): boolean {
  switch (id) {
    case "county":
    case "village":
    case "township":
      return true;
    case "suburb":
    case "city-borough":
    case "city-downtown":
    case "governors-mansion":
      return false;
    default: {
      const _never: never = id;
      return _never;
    }
  }
}
