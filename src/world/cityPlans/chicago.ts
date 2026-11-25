import type { CityPlan } from '../cityPlan';

/**
 * Downtown Chicago in miniature, north at the top of the plan. Lake Michigan fills the east
 * side. The river's north and south branches run down the west edge and its main branch cuts
 * east to the lake at y = 59..66; every street that crosses is a bridge. The Loop is the core
 * south of the main branch, Grant Park and the Museum Campus line the lakefront, and Navy
 * Pier juts into the lake just north of the river mouth. Avenues run north-south at
 * x = 16, 48, 80 and 112 (Michigan Avenue).
 */
export const CHICAGO: CityPlan = {
  id: 'chicago',
  name: 'Chicago',
  width: 168,
  depth: 200,
  land: [
    // Shoreline, north to south: Streeterville, Navy Pier, Grant Park, Museum Campus and its peninsula
    [
      [0, 0], [126, 0], [126, 46], [162, 46], [162, 57], [128, 57], [140, 70], [140, 150],
      [144, 154], [144, 160], [164, 160], [164, 184], [144, 184], [144, 200], [0, 200],
    ],
  ],
  water: [
    // Main branch, out to the lake
    [[8, 59], [142, 59], [142, 66], [8, 66]],
    // North and south branches along the west edge
    [[0, 0], [8, 0], [8, 200], [0, 200]],
  ],
  streets: [
    { axis: 'y', at: 16, from: 0, to: 200 },
    { axis: 'y', at: 48, from: 0, to: 200 },
    { axis: 'y', at: 80, from: 0, to: 200 },
    // Michigan Avenue
    { axis: 'y', at: 112, from: 0, to: 200 },
    // West over the north branch
    { axis: 'x', at: 28, from: 0, to: 112 },
    // Navy Pier
    { axis: 'x', at: 48.5, from: 112, to: 160 },
    { axis: 'x', at: 82, from: 16, to: 112 },
    // West over the south branch
    { axis: 'x', at: 112, from: 0, to: 112 },
    { axis: 'x', at: 142, from: 16, to: 112 },
    // Museum Campus drive, and west over the south branch
    { axis: 'x', at: 172, from: 0, to: 162 },
  ],
  parks: [
    { name: 'Grant Park', x: 114, y: 84, w: 24, d: 62, trees: 44 },
  ],
  landmarks: [
    { buildingId: 'willis-bundle-tower', label: 'Willis Tower', x: 20, y: 128.5 },
    { buildingId: 'hancock-taper-tower', label: 'Hancock Tower', x: 100.4, y: 12 },
    { buildingId: 'navy-pier-hall', label: 'Navy Pier', x: 130, y: 51.4 },
    { buildingId: 'field-museum-hall', label: 'Field Museum', x: 116, y: 161.4 },
    { buildingId: 'shedd-aquarium-rotunda', label: 'Shedd Aquarium', x: 126, y: 174.6 },
    { buildingId: 'adler-planetarium-dome', label: 'Adler Planetarium', x: 152, y: 162.8 },
  ],
  cores: [
    // The Loop
    { x: 64, y: 112, r: 36 },
    // Magnificent Mile
    { x: 98, y: 22, r: 14 },
  ],
  fillCount: 48,
  dollarTarget: 15000,
  timeLimit: 350,
  block: { w: 32, d: 30 },
};
