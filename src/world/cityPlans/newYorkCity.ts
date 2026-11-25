import type { CityPlan } from '../cityPlan';

/**
 * Manhattan in miniature, north at the top of the plan. The island runs off the north edge;
 * the Hudson is west, the East River east, and the harbour south with Liberty Island off the
 * Battery. Avenues run north-south at x = 30, 62, 94, 126; cross streets every 30 units.
 * Central Park takes the middle blocks of the upper island, Midtown and the Financial
 * District are the two cores.
 */
export const NEW_YORK_CITY: CityPlan = {
  id: 'new-york-city',
  name: 'New York City',
  width: 156,
  depth: 306,
  land: [
    // Manhattan
    [[22, 0], [134, 0], [134, 218], [122, 242], [100, 258], [78, 262], [56, 256], [34, 238], [22, 214]],
    // Harbour causeway down to Liberty Island
    [[59, 254], [65, 254], [65, 287], [59, 287]],
    [[38, 281], [65, 281], [65, 287], [38, 287]],
    // Liberty Island
    [[20, 271], [36, 271], [41, 276], [41, 292], [36, 297], [20, 297], [15, 292], [15, 276]],
  ],
  water: [
    // The Lake in Central Park
    [[70, 55], [75, 51], [82, 51], [87, 56], [86, 62], [80, 66], [73, 65], [69, 60]],
  ],
  streets: [
    // Avenues
    { axis: 'y', at: 30, from: 0, to: 220 },
    { axis: 'y', at: 62, from: 0, to: 284 },
    { axis: 'y', at: 94, from: 0, to: 246 },
    { axis: 'y', at: 126, from: 0, to: 220 },
    // Cross streets; the park interrupts 70
    { axis: 'x', at: 10, from: 30, to: 126 },
    { axis: 'x', at: 40, from: 30, to: 126 },
    { axis: 'x', at: 70, from: 30, to: 62 },
    { axis: 'x', at: 70, from: 94, to: 126 },
    { axis: 'x', at: 100, from: 30, to: 126 },
    // East River bridge
    { axis: 'x', at: 130, from: 30, to: 156 },
    // Hudson crossing
    { axis: 'x', at: 160, from: 0, to: 126 },
    { axis: 'x', at: 190, from: 30, to: 126 },
    { axis: 'x', at: 220, from: 30, to: 126 },
    { axis: 'x', at: 246, from: 62, to: 94 },
    // Liberty Island landing
    { axis: 'x', at: 284, from: 40, to: 62 },
  ],
  parks: [
    { name: 'Central Park', x: 64, y: 42, w: 28, d: 56, trees: 70 },
    { name: 'Battery Park', x: 66, y: 248.5, w: 26, d: 9, trees: 8 },
  ],
  landmarks: [
    { buildingId: 'empire-state-tower', label: 'Empire State Tower', x: 72.3, y: 132.4 },
    { buildingId: 'chrysler-spire-tower', label: 'Chrysler Spire Tower', x: 100, y: 118.2 },
    { buildingId: 'one-world-tower', label: 'One World Tower', x: 40, y: 192.4 },
    { buildingId: 'flatiron-wedge', label: 'Flatiron Wedge', x: 72.8, y: 162.4 },
    { buildingId: 'liberty-statue', label: 'Statue of Liberty', x: 24, y: 280 },
  ],
  cores: [
    { x: 78, y: 138, r: 34 },
    { x: 62, y: 205, r: 18 },
  ],
  fillCount: 62,
  dollarTarget: 16000,
  timeLimit: 360,
  block: { w: 32, d: 30 },
};
