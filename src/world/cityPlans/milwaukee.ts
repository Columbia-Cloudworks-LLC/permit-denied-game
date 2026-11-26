import type { CityPlan } from '../cityPlan';

/**
 * Downtown Milwaukee in miniature, north at the top of the plan. Lake Michigan fills the east
 * side. The Milwaukee River runs south through the middle (x = 60..66) and meets the Menomonee,
 * coming in from the west, in one channel that runs out to the harbour at y = 150..157; every
 * street that crosses is a bridge. Wisconsin Avenue (y = 78) runs from the west edge, past the
 * library in Westown, over the river and out along the lakefront spit to the art museum and its
 * wings. The theater stands by the river in East Town, the ballpark takes the whole
 * Menomonee valley west of x = 44, with no street through it, and the basilica stands on the south side across the channel.
 */
export const MILWAUKEE: CityPlan = {
  id: 'milwaukee',
  name: 'Milwaukee',
  width: 176,
  depth: 208,
  land: [
    // Shoreline, north to south, with the museum's spit out into the lake
    [[0, 0], [138, 0], [138, 58], [158, 58], [158, 98], [138, 98], [138, 208], [0, 208]],
  ],
  water: [
    // Milwaukee River
    [[60, 0], [66.4, 0], [66.4, 151], [60, 151]],
    // Menomonee River and the harbour channel, out to the lake
    [[0, 150], [176, 150], [176, 157], [0, 157]],
  ],
  streets: [
    // The far-west avenue stops at the ballpark and picks up again on the south side
    { axis: 'y', at: 16, from: 0, to: 108 },
    { axis: 'y', at: 16, from: 182, to: 208 },
    { axis: 'y', at: 44, from: 0, to: 208 },
    // Water Street
    { axis: 'y', at: 84, from: 0, to: 208 },
    // Prospect Avenue
    { axis: 'y', at: 112, from: 0, to: 208 },
    { axis: 'x', at: 18, from: 0, to: 112 },
    // Wells Street
    { axis: 'x', at: 48, from: 16, to: 112 },
    // Wisconsin Avenue, out to the museum
    { axis: 'x', at: 78, from: 0, to: 152, roadClass: 'commercial' },
    { axis: 'x', at: 108, from: 16, to: 112 },
    // Canal Street
    { axis: 'x', at: 136, from: 44, to: 112 },
    // South side
    { axis: 'x', at: 182, from: 0, to: 112 },
  ],
  parks: [
    { name: 'Juneau Park', x: 117, y: 4, w: 19, d: 68, trees: 30 },
    { name: 'Lakeshore Park', x: 117, y: 84, w: 19, d: 62, trees: 26 },
    { name: 'Museum Lawn', x: 140, y: 83, w: 16, d: 13, trees: 4 },
  ],
  landmarks: [
    { buildingId: 'lakefront-wing-museum', label: 'Milwaukee Art Museum', x: 141, y: 62, clear: 5 },
    { buildingId: 'josaphat-dome-basilica', label: 'Saint Josaphat Basilica', x: 22, y: 186.5 },
    { buildingId: 'milwaukee-central-library', label: 'Milwaukee Public Library', x: 22, y: 67 },
    { buildingId: 'fan-roof-ballpark', label: 'Brewers Stadium', x: 4, y: 113 },
    { buildingId: 'pabst-theater-hall', label: 'Pabst Theater', x: 88, y: 52 },
  ],
  ballfields: [
    // Inside the ballpark's stands: home plate under the roof pivot, the outfield toward the camera
    { x: 12.05, y: 121.05, size: 20.7, home: 'nw' },
  ],
  cores: [
    // East Town, either side of Wisconsin Avenue
    { x: 94, y: 80, r: 30 },
    // Westown
    { x: 34, y: 62, r: 14 },
  ],
  fillCount: 44,
  dollarTarget: 15000,
  timeLimit: 350,
  block: { w: 32, d: 30 },
};
