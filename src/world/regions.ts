/**
 * North American overworld: 50 US states and 13 Canadian provinces and territories.
 * Each region holds seven counties. Tiles are a schematic cartogram, not geography:
 * one square per region on a 12 × 9 grid, so the map costs a few hundred bytes of SVG.
 */

export type RegionCountry = 'US' | 'CA';
export type RegionKind = 'state' | 'province' | 'territory';
export type RegionFlavorId =
  | 'grain-belt'
  | 'great-lakes-works'
  | 'northeast-rowhouse'
  | 'southern-roadside'
  | 'southwest-plaza'
  | 'mountain-west'
  | 'pacific'
  | 'northern-timber';

export interface RegionDef {
  /** ISO 3166-2 style code, e.g. `US-IL` or `CA-YT`. */
  id: string;
  country: RegionCountry;
  kind: RegionKind;
  name: string;
  /** Two-letter postal abbreviation shown on the tile. */
  postal: string;
  capitol: string;
  flavor: RegionFlavorId;
  /** Schematic grid cell: column, row. */
  tile: readonly [number, number];
}

type Row = [postal: string, name: string, capitol: string, flavor: RegionFlavorId, col: number, row: number];

const US: readonly Row[] = [
  ['AL', 'Alabama', 'Montgomery', 'southern-roadside', 6, 7],
  ['AK', 'Alaska', 'Juneau', 'northern-timber', 0, 0],
  ['AZ', 'Arizona', 'Phoenix', 'southwest-plaza', 1, 6],
  ['AR', 'Arkansas', 'Little Rock', 'southern-roadside', 4, 6],
  ['CA', 'California', 'Sacramento', 'pacific', 0, 5],
  ['CO', 'Colorado', 'Denver', 'mountain-west', 2, 5],
  ['CT', 'Connecticut', 'Hartford', 'northeast-rowhouse', 9, 4],
  ['DE', 'Delaware', 'Dover', 'northeast-rowhouse', 9, 5],
  ['FL', 'Florida', 'Tallahassee', 'southern-roadside', 8, 8],
  ['GA', 'Georgia', 'Atlanta', 'southern-roadside', 7, 7],
  ['HI', 'Hawaii', 'Honolulu', 'pacific', 0, 8],
  ['ID', 'Idaho', 'Boise', 'mountain-west', 1, 3],
  ['IL', 'Illinois', 'Springfield', 'grain-belt', 5, 3],
  ['IN', 'Indiana', 'Indianapolis', 'grain-belt', 5, 4],
  ['IA', 'Iowa', 'Des Moines', 'grain-belt', 4, 4],
  ['KS', 'Kansas', 'Topeka', 'grain-belt', 3, 6],
  ['KY', 'Kentucky', 'Frankfort', 'southern-roadside', 5, 5],
  ['LA', 'Louisiana', 'Baton Rouge', 'southern-roadside', 4, 7],
  ['ME', 'Maine', 'Augusta', 'northern-timber', 11, 2],
  ['MD', 'Maryland', 'Annapolis', 'northeast-rowhouse', 8, 5],
  ['MA', 'Massachusetts', 'Boston', 'northeast-rowhouse', 10, 3],
  ['MI', 'Michigan', 'Lansing', 'great-lakes-works', 7, 3],
  ['MN', 'Minnesota', 'Saint Paul', 'grain-belt', 4, 3],
  ['MS', 'Mississippi', 'Jackson', 'southern-roadside', 5, 7],
  ['MO', 'Missouri', 'Jefferson City', 'grain-belt', 4, 5],
  ['MT', 'Montana', 'Helena', 'mountain-west', 2, 3],
  ['NE', 'Nebraska', 'Lincoln', 'grain-belt', 3, 5],
  ['NV', 'Nevada', 'Carson City', 'southwest-plaza', 1, 4],
  ['NH', 'New Hampshire', 'Concord', 'northeast-rowhouse', 10, 2],
  ['NJ', 'New Jersey', 'Trenton', 'northeast-rowhouse', 8, 4],
  ['NM', 'New Mexico', 'Santa Fe', 'southwest-plaza', 2, 6],
  ['NY', 'New York', 'Albany', 'northeast-rowhouse', 8, 3],
  ['NC', 'North Carolina', 'Raleigh', 'southern-roadside', 6, 6],
  ['ND', 'North Dakota', 'Bismarck', 'grain-belt', 3, 3],
  ['OH', 'Ohio', 'Columbus', 'great-lakes-works', 6, 4],
  ['OK', 'Oklahoma', 'Oklahoma City', 'southwest-plaza', 3, 7],
  ['OR', 'Oregon', 'Salem', 'pacific', 0, 4],
  ['PA', 'Pennsylvania', 'Harrisburg', 'northeast-rowhouse', 7, 4],
  ['RI', 'Rhode Island', 'Providence', 'northeast-rowhouse', 9, 3],
  ['SC', 'South Carolina', 'Columbia', 'southern-roadside', 7, 6],
  ['SD', 'South Dakota', 'Pierre', 'grain-belt', 3, 4],
  ['TN', 'Tennessee', 'Nashville', 'southern-roadside', 5, 6],
  ['TX', 'Texas', 'Austin', 'southwest-plaza', 3, 8],
  ['UT', 'Utah', 'Salt Lake City', 'mountain-west', 1, 5],
  ['VT', 'Vermont', 'Montpelier', 'northeast-rowhouse', 9, 2],
  ['VA', 'Virginia', 'Richmond', 'southern-roadside', 7, 5],
  ['WA', 'Washington', 'Olympia', 'pacific', 0, 3],
  ['WV', 'West Virginia', 'Charleston', 'southern-roadside', 6, 5],
  ['WI', 'Wisconsin', 'Madison', 'great-lakes-works', 6, 3],
  ['WY', 'Wyoming', 'Cheyenne', 'mountain-west', 2, 4],
];

