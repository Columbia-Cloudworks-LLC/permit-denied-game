import type { CampaignLevelId } from '../game/campaign';
import type { BiomeId } from './biomes';
// Regional landmark packages register themselves when this lazy chunk loads.
import './landmarkPack';
import { finishRegionalLayout } from './regionalBrands';
import type { RegionCountry, RegionFlavorId } from './regions';
import type { BrandSpec, RegionalLandmark, RegionalPlacement } from './regionalPlacement';

/**
 * Regional flavor biases which already-eligible buildings a county draws.
 * It never adds a building to a level: a boost on an ID the level does not list does nothing,
 * so `campaign.levels` stays the opt-in gate described in docs/campaign.md.
 * Brands repaint placed hosts, and a landmark override swaps only the county's marked objective.
 */
export interface SignatureSpec {
  buildingId: string;
  label: string;
}

/** A regional landmark for one county index; `regionIds` narrows it to named regions, which then win over a flavor-wide entry. */
export interface LandmarkOverride {
  countyIndex: number;
  buildingId: string;
  label: string;
  regionIds?: readonly string[];
}

export interface RegionalFlavor {
  id: RegionFlavorId;
  label: string;
  biome: BiomeId;
  /** Multiplier on the building's campaign weight. Missing means 1. */
  boosts: Readonly<Record<string, number>>;
  /** Tagged in preference order when the county places one. */
  signatures: readonly SignatureSpec[];
  /** Brand ids (`BRANDS`) this flavor's counties may stamp, in house order. */
  brands: readonly string[];
  landmarks: readonly LandmarkOverride[];
}

const brand = (
  id: string, label: string, signText: string, hostBuildingIds: readonly string[],
  [faceColor, trimColor, textColor, fasciaColor]: readonly [number, number, number, number],
  target: Pick<BrandSpec, 'countries' | 'regionIds'> = {},
): BrandSpec => ({ id, label, signText, hostBuildingIds, faceColor, trimColor, textColor, fasciaColor, ...target });

/**
 * Regional facsimile establishments. Every name is a parody; none uses a real chain's mark or logo.
 * Colours are face, trim, lettering, fascia.
 */
