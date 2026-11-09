import type { CampaignLevelId } from '../game/campaign';
import type { BiomeId } from './biomes';
import type { RegionFlavorId } from './regions';
import type { RegionalPlacement } from './regionalPlacement';

/**
 * Regional flavor biases which already-eligible buildings a county draws.
 * It never adds a building to a level: a boost on an ID the level does not list does nothing,
 * so `campaign.levels` stays the opt-in gate described in docs/campaign.md.
 */
export interface SignatureSpec {
  buildingId: string;
  label: string;
}

export interface RegionalFlavor {
  id: RegionFlavorId;
  label: string;
  biome: BiomeId;
  /** Multiplier on the building's campaign weight. Missing means 1. */
  boosts: Readonly<Record<string, number>>;
  /** Tagged in preference order when the county places one. */
  signatures: readonly SignatureSpec[];
}

export const REGIONAL_FLAVORS: Readonly<Record<RegionFlavorId, RegionalFlavor>> = {
  'grain-belt': {
    id: 'grain-belt', label: 'Grain Belt', biome: 'agricultural-plain',
    boosts: { 'grain-elevator': 6, 'feed-store': 3, 'gable-barn': 2, 'farm-equipment-shed': 2, 'dairy-building': 2, 'hardware-store': 1.5 },
    signatures: [{ buildingId: 'grain-elevator', label: 'Grain Elevator' }, { buildingId: 'feed-store', label: 'Co-op Feed Store' }],
  },
  'great-lakes-works': {
    id: 'great-lakes-works', label: 'Great Lakes Works', biome: 'mixed-woodland',
    boosts: { 'sawtooth-factory': 4, 'steel-warehouse': 3, 'auto-repair-shop': 2.5, 'printing-works': 2, warehouse: 2, 'side-by-side-duplex': 1.5 },
    signatures: [{ buildingId: 'sawtooth-factory', label: 'Sawtooth Auto Plant' }, { buildingId: 'steel-warehouse', label: 'Steel Works' }],
  },
  'northeast-rowhouse': {
    id: 'northeast-rowhouse', label: 'Northeast Rowhouse', biome: 'temperate-broadleaf',
    boosts: { 'rowhouse-unit': 5, walkup: 2.5, 'walkup-block': 2, 'corner-shop': 2, 'bakery-walkup': 2, 'textile-mill': 3, colonial: 1.5 },
    signatures: [{ buildingId: 'rowhouse-unit', label: 'Rowhouse Terrace' }, { buildingId: 'textile-mill', label: 'Old Textile Mill' }],
  },
  'southern-roadside': {
    id: 'southern-roadside', label: 'Southern Roadside', biome: 'temperate-broadleaf',
    boosts: { 'porch-house': 3, 'poultry-house': 4, 'roadside-diner': 2.5, 'manufactured-home': 2, 'service-station-canopy': 2 },
    signatures: [{ buildingId: 'poultry-house', label: 'Poultry Barn' }, { buildingId: 'roadside-diner', label: 'Highway Diner' }],
  },
  'southwest-plaza': {
    id: 'southwest-plaza', label: 'Southwest Travel Plaza', biome: 'agricultural-plain',
    boosts: { 'service-station-canopy': 6, 'roadside-diner': 3, 'motel-room-block': 3, 'strip-retail-block': 2, 'self-storage-row': 2, 'manufactured-home': 2 },
    signatures: [{ buildingId: 'service-station-canopy', label: 'Mega Travel Plaza' }, { buildingId: 'motel-room-block', label: 'Motor Court' }],
  },
  'mountain-west': {
    id: 'mountain-west', label: 'Mountain West', biome: 'northern-conifer',
    boosts: { 'stable-block': 4, ranch: 2.5, 'farm-equipment-shed': 2, 'motel-room-block': 2.5, 'hardware-store': 2 },
    signatures: [{ buildingId: 'stable-block', label: 'Ranch Stables' }, { buildingId: 'motel-room-block', label: 'Mountain Motor Lodge' }],
  },
  pacific: {
    id: 'pacific', label: 'Pacific Coast', biome: 'mixed-woodland',
    boosts: { 'orchard-packing-shed': 5, greenhouse: 4, 'garden-center-shop': 3, 'campus-office': 2, 'stepped-apartments': 1.5 },
    signatures: [{ buildingId: 'orchard-packing-shed', label: 'Orchard Packing Shed' }, { buildingId: 'greenhouse', label: 'Nursery Greenhouse' }],
  },
  'northern-timber': {
    id: 'northern-timber', label: 'Northern Timber', biome: 'northern-conifer',
    boosts: { 'freight-transfer-depot': 4, 'contractor-workshop': 3, 'farm-equipment-shed': 2, cottage: 2, warehouse: 2, 'hardware-store': 2 },
    signatures: [{ buildingId: 'freight-transfer-depot', label: 'Timber Freight Depot' }, { buildingId: 'contractor-workshop', label: 'Sawmill Workshop' }],
  },
};