type CanadaRow = [...Row, kind: 'province' | 'territory'];

const CANADA: readonly CanadaRow[] = [
  ['AB', 'Alberta', 'Edmonton', 'grain-belt', 2, 1, 'province'],
  ['BC', 'British Columbia', 'Victoria', 'northern-timber', 1, 1, 'province'],
  ['MB', 'Manitoba', 'Winnipeg', 'grain-belt', 4, 1, 'province'],
  ['NB', 'New Brunswick', 'Fredericton', 'northern-timber', 9, 1, 'province'],
  ['NL', 'Newfoundland and Labrador', "St. John's", 'northern-timber', 10, 0, 'province'],
  ['NS', 'Nova Scotia', 'Halifax', 'northern-timber', 11, 1, 'province'],
  ['ON', 'Ontario', 'Toronto', 'great-lakes-works', 6, 1, 'province'],
  ['PE', 'Prince Edward Island', 'Charlottetown', 'northern-timber', 10, 1, 'province'],
  ['QC', 'Quebec', 'Quebec City', 'northern-timber', 8, 1, 'province'],
  ['SK', 'Saskatchewan', 'Regina', 'grain-belt', 3, 1, 'province'],
  ['NT', 'Northwest Territories', 'Yellowknife', 'northern-timber', 2, 0, 'territory'],
  ['NU', 'Nunavut', 'Iqaluit', 'northern-timber', 3, 0, 'territory'],
  ['YT', 'Yukon', 'Whitehorse', 'northern-timber', 1, 0, 'territory'],
];

export const REGIONS: readonly RegionDef[] = [
  ...US.map(([postal, name, capitol, flavor, col, row]): RegionDef => ({
    id: `US-${postal}`, country: 'US', kind: 'state', name, postal, capitol, flavor, tile: [col, row],
  })),
  ...CANADA.map(([postal, name, capitol, flavor, col, row, kind]): RegionDef => ({
    id: `CA-${postal}`, country: 'CA', kind, name, postal, capitol, flavor, tile: [col, row],
  })),
];

export const REGION_GRID = { cols: 12, rows: 9 } as const;

const BY_ID = new Map(REGIONS.map(region => [region.id, region]));

export function regionById(id: string | null | undefined): RegionDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isRegionId(id: string | null | undefined): boolean {
  return !!id && BY_ID.has(id);
}

/** Case-insensitive match on name, postal code, full code, or capitol. */
export function searchRegions(query: string, regions: readonly RegionDef[] = REGIONS): RegionDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...regions];
  return regions.filter(region =>
    region.name.toLowerCase().includes(q) ||
    region.postal.toLowerCase() === q ||
    region.id.toLowerCase() === q ||
    region.capitol.toLowerCase().includes(q),
  );
}