export const BRANDS: readonly BrandSpec[] = [
  brand('kaseys-general', "Kasey's General Store", 'KASEYS PIZZA', ['service-station-canopy', 'storefront', 'small-grocery'],
    [0xc8102e, 0x7a0c1c, 0xffffff, 0xc8102e], { countries: ['US'], regionIds: ['US-IA', 'US-IL', 'US-MO'] }),
  brand('buccees-plaza', "Buccee's Travel Plaza", 'BUCCEES PLAZA', ['service-station-canopy', 'storefront', 'strip-retail-block'],
    [0xffd100, 0xb5121b, 0x5a3a1a, 0xb5121b], { countries: ['US'], regionIds: ['US-TX'] }),
  brand('whatabeef', 'Whatabeef', 'WHATABEEF', ['roadside-diner'],
    [0xff7a00, 0xe9e2d0, 0xffffff, 0xff7a00], { countries: ['US'], regionIds: ['US-TX'] }),
  brand('mennards', "Mennard's Home Center", 'MENNARDS', ['hardware-store', 'department-store'],
    [0x1f7a3a, 0x124a22, 0xffd100, 0x1f7a3a], { countries: ['US'], regionIds: ['US-IL', 'US-IA', 'US-MO', 'US-WI'] }),
  brand('wahoo-market', 'Wahoo Market', 'WAHOO MARKET', ['corner-shop', 'storefront', 'service-station-canopy'],
    [0xb8232f, 0x6a1018, 0xffe9a8, 0xb8232f], { countries: ['US'] }),
  brand('dunkies', "Dunkie's Coffee", 'DUNKIES', ['corner-shop', 'bakery', 'bakery-walkup'],
    [0xfff4e6, 0xff6e1b, 0xd6246e, 0xff6e1b], { countries: ['US'] }),
  brand('timmys-coffee', "Timmy's Coffee", 'TIMMYS', ['corner-shop', 'bakery', 'bakery-walkup', 'roadside-diner'],
    [0xa6192e, 0x5c0f1a, 0xffffff, 0xa6192e], { countries: ['CA'] }),
  brand('canuck-tire', 'Canuck Tire', 'CANUCK TIRE', ['auto-repair-shop', 'hardware-store'],
    [0xd52b1e, 0x1f5f2a, 0xffffff, 0xd52b1e], { countries: ['CA'] }),
  brand('huddle-griddle', 'Huddle Griddle', 'HUDDLE GRIDDLE', ['roadside-diner'],
    [0xffd400, 0x1a1a1a, 0x1a1a1a, 0xffd400], { countries: ['US'] }),
  brand('in-n-outpost', 'In-N-Outpost Burger', 'IN N OUTPOST', ['roadside-diner', 'storefront'],
    [0xfdf8ee, 0xd71920, 0xd71920, 0xffd100], { countries: ['US'] }),
  brand('culvers-custard', "Culvert's Custard", 'CULVERTS', ['roadside-diner', 'bakery'],
    [0x005daa, 0x003a6b, 0xffffff, 0x005daa], { countries: ['US'], regionIds: ['US-WI'] }),
  brand('krogers-fresh', "Kroeger's Fresh", 'KROEGERS FRESH', ['small-grocery', 'storefront'],
    [0x0c4da2, 0x08336b, 0xffffff, 0x0c4da2], { countries: ['US'], regionIds: ['US-OH', 'US-KY'] }),
  brand('tractor-depot', 'Tractor Depot', 'TRACTOR DEPOT', ['feed-store', 'hardware-store', 'farm-equipment-shed'],
    [0xd0202e, 0x1a1a1a, 0xffffff, 0xd0202e]),
  brand('trader-moes', "Trader Moe's Market", 'TRADER MOES', ['small-grocery', 'garden-center-shop', 'storefront'],
    [0xb22222, 0x5a1010, 0xfff1c9, 0xb22222], { countries: ['US'] }),
  brand('dino-fuel', 'Dino Fuel & Lube', 'DINO FUEL', ['service-station-canopy', 'storefront', 'auto-repair-shop'],
    [0x2e7d32, 0x1b4d1e, 0xffffff, 0x2e7d32], { countries: ['US'] }),
  brand('moose-general', 'Moosehead General', 'MOOSE GENERAL', ['storefront', 'hardware-store', 'corner-shop', 'service-station-canopy'],
    [0x234f2c, 0x15301b, 0xf3e4ba, 0x234f2c]),
];

const BRAND_BY_ID = new Map(BRANDS.map(entry => [entry.id, entry]));

export function brandById(id: string | null | undefined): BrandSpec | undefined {
  return id ? BRAND_BY_ID.get(id) : undefined;
}

const landmark = (countyIndex: number, buildingId: string, label: string, regionIds?: readonly string[]): LandmarkOverride => ({ countyIndex, buildingId, label, regionIds });