export type CountyArchetypeId = 'rural' | 'roadside' | 'industrial' | 'suburban' | 'main-street' | 'downtown' | 'capitol';

/** Counties 1–7 in order. Each runs one existing campaign level generator. */
export interface CountyArchetype {
  id: CountyArchetypeId;
  index: number;
  label: string;
  levelId: CampaignLevelId;
  boosts: Readonly<Record<string, number>>;
  signatures: readonly SignatureSpec[];
}

export const COUNTY_ARCHETYPES: readonly CountyArchetype[] = [
  {
    id: 'rural', index: 1, label: 'Rural / Agricultural', levelId: 'county',
    boosts: { 'gable-barn': 1.5, 'farmhouse-rear-wing': 1.5 },
    signatures: [{ buildingId: 'gable-barn', label: 'Gable Barn' }],
  },
  {
    id: 'roadside', index: 2, label: 'Roadside / Highway', levelId: 'village',
    boosts: { 'service-station-canopy': 3, 'roadside-diner': 2.5, 'auto-repair-shop': 2, 'manufactured-home': 1.5 },
    signatures: [{ buildingId: 'service-station-canopy', label: 'Highway Service Station' }, { buildingId: 'roadside-diner', label: 'Roadside Diner' }],
  },
  {
    id: 'industrial', index: 3, label: 'Industrial / Works', levelId: 'township',
    boosts: { 'sawtooth-factory': 2, 'steel-warehouse': 2, 'freight-transfer-depot': 2, 'textile-mill': 2, warehouse: 2, 'contractor-workshop': 2, 'printing-works': 2, 'recycling-shed': 2 },
    signatures: [{ buildingId: 'sawtooth-factory', label: 'Sawtooth Factory' }, { buildingId: 'steel-warehouse', label: 'Steel Warehouse' }],
  },
  {
    id: 'suburban', index: 4, label: 'Suburban', levelId: 'suburb',
    boosts: { 'strip-retail-block': 1.5, 'department-store': 1.5, 'side-by-side-duplex': 1.2 },
    signatures: [{ buildingId: 'department-store', label: 'Department Store' }, { buildingId: 'bowling-alley', label: 'Bowling Alley' }],
  },
  {
    id: 'main-street', index: 5, label: 'Main Street / Town', levelId: 'city-borough',
    boosts: { storefront: 2, 'corner-shop': 2, 'bakery-walkup': 2, 'hardware-store': 1.5 },
    signatures: [{ buildingId: 'neighborhood-theater', label: 'Main Street Theater' }, { buildingId: 'storefront', label: 'Main Street Storefront' }],
  },
  {
    id: 'downtown', index: 6, label: 'Downtown / Commercial', levelId: 'city-downtown',
    boosts: { 'hotel-podium': 1.5, 'plaza-office-tower': 1.3 },
    signatures: [{ buildingId: 'plaza-office-tower', label: 'Plaza Office Tower' }, { buildingId: 'hotel-podium', label: 'Grand Hotel' }],
  },
  {
    id: 'capitol', index: 7, label: "Capitol / Governor's Mansion", levelId: 'governors-mansion',
    boosts: {},
    signatures: [{ buildingId: 'mansion-gatehouse', label: 'Capitol Gatehouse' }],
  },
];

export function countyArchetypeAt(index: number): CountyArchetype {
  const found = COUNTY_ARCHETYPES[index - 1];
  if (!found) throw new Error(`County index ${index} is outside 1–7`);
  return found;
}

export function regionalPlacement(flavorId: RegionFlavorId, countyIndex: number): RegionalPlacement {
  return { flavor: REGIONAL_FLAVORS[flavorId], archetype: countyArchetypeAt(countyIndex) };
}

export { MAX_SIGNATURES, regionalWeight, SIGNATURE_BONUS, tagRegionalSignatures, type RegionalPlacement } from './regionalPlacement';
