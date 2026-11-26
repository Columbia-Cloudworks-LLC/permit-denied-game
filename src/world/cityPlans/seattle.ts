import type { CityPlan } from '../cityPlan';

/**
 * Downtown Seattle in miniature, north at the top of the plan. Elliott Bay is the west side and
 * the east edge is the freeway (x = 162); Lake Washington is off the map. Alaskan Way (x = 32)
 * runs along the seawall, and four finger piers reach into the bay where the cross streets at
 * y = 104, 134, 164 and 194 run out onto them: the aquarium, the Great Wheel, Pier 54 and Colman
 * Dock. Each pier carries its street along the south side and its shed along the north, and a
 * ferry lies moored against the south side of the first three, across the slip from the next
 * pier down. Seattle Center is the open superblock in the north (x = 84..136, y = 14..44), and
 * the monorail runs from it down the middle of 5th Avenue (x = 110) to Pike Street. The ground
 * is flat; Queen Anne and Capitol Hill are told by the low blocks north of Denny Way (y = 44)
 * and east of 7th Avenue (x = 136), away from the two cores.
 */
const PIER = { west: 6, east: 27, north: 10, south: 4 } as const;
const pier = (street: number) => [[PIER.west, street - PIER.north], [PIER.east, street - PIER.north], [PIER.east, street + PIER.south], [PIER.west, street + PIER.south]] as const;
/** A ferry tied up along the south side of the pier on `street`, its rail just over the pier's edge. */
const berth = (street: number, name: string) => ({ name, axis: 'x' as const, x: 15.5, y: street + PIER.south + 1.2 });

export const SEATTLE: CityPlan = {
  id: 'seattle',
  name: 'Seattle',
  width: 176,
  depth: 216,
  land: [
    // The mainland behind the seawall
    [[26, 0], [176, 0], [176, 216], [26, 216]],
    // Pier 59, Pier 57, Pier 54 and Colman Dock
    pier(104), pier(134), pier(164), pier(194),
  ],
  water: [
    // The International Fountain's basin
    [[120, 32], [125, 32], [127, 34], [127, 37], [125, 39], [120, 39], [118, 37], [118, 34]],
  ],
  fountains: [
    { x0: 120.5, y0: 35.5, x1: 124.5, y1: 35.5, jets: 5, height: 4.5 },
  ],
  streets: [
    // Alaskan Way, along the seawall
    { axis: 'y', at: 32, from: 14, to: 216, roadClass: 'commercial' },
    // 1st and 3rd Avenues
    { axis: 'y', at: 58, from: 0, to: 216 },
    { axis: 'y', at: 84, from: 0, to: 216 },
    // 5th Avenue, under the monorail from Denny Way south
    { axis: 'y', at: 110, from: 44, to: 216, roadClass: 'arterial' },
    // 7th Avenue
    { axis: 'y', at: 136, from: 0, to: 216 },
    // The freeway
    { axis: 'y', at: 162, from: 0, to: 216, roadClass: 'arterial' },
    // Mercer Street and Denny Way, either side of Seattle Center
    { axis: 'x', at: 14, from: 32, to: 176 },
    { axis: 'x', at: 44, from: 32, to: 176, roadClass: 'commercial' },
    // Bell Street
    { axis: 'x', at: 74, from: 32, to: 176 },
    // Out onto Pier 59
    { axis: 'x', at: 104, from: 8, to: 176 },
    // Pike Street, out onto Pier 57
    { axis: 'x', at: 134, from: 8, to: 176 },
    // Madison Street, out onto Pier 54
    { axis: 'x', at: 164, from: 8, to: 176 },
    // Yesler Way, out onto Colman Dock
    { axis: 'x', at: 194, from: 8, to: 176 },
  ],
  monorails: [
    {
      name: 'Seattle Center Monorail', axis: 'y', at: 110,
      pylons: [33, 38.5, 49.5, 59, 68.5, 79.5, 89, 98.5, 109.5, 119, 128.5, 139.5],
      train: { at: 80.5, cars: 4 },
    },
  ],
  ferries: [berth(104, 'Pier 59 ferry'), berth(134, 'Pier 57 ferry'), berth(164, 'Pier 54 ferry')],
  parks: [
    { name: 'Seattle Center', x: 113.5, y: 29.5, w: 20.5, d: 11.5, trees: 10 },
    { name: 'Center House Lawn', x: 86.5, y: 16.5, w: 9, d: 14, trees: 6 },
    { name: 'Victor Steinbrueck Park', x: 36, y: 110, w: 16, d: 11, trees: 7 },
    { name: 'Occidental Square', x: 74, y: 198, w: 8, d: 12, trees: 6 },
  ],
  landmarks: [
    { buildingId: 'saucer-needle-tower', label: 'Space Needle', x: 98, y: 19, clear: 4, view: 5 },
    { buildingId: 'smith-pyramid-tower', label: 'Smith Tower', x: 61, y: 197 },
    { buildingId: 'public-market-arcade', label: 'Pike Place Market', x: 35.5, y: 126.8 },
    { buildingId: 'waterfront-great-wheel', label: 'Seattle Great Wheel', x: 8, y: 124.4 },
    { buildingId: 'science-center-arches', label: 'Pacific Science Center', x: 88, y: 33, clear: 2 },
    { buildingId: 'garden-glasshouse', label: 'Garden and Glass', x: 112.5, y: 22 },
    { buildingId: 'colman-ferry-terminal', label: 'Colman Dock', x: 8.5, y: 184.4 },
    { buildingId: 'aquarium-pier-shed', label: 'Seattle Aquarium', x: 8, y: 94.4 },
    { buildingId: 'curiosity-pier-shed', label: 'Pier 54', x: 9, y: 154.4 },
  ],
  cores: [
    // The retail and financial core, from Pike Street to Madison
    { x: 100, y: 150, r: 36 },
    // Pioneer Square
    { x: 72, y: 196, r: 10 },
  ],
  fillCount: 58,
  dollarTarget: 16000,
  timeLimit: 360,
  block: { w: 26, d: 30 },
};
