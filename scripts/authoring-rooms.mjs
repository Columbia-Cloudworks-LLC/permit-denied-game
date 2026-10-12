// Room and fixture builders shared by the opt-in building authoring scripts.
// Coordinates are fractions of the section footprint.

export const fixture = (kind, x, y, w, d, h = 1) => ({ kind, x, y, w, d, h, rotation: 0 });

export const room = (id, kind, x, y, w, d, contents = [], finish = 'linoleum') => ({
  id, kind, floor: 0, x, y, w, d, finish,
  contents: contents.map((v, i) => ({ id: `${id}-${i}`, ...v })),
});

export const homeRooms = () => [
  room('sleep', 'bedroom', 0, 0, .65, .5, [fixture('bed', .12, .1, .6, .65, .7)], 'plank'),
  room('bath', 'bathroom', .65, 0, .35, .5, [fixture('toilet', .15, .1, .4, .4, .7)], 'tile'),
  room('living', 'living', 0, .5, .65, .5, [fixture('sofa', .08, .1, .7, .22, .8), fixture('table', .3, .6, .4, .25, .6)], 'plank'),
  room('kitchen', 'kitchen', .65, .5, .35, .5, [fixture('counter', .05, .1, .25, .8, .8), fixture('fridge', .65, .1, .25, .3, 1.3)], 'tile'),
];

export const bakeryRooms = () => [
  room('sales', 'retail', 0, .6, 1, .4, [fixture('display-fridge', .08, .12, .45, .25, 1), fixture('checkout-register', .7, .12, .2, .25, .8)], 'tile'),
  room('bakehouse', 'kitchen', 0, 0, 1, .6, [fixture('commercial-oven', .08, .1, .3, .25, 1), fixture('commercial-oven', .6, .1, .3, .25, 1), fixture('counter', .1, .65, .75, .2, .8)], 'tile'),
];

export const laundryRooms = () => [room('laundry', 'retail', 0, 0, 1, 1, [
  fixture('washer-dryer', .05, .05, .4, .2, 1), fixture('washer-dryer', .55, .05, .4, .2, 1),
  fixture('washer-dryer', .05, .7, .4, .2, 1), fixture('table', .58, .68, .32, .2, .7),
], 'tile')];

const adjacent = (a, b) => a.floor === b.floor && (
  ((Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6) && Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 1e-6) ||
  ((Math.abs(a.y + a.d - b.y) < 1e-6 || Math.abs(b.y + b.d - a.y) < 1e-6) && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6));

/** A centred door between every pair of rooms that share a wall on the same floor. */
export const roomDoors = rooms => rooms.flatMap((a, i) => rooms.slice(i + 1).filter(b => adjacent(a, b)).map(b => ({ a: a.id, b: b.id, at: .5, width: .35 })));
