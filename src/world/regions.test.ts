import { describe, expect, it } from 'vitest';
import { REGION_GRID, REGIONS, regionById, searchRegions } from './regions';

const US_CAPITALS: Record<string, string> = {
  AL: 'Montgomery', AK: 'Juneau', AZ: 'Phoenix', AR: 'Little Rock', CA: 'Sacramento', CO: 'Denver', CT: 'Hartford',
  DE: 'Dover', FL: 'Tallahassee', GA: 'Atlanta', HI: 'Honolulu', ID: 'Boise', IL: 'Springfield', IN: 'Indianapolis',
  IA: 'Des Moines', KS: 'Topeka', KY: 'Frankfort', LA: 'Baton Rouge', ME: 'Augusta', MD: 'Annapolis', MA: 'Boston',
  MI: 'Lansing', MN: 'Saint Paul', MS: 'Jackson', MO: 'Jefferson City', MT: 'Helena', NE: 'Lincoln', NV: 'Carson City',
  NH: 'Concord', NJ: 'Trenton', NM: 'Santa Fe', NY: 'Albany', NC: 'Raleigh', ND: 'Bismarck', OH: 'Columbus',
  OK: 'Oklahoma City', OR: 'Salem', PA: 'Harrisburg', RI: 'Providence', SC: 'Columbia', SD: 'Pierre', TN: 'Nashville',
  TX: 'Austin', UT: 'Salt Lake City', VT: 'Montpelier', VA: 'Richmond', WA: 'Olympia', WV: 'Charleston', WI: 'Madison',
  WY: 'Cheyenne',
};

const CANADA_CAPITALS: Record<string, [string, 'province' | 'territory']> = {
  AB: ['Edmonton', 'province'], BC: ['Victoria', 'province'], MB: ['Winnipeg', 'province'], NB: ['Fredericton', 'province'],
  NL: ["St. John's", 'province'], NS: ['Halifax', 'province'], ON: ['Toronto', 'province'], PE: ['Charlottetown', 'province'],
  QC: ['Quebec City', 'province'], SK: ['Regina', 'province'],
  NT: ['Yellowknife', 'territory'], NU: ['Iqaluit', 'territory'], YT: ['Whitehorse', 'territory'],
};

describe('North American region manifest', () => {
  it('lists all 50 US states and 13 Canadian provinces and territories, 63 in all', () => {
    expect(REGIONS).toHaveLength(63);
    const us = REGIONS.filter(region => region.country === 'US');
    const canada = REGIONS.filter(region => region.country === 'CA');
    expect(us.map(region => region.postal).sort()).toEqual(Object.keys(US_CAPITALS).sort());
    expect(canada.map(region => region.postal).sort()).toEqual(Object.keys(CANADA_CAPITALS).sort());
    expect(canada.filter(region => region.kind === 'province')).toHaveLength(10);
    expect(canada.filter(region => region.kind === 'territory')).toHaveLength(3);
    expect(us.every(region => region.kind === 'state')).toBe(true);
  });

  it('names each real capitol and uses country-prefixed postal codes', () => {
    for (const region of REGIONS) {
      expect(region.id).toBe(`${region.country}-${region.postal}`);
      const expected = region.country === 'US' ? US_CAPITALS[region.postal] : CANADA_CAPITALS[region.postal]![0];
      expect(region.capitol, region.id).toBe(expected);
      if (region.country === 'CA') expect(region.kind).toBe(CANADA_CAPITALS[region.postal]![1]);
    }
    expect(regionById('US-IL')).toMatchObject({ name: 'Illinois', capitol: 'Springfield' });
    expect(regionById('CA-YT')).toMatchObject({ name: 'Yukon', capitol: 'Whitehorse', kind: 'territory' });
    expect(regionById('US-XX')).toBeUndefined();
  });

  it('gives every region its own tile inside the schematic grid', () => {
    const cells = new Set(REGIONS.map(region => region.tile.join(',')));
    expect(cells.size).toBe(63);
    for (const { tile: [col, row], id } of REGIONS) {
      expect(col, id).toBeGreaterThanOrEqual(0);
      expect(col, id).toBeLessThan(REGION_GRID.cols);
      expect(row, id).toBeGreaterThanOrEqual(0);
      expect(row, id).toBeLessThan(REGION_GRID.rows);
    }
  });

  it('finds regions by name, postal code, full code, or capitol', () => {
    expect(searchRegions('').length).toBe(63);
    expect(searchRegions('ri').map(region => region.id)).toContain('US-RI');
    expect(searchRegions('ca-on').map(region => region.id)).toEqual(['CA-ON']);
    expect(searchRegions('Whitehorse').map(region => region.id)).toEqual(['CA-YT']);
    expect(searchRegions('new').map(region => region.postal).sort()).toEqual(['NB', 'NH', 'NJ', 'NL', 'NM', 'NY']);
  });
});
