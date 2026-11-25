import type { CityPlan } from '../cityPlan';

/**
 * The Las Vegas valley in miniature, north at the top of the plan. The Strip (x = 60) runs the
 * whole length of the map; Fremont Street (y = 16) crosses it in the old downtown at the north
 * end, under its canopy. The resorts stand in their real order down the boulevard: the Strat,
 * then the Venetian with the Sphere behind it, Caesars Palace across from the High Roller, the
 * Bellagio and its lake across from the Eiffel Tower, and the Luxor pyramid and sphinx where the
 * grid gives out. The Welcome sign stands alone in the desert past the last cross street.
 * There is no water but the lake: the open ground is caliche, sand and creosote flat.
 */
export const LAS_VEGAS: CityPlan = {
  id: 'las-vegas',
  name: 'Las Vegas',
  width: 152,
  depth: 312,
  land: [[[0, 0], [152, 0], [152, 312], [0, 312]]],
  water: [
    // The Bellagio's fountain lake, between the hotel and the Strip
    [[43, 171], [51, 170], [55.5, 173], [55.5, 189], [51, 192], [43, 191], [41.5, 186], [41.5, 176]],
  ],
  ground: ['scrub', 'dirt', 'dirt', 'sand'],
  streets: [
    // West frontage road
    { axis: 'y', at: 28, from: 46, to: 256 },
    // The Strip
    { axis: 'y', at: 60, from: 0, to: 312, roadClass: 'arterial' },
    // Koval Lane
    { axis: 'y', at: 92, from: 0, to: 256 },
    // Paradise Road
    { axis: 'y', at: 124, from: 76, to: 226 },
    // Fremont Street
    { axis: 'x', at: 16, from: 0, to: 152, roadClass: 'commercial' },
    { axis: 'x', at: 46, from: 28, to: 92 },
    // Sahara Avenue
    { axis: 'x', at: 76, from: 0, to: 152 },
    { axis: 'x', at: 106, from: 28, to: 124 },
    // Sands Avenue
    { axis: 'x', at: 136, from: 28, to: 124 },
    // Flamingo Road
    { axis: 'x', at: 166, from: 0, to: 152 },
    { axis: 'x', at: 196, from: 28, to: 124 },
    // Tropicana Avenue, east to the airport
    { axis: 'x', at: 226, from: 28, to: 152 },
    { axis: 'x', at: 256, from: 28, to: 92 },
  ],
  parks: [
    { name: 'Desert Links', x: 94, y: 78.5, w: 28, d: 25, trees: 16, tree: 'desert-palm' },
    // Open paving on the camera side of the canopy, so the vault is not walled in
    { name: 'Fremont Plaza', x: 63, y: 19.4, w: 26.2, d: 9, cover: 'gravel' },
    { name: 'Fountain Promenade', x: 40.5, y: 169, w: 16, d: 24, cover: 'gravel' },
  ],
  fountains: [
    { x0: 47.5, y0: 174, x1: 47.5, y1: 188, jets: 9, height: 9 },
    { x0: 52, y0: 176.5, x1: 52, y1: 185.5, jets: 5, height: 5 },
  ],
  canopies: [
    { name: 'Fremont Street canopy', axis: 'x', at: 16, from: 64, to: 88, halfWidth: 3.4, height: 6.5, color: 0xdfe6f2 },
  ],
  landmarks: [
    { buildingId: 'strat-needle-tower', label: 'The Strat', x: 45.6, y: 56 },
    { buildingId: 'desert-orb-arena', label: 'The Sphere', x: 100.5, y: 113.5, clear: 6, view: 14 },
    { buildingId: 'venetian-campanile-resort', label: 'The Venetian', x: 66.6, y: 113 },
    { buildingId: 'caesars-forum-palace', label: 'Caesars Palace', x: 35, y: 144 },
    { buildingId: 'bellagio-crescent-resort', label: 'The Bellagio', x: 30.6, y: 169.5 },
    { buildingId: 'paris-lattice-tower', label: 'Eiffel Tower', x: 66, y: 172, clear: 7 },
    { buildingId: 'linq-observation-wheel', label: 'High Roller', x: 96, y: 146, clear: 6 },
    { buildingId: 'luxor-glass-pyramid', label: 'The Luxor', x: 25, y: 260.5 },
    { buildingId: 'luxor-sphinx', label: 'Luxor Sphinx', x: 47.6, y: 268.7 },
    { buildingId: 'vegas-welcome-sign', label: 'Welcome Sign', x: 64, y: 298, clear: 3 },
  ],
  cores: [
    // The Strip, Sands to Harmon
    { x: 62, y: 160, r: 42 },
    // Old downtown on Fremont Street
    { x: 76, y: 18, r: 18 },
  ],
  fillCount: 46,
  dollarTarget: 19000,
  timeLimit: 370,
  block: { w: 32, d: 30 },
};