export const REGIONAL_FLAVORS: Readonly<Record<RegionFlavorId, RegionalFlavor>> = {
  'grain-belt': {
    id: 'grain-belt', label: 'Grain Belt', biome: 'agricultural-plain',
    boosts: { 'grain-elevator': 6, 'feed-store': 3, 'gable-barn': 2, 'farm-equipment-shed': 2, 'dairy-building': 2, 'hardware-store': 1.5 },
    signatures: [{ buildingId: 'grain-elevator', label: 'Grain Elevator' }, { buildingId: 'feed-store', label: 'Co-op Feed Store' }],
    brands: ['kaseys-general', 'mennards', 'tractor-depot', 'culvers-custard', 'timmys-coffee', 'canuck-tire'],
    landmarks: [
      landmark(1, 'terminal-grain-coop', 'Terminal Grain Co-op'),
      landmark(3, 'terminal-grain-coop', 'Terminal Elevator Works', ['US-KS', 'US-NE', 'US-ND', 'US-SD', 'CA-SK', 'CA-MB']),
      landmark(5, 'brewery-brickworks', 'Riverboat Brewery Brickworks', ['US-MO', 'US-IA', 'US-IL', 'US-MN']),
    ],
  },
  'great-lakes-works': {
    id: 'great-lakes-works', label: 'Great Lakes Works', biome: 'mixed-woodland',
    boosts: { 'sawtooth-factory': 4, 'steel-warehouse': 3, 'auto-repair-shop': 2.5, 'printing-works': 2, warehouse: 2, 'side-by-side-duplex': 1.5 },
    signatures: [{ buildingId: 'sawtooth-factory', label: 'Sawtooth Auto Plant' }, { buildingId: 'steel-warehouse', label: 'Steel Works' }],
    brands: ['mennards', 'culvers-custard', 'krogers-fresh', 'timmys-coffee', 'canuck-tire', 'tractor-depot'],
    landmarks: [
      landmark(3, 'blast-furnace-works', 'Blast Furnace & Auto Works'),
      landmark(4, 'frank-grimes-bowling', 'Frank Grimes Bowl'),
      landmark(5, 'brewery-brickworks', 'Lakeside Brewery Brickworks', ['US-WI']),
    ],
  },
  'northeast-rowhouse': {
    id: 'northeast-rowhouse', label: 'Northeast Rowhouse', biome: 'temperate-broadleaf',
    boosts: { 'rowhouse-unit': 5, walkup: 2.5, 'walkup-block': 2, 'corner-shop': 2, 'bakery-walkup': 2, 'textile-mill': 3, colonial: 1.5 },
    signatures: [{ buildingId: 'rowhouse-unit', label: 'Rowhouse Terrace' }, { buildingId: 'textile-mill', label: 'Old Textile Mill' }],
    brands: ['wahoo-market', 'dunkies'],
    landmarks: [landmark(7, 'granite-statehouse', 'Granite Statehouse')],
  },
  'southern-roadside': {
    id: 'southern-roadside', label: 'Southern Roadside', biome: 'temperate-broadleaf',
    boosts: { 'porch-house': 3, 'poultry-house': 4, 'roadside-diner': 2.5, 'manufactured-home': 2, 'service-station-canopy': 2 },
    signatures: [{ buildingId: 'poultry-house', label: 'Poultry Barn' }, { buildingId: 'roadside-diner', label: 'Highway Diner' }],
    brands: ['huddle-griddle', 'buccees-plaza', 'krogers-fresh', 'tractor-depot'],
    landmarks: [
      landmark(2, 'giant-water-tower', 'Giant Roadside Water Tower'),
      landmark(5, 'brewery-brickworks', 'Riverboat Brewery Brickworks', ['US-LA', 'US-MS', 'US-KY', 'US-TN']),
    ],
  },
  'southwest-plaza': {
    id: 'southwest-plaza', label: 'Southwest Travel Plaza', biome: 'arid-scrub',
    boosts: { 'service-station-canopy': 6, 'roadside-diner': 3, 'motel-room-block': 3, 'strip-retail-block': 2, 'self-storage-row': 2, 'manufactured-home': 2 },
    signatures: [{ buildingId: 'service-station-canopy', label: 'Mega Travel Plaza' }, { buildingId: 'motel-room-block', label: 'Motor Court' }],
    brands: ['buccees-plaza', 'whatabeef', 'in-n-outpost', 'dino-fuel'],
    landmarks: [landmark(2, 'mega-beaver-travel-plaza', 'Mega Beaver Travel Plaza')],
  },
  'mountain-west': {
    id: 'mountain-west', label: 'Mountain West', biome: 'northern-conifer',
    boosts: { 'stable-block': 4, ranch: 2.5, 'farm-equipment-shed': 2, 'motel-room-block': 2.5, 'hardware-store': 2 },
    signatures: [{ buildingId: 'stable-block', label: 'Ranch Stables' }, { buildingId: 'motel-room-block', label: 'Mountain Motor Lodge' }],
    brands: ['dino-fuel', 'tractor-depot', 'in-n-outpost'],
    landmarks: [landmark(2, 'giant-water-tower', 'Giant Roadside Water Tower')],
  },
  pacific: {
    id: 'pacific', label: 'Pacific Coast', biome: 'mixed-woodland',
    boosts: { 'orchard-packing-shed': 5, greenhouse: 4, 'garden-center-shop': 3, 'campus-office': 2, 'stepped-apartments': 1.5 },
    signatures: [{ buildingId: 'orchard-packing-shed', label: 'Orchard Packing Shed' }, { buildingId: 'greenhouse', label: 'Nursery Greenhouse' }],
    brands: ['in-n-outpost', 'trader-moes', 'dino-fuel'],
    landmarks: [landmark(7, 'granite-statehouse', 'Sandstone Statehouse')],
  },
  'northern-timber': {
    id: 'northern-timber', label: 'Northern Timber', biome: 'northern-conifer',
    boosts: { 'freight-transfer-depot': 4, 'contractor-workshop': 3, 'farm-equipment-shed': 2, cottage: 2, warehouse: 2, 'hardware-store': 2 },
    signatures: [{ buildingId: 'freight-transfer-depot', label: 'Timber Freight Depot' }, { buildingId: 'contractor-workshop', label: 'Sawmill Workshop' }],
    brands: ['timmys-coffee', 'canuck-tire', 'moose-general', 'tractor-depot', 'dino-fuel'],
    landmarks: [landmark(7, 'granite-statehouse', 'Granite Legislature')],
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

/** The region a county's flavor is resolved for. A bare flavor id resolves the flavor-wide picks only. */
export type RegionRef = { id: string; country: RegionCountry; flavor: RegionFlavorId };

/**
 * The brands a region stamps: its flavor's list, plus any brand that names the region, minus
 * those limited to the other country. Brands naming the region come first, then country-only
 * brands (so a province leads with its Canadian chains), then the rest in house order.
 */
export function brandsForRegion(region: RegionRef | RegionFlavorId): BrandSpec[] {
  const ref = typeof region === 'string' ? undefined : region;
  const flavor = REGIONAL_FLAVORS[ref?.flavor ?? (region as RegionFlavorId)];
  const rank = (entry: BrandSpec) => ref && entry.regionIds?.includes(ref.id) ? 0 : ref && entry.countries?.length === 1 && ref.country === 'CA' ? 1 : 2;
  return BRANDS
    .filter(entry => flavor.brands.includes(entry.id) || (!!ref && !!entry.regionIds?.includes(ref.id)))
    .filter(entry => !ref || !entry.countries || entry.countries.includes(ref.country))
    .map(entry => ({ entry, rank: rank(entry), order: flavor.brands.indexOf(entry.id) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ entry }) => entry);
}

/** The county's regional landmark, when its region or flavor overrides the level's civic one. */
export function regionalLandmark(region: RegionRef | RegionFlavorId, countyIndex: number): RegionalLandmark | undefined {
  const ref = typeof region === 'string' ? undefined : region;
  const options = REGIONAL_FLAVORS[ref?.flavor ?? (region as RegionFlavorId)].landmarks.filter(entry => entry.countyIndex === countyIndex);
  const pick = options.find(entry => ref && entry.regionIds?.includes(ref.id)) ?? options.find(entry => !entry.regionIds);
  return pick && { buildingId: pick.buildingId, label: pick.label, structureIds: [pick.buildingId] };
}

export function regionalPlacement(region: RegionRef | RegionFlavorId, countyIndex: number): RegionalPlacement {
  const flavor = REGIONAL_FLAVORS[typeof region === 'string' ? region : region.flavor];
  const placement: RegionalPlacement = {
    flavor, archetype: countyArchetypeAt(countyIndex),
    landmark: regionalLandmark(region, countyIndex),
    brands: brandsForRegion(region),
  };
  placement.finish = (layout, seed) => finishRegionalLayout(placement, layout, seed);
  return placement;
}

export { MAX_SIGNATURES, regionalLevel, regionalWeight, SIGNATURE_BONUS, tagRegionalSignatures, type BrandSpec, type RegionalLandmark, type RegionalPlacement } from './regionalPlacement';
