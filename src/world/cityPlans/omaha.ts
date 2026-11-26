import type { CityPlan } from '../cityPlan';

/**
 * Downtown Omaha in miniature, north at the top of the plan. The Missouri River is the east
 * side, and the city climbs away from it to the west in four bands: the riverfront and rail
 * yards east of 8th Street (x = 126), the Old Market round 10th Street (x = 98), the tower core
 * between x = 46 and x = 98, and Midtown out to the cathedral on the west edge. The ground is
 * flat; the climb is told by what stands on it. Dodge Street (y = 88) runs from the west edge to
 * the riverfront, and the I-480 arterial (y = 58) crosses the river on the only road bridge.
 * Carter Lake is the oxbow in the north: its three arms wrap a pocket of land (x = 110..144) that
 * two bridges reach. The freight line runs along the south side (y = 188) past Union Station,
 * with consists parked between the level crossings.
 */
export const OMAHA: CityPlan = {
  id: 'omaha',
  name: 'Omaha',
  width: 188,
  depth: 200,
  land: [
    // The west bank of the Missouri
    [[0, 0], [156, 0], [156, 200], [0, 200]],
  ],
  water: [
    // Carter Lake: the west, south and east arms of the oxbow
    [[104, 0], [110, 0], [110, 40], [104, 40]],
    [[104, 34], [150, 34], [150, 40], [104, 40]],
    [[144, 0], [150, 0], [150, 40], [144, 40]],
  ],
  streets: [
    // Midtown avenues
    { axis: 'y', at: 20, from: 0, to: 200 },
    { axis: 'y', at: 46, from: 0, to: 200 },
    // 16th Street
    { axis: 'y', at: 72, from: 0, to: 200 },
    // 10th Street
    { axis: 'y', at: 98, from: 0, to: 200 },
    // 8th Street: over the lake's south arm into the pocket, and down to the rail yards
    { axis: 'y', at: 126, from: 8, to: 118 },
    { axis: 'y', at: 126, from: 118, to: 172, roadClass: 'service' },
    // Over the lake's west arm into the pocket
    { axis: 'x', at: 26, from: 0, to: 138 },
    // I-480, over the Missouri
    { axis: 'x', at: 58, from: 0, to: 188, roadClass: 'arterial' },
    // Dodge Street
    { axis: 'x', at: 88, from: 0, to: 126, roadClass: 'commercial' },
    // Farnam Street
    { axis: 'x', at: 118, from: 0, to: 126 },
    // Howard Street, through the Old Market
    { axis: 'x', at: 148, from: 0, to: 126 },
    // The warehouse street behind the tracks
    { axis: 'x', at: 172, from: 0, to: 126, roadClass: 'service' },
  ],
  rails: [
    {
      name: 'Union Pacific main line', axis: 'x', at: 188, from: 0, to: 156,
      consists: [
        { at: 24, cars: ['tank-car', 'boxcar', 'boxcar'] },
        { at: 49, cars: ['boxcar', 'tank-car', 'freight-locomotive'] },
        { at: 102, cars: ['boxcar', 'boxcar', 'tank-car', 'tank-car', 'boxcar', 'freight-locomotive'] },
        { at: 140, cars: ['boxcar', 'tank-car'] },
      ],
    },
  ],
  parks: [
    { name: 'Gene Leahy Mall', x: 100.5, y: 121, w: 23, d: 10, trees: 12 },
    { name: 'Heartland of America Park', x: 130, y: 120, w: 24, d: 26, trees: 24 },
    // Open paving on the bank under the footbridge
    { name: 'Lewis and Clark Landing', x: 132, y: 92, w: 13, d: 22, cover: 'gravel' },
  ],
  landmarks: [
    { buildingId: 'first-national-step-tower', label: 'First National Tower', x: 80, y: 97 },
    { buildingId: 'woodmen-grid-tower', label: 'WoodmenLife Tower', x: 54, y: 100 },
    { buildingId: 'union-station-terminal', label: 'Union Station', x: 101.5, y: 177 },
    { buildingId: 'joslyn-marble-museum', label: 'Joslyn Art Museum', x: 26, y: 68 },
    { buildingId: 'cecilia-twin-spire-cathedral', label: 'Saint Cecilia Cathedral', x: 5, y: 95 },
    { buildingId: 'kerrey-cable-footbridge', label: 'Bob Kerrey Pedestrian Bridge', x: 147, y: 99, clear: 4 },
    { buildingId: 'riverfront-grain-elevator', label: 'Riverfront Grain Elevator', x: 131, y: 152 },
  ],
  cores: [
    // The tower core, either side of 16th Street
    { x: 80, y: 102, r: 30 },
    // The Old Market
    { x: 108, y: 150, r: 12 },
  ],
  fillCount: 46,
  dollarTarget: 16000,
  timeLimit: 360,
  block: { w: 28, d: 30 },
};
