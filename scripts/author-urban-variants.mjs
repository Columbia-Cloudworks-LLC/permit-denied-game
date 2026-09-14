import { mkdir, writeFile } from 'node:fs/promises';

const f = (kind, x, y, w, d, h = 1) => ({ kind, x, y, w, d, h, rotation: 0 });
const room = (id, kind, x, y, w, d, contents = [], finish = 'linoleum') => ({
  id, kind, floor: 0, x, y, w, d, finish,
  contents: contents.map((v, i) => ({ id: `${id}-${i}`, ...v })),
});
const home = () => [
  room('sleep', 'bedroom', 0, 0, .65, .5, [f('bed', .12, .1, .6, .65, .7)], 'plank'),
  room('bath', 'bathroom', .65, 0, .35, .5, [f('toilet', .15, .1, .4, .4, .7)], 'tile'),
  room('living', 'living', 0, .5, .65, .5, [f('sofa', .08, .1, .7, .22, .8), f('table', .3, .6, .4, .25, .6)], 'plank'),
  room('kitchen', 'kitchen', .65, .5, .35, .5, [f('counter', .05, .1, .25, .8, .8), f('fridge', .65, .1, .25, .3, 1.3)], 'tile'),
];
const studio = () => [
  room('living', 'living', 0, 0, .7, 1, [f('bed', .08, .08, .45, .35, .7), f('sofa', .08, .58, .5, .2, .8)], 'plank'),
  room('bath', 'bathroom', .7, 0, .3, 1, [f('toilet', .15, .15, .45, .3, .7)], 'tile'),
];
const office = () => [
  room('workroom', 'production', 0, 0, .75, 1, [.1, .57].flatMap(x => [.12, .62].map(y => f('office-desk', x, y, .3, .2, .8)))),
  room('files', 'storage', .75, 0, .25, 1, Array.from({ length: 2 }, (_, i) => f('filing-cabinet', .08 + i * .4, .1, .12, .7, 1.3))),
];
const lobby = () => [room('lobby', 'retail', 0, 0, 1, 1, [f('counter', .1, .65, .15, .1, 1)], 'concrete')];
const hall = () => [room('hall', 'living', 0, 0, 1, 1, [], 'linoleum')];
const mech = () => [room('plant', 'storage', 0, 0, 1, 1, [f('filing-cabinet', .1, .1, .3, .75, 1.3)], 'concrete')];
const bakery = () => [
  room('sales', 'retail', 0, .6, 1, .4, [f('display-fridge', .08, .12, .45, .25, 1), f('checkout-register', .7, .12, .2, .25, .8)], 'tile'),
  room('bakehouse', 'kitchen', 0, 0, 1, .6, [f('commercial-oven', .08, .1, .3, .25, 1), f('commercial-oven', .6, .1, .3, .25, 1), f('counter', .1, .65, .75, .2, .8)], 'tile'),
];
const laundry = () => [room('laundry', 'retail', 0, 0, 1, 1, [
  f('washer-dryer', .05, .05, .4, .2, 1), f('washer-dryer', .55, .05, .4, .2, 1),
  f('washer-dryer', .05, .7, .4, .2, 1), f('table', .58, .68, .32, .2, .7),
], 'tile')];
const grocery = () => [
  room('sales', 'retail', 0, .25, 1, .75, [
    f('shelf', .08, .1, .12, .5, 1.3), f('shelf', .36, .1, .12, .5, 1.3), f('shelf', .64, .1, .12, .5, 1.3),
    f('checkout-register', .55, .8, .3, .12, .85),
  ], 'tile'),
  room('stock', 'storage', 0, 0, 1, .25, [f('pallet', .1, .1, .3, .65, .8), f('pallet', .55, .1, .3, .65, .8)], 'concrete'),
];

const adjacent = (a, b) => a.floor === b.floor && (
  ((Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6) && Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 1e-6) ||
  ((Math.abs(a.y + a.d - b.y) < 1e-6 || Math.abs(b.y + b.d - a.y) < 1e-6) && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6));
const doors = rooms => rooms.flatMap((a, i) => rooms.slice(i + 1).filter(b => adjacent(a, b)).map(b => ({ a: a.id, b: b.id, at: .5, width: .35 })));

function stairRun(id, floors, w, d, hall) {
  const wide = hall.w >= 5;
  const voidX = wide ? hall.x + 1 : hall.x;
  const voidW = wide ? 3 : 1;
  const stairs = Array.from({ length: floors - 1 }, (_, floor) => ({
    a: `${id}/${floor}/hall`,
    b: `${id}/${floor + 1}/hall`,
    x: (voidX + 0.05) / w,
    y: (hall.y + 0.05 + (floor % 2)) / d,
    w: (voidW - 0.1) / w,
    d: 0.9 / d,
    rotation: 90,
  }));
  const floorVoids = Array.from({ length: floors - 1 }, (_, floor) => ({
    floor: floor + 1,
    x: voidX,
    y: hall.y + (floor % 2),
    w: voidW,
    d: 1,
  }));
  return { stairs, floorVoids };
}

function connectHomes(sectionIds, stairId, floors, roomId = 'living') {
  return Array.from({ length: floors }, (_, floor) => sectionIds.map(id => {
    const room = typeof roomId === 'string' ? roomId : (roomId[id] ?? 'living');
    return {
      a: `${id}/${floor}/${room}`,
      b: `${stairId}/${floor}/hall`,
      at: 0.5,
      width: 0.3,
    };
  })).flat();
}

function coreSupports(w, d) {
  const xs = [Math.floor(w * 0.3), Math.floor(w * 0.5), Math.floor(w * 0.7)];
  const ys = [Math.floor(d * 0.35), Math.floor(d * 0.65)];
  const supports = [];
  for (const x of xs) {
    for (const y of ys) {
      if (x <= 0 || y <= 0 || x >= w - 1 || y >= d - 1) continue;
      if (supports.some(s => s.x === x && s.y === y)) continue;
      supports.push({ x, y, weight: x === xs[1] && y === ys[0] ? 2 : 1 });
    }
  }
  while (supports.length < 3) supports.push({ x: 2, y: 2 + supports.length, weight: 1 });
  return supports.slice(0, 8);
}

function campaign(family, levels, extra = {}) {
  return { family, levels, ...extra };
}

const cityMid = { 'city-borough': 2, 'city-downtown': 2 };
const citySky = { 'city-downtown': 2 };

function baseDef(id, label, group, construction, roof, theme, w, d, floors, extras) {
  return {
    version: 1,
    id,
    label,
    w,
    d,
    floors,
    kind: group === 'residential' ? 'house' : 'shop',
    construction,
    roof,
    theme,
    windowStride: extras.windowStride ?? 2,
    features: {
      porch: false,
      awning: !!extras.awning,
      parapet: roof === 'flat',
      chimney: !!extras.chimney,
      garage: false,
    },
    zones: { residential: 0, commercial: 0, industrial: 0 },
    traits: {
      use: [extras.family],
      form: extras.form,
      style: [theme],
      scale: [floors >= 20 ? 'skyscraper' : 'mid-rise'],
    },
    partitions: true,
    campaign: campaign(extras.family, extras.levels, extras.campaignExtra),
    openings: extras.openings ?? [{ floor: 0, side: 'south', at: extras.doorAt ?? 0.5, kind: 'door' }],
    ...extras.more,
  };
}

const packages = [];

function add(pkg) {
  packages.push(pkg);
}

add({
  group: 'residential',
  def: baseDef('walkup-block', 'WALKUP BLOCK', 'residential', 'concrete-bearing', 'flat', 'walkup', 5, 8, 6, {
    family: 'urban-apartment', form: ['narrow-slab', 'rear-stair'], levels: cityMid, doorAt: 0.28, chimney: true,
  }),
  layouts: { home: home(), 'stair-hall': hall() },
  sections: [
    { id: 'home', role: 'apartments', x: 0, y: 0, w: 5, d: 6, floor: 0, floors: 6, layout: 'home.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 6, w: 5, d: 2, floor: 0, floors: 6, layout: 'stair-hall.layout.json' },
  ],
  connections: connectHomes(['home'], 'stair-hall', 6),
  circulation: stairRun('stair-hall', 6, 5, 8, { x: 0, y: 6, w: 5, d: 2 }),
});

add({
  group: 'residential',
  def: baseDef('avenue-apartments', 'AVENUE APARTMENTS', 'residential', 'concrete-bearing', 'flat', 'civic', 9, 6, 7, {
    family: 'urban-apartment', form: ['wide-bar', 'center-stair'], levels: cityMid, doorAt: 0.5, windowStride: 3,
  }),
  layouts: { 'west-home': home(), 'east-home': home(), 'stair-hall': hall() },
  sections: [
    { id: 'west-home', role: 'apartments', x: 0, y: 0, w: 3, d: 6, floor: 0, floors: 7, layout: 'west-home.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 3, y: 0, w: 3, d: 6, floor: 0, floors: 7, layout: 'stair-hall.layout.json' },
    { id: 'east-home', role: 'apartments', x: 6, y: 0, w: 3, d: 6, floor: 0, floors: 7, layout: 'east-home.layout.json' },
  ],
  connections: connectHomes(['west-home', 'east-home'], 'stair-hall', 7, { 'west-home': 'kitchen', 'east-home': 'living' }),
  circulation: stairRun('stair-hall', 7, 9, 6, { x: 3, y: 0, w: 3, d: 6 }),
});

add({
  group: 'residential',
  def: {
    ...baseDef('terrace-apartments', 'TERRACE APARTMENTS', 'residential', 'concrete-bearing', 'flat', 'walkup', 6, 8, 8, {
      family: 'urban-apartment', form: ['side-stair', 'deep-stack'], levels: cityMid, doorAt: 0.16, chimney: true,
    }),
    facadeDetails: [
      { id: 'escape-1', kind: 'fire-escape', floor: 1, gx: 4, gy: 7, side: 'south', width: 2 },
      { id: 'escape-2', kind: 'fire-escape', floor: 3, gx: 4, gy: 7, side: 'south', width: 2 },
    ],
  },
  layouts: { home: home(), 'stair-hall': hall() },
  sections: [
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 0, w: 2, d: 8, floor: 0, floors: 8, layout: 'stair-hall.layout.json' },
    { id: 'home', role: 'apartments', x: 2, y: 0, w: 4, d: 8, floor: 0, floors: 8, layout: 'home.layout.json' },
  ],
  connections: connectHomes(['home'], 'stair-hall', 8),
  circulation: stairRun('stair-hall', 8, 6, 8, { x: 0, y: 0, w: 2, d: 8 }),
});

add({
  group: 'commercial',
  def: {
    ...baseDef('bakery-walkup', 'BAKERY WALKUP', 'commercial', 'brick-mixed-use', 'flat', 'storefront', 6, 7, 5, {
      family: 'mixed-use', form: ['shop-base', 'dual-walkup'], levels: cityMid, doorAt: 0.32, awning: true,
    }),
    facadeDetails: [
      { id: 'bakery-sign', kind: 'signboard', floor: 0, gx: 1, gy: 6, side: 'south', width: 3, text: 'BAKERY' },
      { id: 'west-display', kind: 'display-glazing', floor: 0, gx: 0, gy: 6, side: 'south', width: 2 },
      { id: 'east-display', kind: 'display-glazing', floor: 0, gx: 4, gy: 6, side: 'south', width: 2 },
    ],
  },
  layouts: { shop: bakery(), 'west-home': home(), 'east-home': home(), 'stair-hall': hall() },
  sections: [
    { id: 'shop', role: 'retail', x: 0, y: 0, w: 6, d: 5, floor: 0, floors: 1, layout: 'shop.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 5, w: 6, d: 2, floor: 0, floors: 5, layout: 'stair-hall.layout.json' },
    { id: 'west-home', role: 'apartments', x: 0, y: 0, w: 3, d: 5, floor: 1, floors: 4, layout: 'west-home.layout.json' },
    { id: 'east-home', role: 'apartments', x: 3, y: 0, w: 3, d: 5, floor: 1, floors: 4, layout: 'east-home.layout.json' },
  ],
  connections: [
    { a: 'shop/0/sales', b: 'stair-hall/0/hall', at: 0.5, width: 0.35 },
    ...connectHomes(['west-home', 'east-home'], 'stair-hall', 5).filter(c => !c.a.includes('/0/')),
  ],
  circulation: stairRun('stair-hall', 5, 6, 7, { x: 0, y: 5, w: 6, d: 2 }),
});

add({
  group: 'commercial',
  def: {
    ...baseDef('laundry-lofts', 'LAUNDRY LOFTS', 'commercial', 'brick-mixed-use', 'flat', 'storefront', 7, 6, 6, {
      family: 'mixed-use', form: ['shop-base', 'wide-loft'], levels: cityMid, doorAt: 0.58, windowStride: 3, awning: true,
    }),
    facadeDetails: [
      { id: 'laundry-sign', kind: 'signboard', floor: 0, gx: 2, gy: 5, side: 'south', width: 3, text: 'LAUNDRY' },
    ],
  },
  layouts: { shop: laundry(), loft: home(), 'stair-hall': hall() },
  sections: [
    { id: 'shop', role: 'retail', x: 0, y: 0, w: 7, d: 4, floor: 0, floors: 1, layout: 'shop.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 4, w: 7, d: 2, floor: 0, floors: 6, layout: 'stair-hall.layout.json' },
    { id: 'loft', role: 'apartments', x: 0, y: 0, w: 7, d: 4, floor: 1, floors: 5, layout: 'loft.layout.json' },
  ],
  connections: [
    { a: 'shop/0/laundry', b: 'stair-hall/0/hall', at: 0.5, width: 0.35 },
    ...connectHomes(['loft'], 'stair-hall', 6).filter(c => !c.a.includes('/0/')),
  ],
  circulation: stairRun('stair-hall', 6, 7, 6, { x: 0, y: 4, w: 7, d: 2 }),
});

add({
  group: 'commercial',
  def: {
    ...baseDef('market-apartments', 'MARKET APARTMENTS', 'commercial', 'brick-mixed-use', 'flat', 'storefront', 8, 7, 8, {
      family: 'mixed-use', form: ['shop-base', 'dual-stack'], levels: cityMid, doorAt: 0.4, awning: true,
    }),
    facadeDetails: [
      { id: 'market-sign', kind: 'signboard', floor: 0, gx: 2, gy: 6, side: 'south', width: 4, text: 'MARKET' },
      { id: 'west-display', kind: 'display-glazing', floor: 0, gx: 0, gy: 6, side: 'south', width: 2 },
      { id: 'east-display', kind: 'display-glazing', floor: 0, gx: 6, gy: 6, side: 'south', width: 2 },
    ],
  },
  layouts: { shop: grocery(), 'west-home': home(), 'east-home': home(), 'stair-hall': hall() },
  sections: [
    { id: 'shop', role: 'retail', x: 0, y: 0, w: 8, d: 5, floor: 0, floors: 1, layout: 'shop.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 5, w: 8, d: 2, floor: 0, floors: 8, layout: 'stair-hall.layout.json' },
    { id: 'west-home', role: 'apartments', x: 0, y: 0, w: 4, d: 5, floor: 1, floors: 7, layout: 'west-home.layout.json' },
    { id: 'east-home', role: 'apartments', x: 4, y: 0, w: 4, d: 5, floor: 1, floors: 7, layout: 'east-home.layout.json' },
  ],
  connections: [
    { a: 'shop/0/sales', b: 'stair-hall/0/hall', at: 0.5, width: 0.35 },
    ...connectHomes(['west-home', 'east-home'], 'stair-hall', 8).filter(c => !c.a.includes('/0/')),
  ],
  circulation: stairRun('stair-hall', 8, 8, 7, { x: 0, y: 5, w: 8, d: 2 }),
});

add({
  group: 'residential',
  def: baseDef('courtyard-midrise', 'COURTYARD MIDRISE', 'residential', 'brick-mixed-use', 'flat', 'walkup', 9, 9, 7, {
    family: 'courtyard-apartment', form: ['u-court', 'shared-hall'], levels: cityMid, doorAt: 0.18,
    more: { openings: [{ floor: 0, side: 'south', at: 0.18, kind: 'door', cell: { x: 1, y: 8 } }] },
  }),
  layouts: { 'rear-1': home(), 'rear-2': home(), 'rear-3': home(), west: home(), east: home(), 'shared-hall': hall() },
  sections: [
    { id: 'rear-1', role: 'rear', x: 0, y: 0, w: 3, d: 3, floor: 0, floors: 7, layout: 'rear-1.layout.json' },
    { id: 'rear-2', role: 'rear', x: 3, y: 0, w: 3, d: 3, floor: 0, floors: 7, layout: 'rear-2.layout.json' },
    { id: 'rear-3', role: 'rear', x: 6, y: 0, w: 3, d: 3, floor: 0, floors: 7, layout: 'rear-3.layout.json' },
    { id: 'shared-hall', role: 'shared-circulation', x: 0, y: 3, w: 9, d: 2, floor: 0, floors: 7, layout: 'shared-hall.layout.json' },
    { id: 'west', role: 'west', x: 0, y: 5, w: 3, d: 4, floor: 0, floors: 7, layout: 'west.layout.json' },
    { id: 'east', role: 'east', x: 6, y: 5, w: 3, d: 4, floor: 0, floors: 7, layout: 'east.layout.json' },
  ],
  connections: connectHomes(['rear-1', 'rear-2', 'rear-3', 'west', 'east'], 'shared-hall', 7, {
    'rear-1': 'living', 'rear-2': 'living', 'rear-3': 'living', west: 'sleep', east: 'sleep',
  }),
  circulation: stairRun('shared-hall', 7, 9, 9, { x: 0, y: 3, w: 9, d: 2 }),
});

add({
  group: 'residential',
  def: baseDef('corner-apartments', 'CORNER APARTMENTS', 'residential', 'brick-mixed-use', 'flat', 'walkup', 8, 8, 8, {
    family: 'courtyard-apartment', form: ['l-plan', 'corner-entry'], levels: cityMid, doorAt: 0.82,
  }),
  layouts: { south: home(), east: home(), 'stair-hall': hall() },
  sections: [
    { id: 'south', role: 'south-wing', x: 0, y: 5, w: 5, d: 3, floor: 0, floors: 8, layout: 'south.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 5, y: 5, w: 3, d: 3, floor: 0, floors: 8, layout: 'stair-hall.layout.json' },
    { id: 'east', role: 'east-wing', x: 5, y: 0, w: 3, d: 5, floor: 0, floors: 8, layout: 'east.layout.json' },
  ],
  connections: connectHomes(['south', 'east'], 'stair-hall', 8, { south: 'kitchen', east: 'living' }),
  circulation: stairRun('stair-hall', 8, 8, 8, { x: 5, y: 5, w: 3, d: 3 }),
});

add({
  group: 'residential',
  def: baseDef('stepped-apartments', 'STEPPED APARTMENTS', 'residential', 'concrete-bearing', 'flat', 'walkup', 9, 7, 10, {
    family: 'courtyard-apartment', form: ['stepped', 'inset-crown'], levels: cityMid, doorAt: 0.5,
  }),
  layouts: {
    'base-west': home(), 'base-mid': home(), 'base-east': home(),
    'top-west': home(), 'top-east': home(), 'stair-hall': hall(),
  },
  sections: [
    { id: 'base-west', role: 'apartments', x: 0, y: 0, w: 3, d: 5, floor: 0, floors: 6, layout: 'base-west.layout.json' },
    { id: 'base-mid', role: 'apartments', x: 3, y: 0, w: 3, d: 5, floor: 0, floors: 6, layout: 'base-mid.layout.json' },
    { id: 'base-east', role: 'apartments', x: 6, y: 0, w: 3, d: 5, floor: 0, floors: 6, layout: 'base-east.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 5, w: 9, d: 2, floor: 0, floors: 10, layout: 'stair-hall.layout.json' },
    { id: 'top-west', role: 'apartments', x: 1, y: 1, w: 3, d: 4, floor: 6, floors: 4, layout: 'top-west.layout.json' },
    { id: 'top-east', role: 'apartments', x: 5, y: 1, w: 3, d: 4, floor: 6, floors: 4, layout: 'top-east.layout.json' },
  ],
  connections: [
    ...connectHomes(['base-west', 'base-mid', 'base-east'], 'stair-hall', 6),
    ...Array.from({ length: 4 }, (_, i) => {
      const floor = 6 + i;
      return ['top-west', 'top-east'].map(id => ({
        a: `${id}/${floor}/living`, b: `stair-hall/${floor}/hall`, at: 0.5, width: 0.3,
      }));
    }).flat(),
  ],
  circulation: stairRun('stair-hall', 10, 9, 7, { x: 0, y: 5, w: 9, d: 2 }),
});

add({
  group: 'commercial',
  def: baseDef('office-slab-eight', 'OFFICE SLAB EIGHT', 'commercial', 'concrete-bearing', 'flat', 'civic', 8, 5, 8, {
    family: 'midrise-office', form: ['slab', 'compact'], levels: cityMid,
  }),
  layouts: { offices: office() },
  sections: [{ id: 'offices', role: 'offices', x: 0, y: 0, w: 8, d: 5, floor: 0, floors: 8, layout: 'offices.layout.json' }],
  connections: [],
});

add({
  group: 'commercial',
  def: baseDef('office-stepped-ten', 'OFFICE STEPPED TEN', 'commercial', 'concrete-bearing', 'flat', 'civic', 10, 7, 10, {
    family: 'midrise-office', form: ['stepped', 'setback'], levels: cityMid, windowStride: 3,
  }),
  layouts: { base: office(), middle: office(), top: office() },
  sections: [
    { id: 'base', role: 'base', x: 0, y: 0, w: 10, d: 7, floor: 0, floors: 4, layout: 'base.layout.json' },
    { id: 'middle', role: 'middle', x: 1, y: 1, w: 8, d: 5, floor: 4, floors: 3, layout: 'middle.layout.json' },
    { id: 'top', role: 'top', x: 2, y: 2, w: 6, d: 3, floor: 7, floors: 3, layout: 'top.layout.json' },
  ],
  connections: [],
});

add({
  group: 'commercial',
  def: baseDef('office-compact-twelve', 'OFFICE COMPACT TWELVE', 'commercial', 'concrete-bearing', 'flat', 'civic', 6, 6, 12, {
    family: 'midrise-office', form: ['point-tower', 'square'], levels: cityMid, windowStride: 3,
  }),
  layouts: { tower: office() },
  sections: [{ id: 'tower', role: 'tower', x: 0, y: 0, w: 6, d: 6, floor: 0, floors: 12, layout: 'tower.layout.json' }],
  connections: [],
});

function skyOffice(id, label, w, d, floors, sections, form) {
  const def = baseDef(id, label, 'commercial', 'concrete-bearing', 'flat', 'civic', w, d, floors, {
    family: 'office-skyscraper', form, levels: citySky, campaignExtra: { maxRepeats: 3 },
  });
  def.coreCollapse = {
    supports: coreSupports(w, d),
    capacityThreshold: 0.45,
    warningDuration: 1.1,
    duration: 5,
  };
  const layouts = {};
  for (const s of sections) layouts[s.id] = s.id === 'podium' || s.id === 'base' ? lobby() : s.id === 'mechanical' || s.id === 'mech' ? mech() : office();
  add({ group: 'commercial', def, layouts, sections: sections.map(s => ({ ...s, layout: `${s.id}.layout.json` })), connections: [] });
}

skyOffice('plaza-office-tower', 'PLAZA OFFICE TOWER', 10, 8, 22, [
  { id: 'podium', role: 'podium', x: 0, y: 0, w: 10, d: 8, floor: 0, floors: 3 },
  { id: 'tower', role: 'tower', x: 2, y: 1, w: 6, d: 6, floor: 3, floors: 18 },
  { id: 'mechanical', role: 'mechanical', x: 2, y: 1, w: 6, d: 6, floor: 21, floors: 1 },
], ['podium', 'shaft']);

skyOffice('needle-office', 'NEEDLE OFFICE', 8, 7, 26, [
  { id: 'podium', role: 'podium', x: 0, y: 0, w: 8, d: 7, floor: 0, floors: 2 },
  { id: 'tower', role: 'tower', x: 1, y: 1, w: 5, d: 5, floor: 2, floors: 23 },
  { id: 'mechanical', role: 'mechanical', x: 1, y: 1, w: 5, d: 5, floor: 25, floors: 1 },
], ['podium', 'needle']);

skyOffice('setback-office-tower', 'SETBACK OFFICE TOWER', 10, 8, 24, [
  { id: 'base', role: 'base', x: 0, y: 0, w: 10, d: 8, floor: 0, floors: 4 },
  { id: 'middle', role: 'middle', x: 1, y: 1, w: 8, d: 6, floor: 4, floors: 10 },
  { id: 'top', role: 'top', x: 2, y: 2, w: 6, d: 5, floor: 14, floors: 9 },
  { id: 'mechanical', role: 'mechanical', x: 2, y: 2, w: 6, d: 5, floor: 23, floors: 1 },
], ['setback', 'tiered']);

add({
  group: 'residential',
  def: baseDef('residence-tower', 'RESIDENCE TOWER', 'residential', 'concrete-bearing', 'flat', 'walkup', 7, 7, 20, {
    family: 'residential-skyscraper', form: ['twin-home', 'rear-hall'], levels: citySky, doorAt: 4.5 / 7, campaignExtra: { maxRepeats: 3 },
  }),
  layouts: { 'west-home': home(), 'east-home': home(), 'stair-hall': hall() },
  sections: [
    { id: 'west-home', role: 'apartments', x: 0, y: 0, w: 3, d: 5, floor: 0, floors: 20, layout: 'west-home.layout.json' },
    { id: 'east-home', role: 'apartments', x: 3, y: 0, w: 4, d: 5, floor: 0, floors: 20, layout: 'east-home.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 5, w: 7, d: 2, floor: 0, floors: 20, layout: 'stair-hall.layout.json' },
  ],
  connections: connectHomes(['west-home', 'east-home'], 'stair-hall', 20),
});

add({
  group: 'residential',
  def: baseDef('twin-residence', 'TWIN RESIDENCE', 'residential', 'concrete-bearing', 'flat', 'walkup', 9, 7, 22, {
    family: 'residential-skyscraper', form: ['triple-stack', 'wide-bar'], levels: citySky, doorAt: 0.5, campaignExtra: { maxRepeats: 3 },
  }),
  layouts: { west: studio(), mid: studio(), east: studio(), 'stair-hall': hall() },
  sections: [
    { id: 'west', role: 'apartments', x: 0, y: 0, w: 3, d: 5, floor: 0, floors: 22, layout: 'west.layout.json' },
    { id: 'mid', role: 'apartments', x: 3, y: 0, w: 3, d: 5, floor: 0, floors: 22, layout: 'mid.layout.json' },
    { id: 'east', role: 'apartments', x: 6, y: 0, w: 3, d: 5, floor: 0, floors: 22, layout: 'east.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 5, w: 9, d: 2, floor: 0, floors: 22, layout: 'stair-hall.layout.json' },
  ],
  connections: connectHomes(['west', 'mid', 'east'], 'stair-hall', 22),
});

{
  const def = baseDef('crown-apartments', 'CROWN APARTMENTS', 'residential', 'concrete-bearing', 'flat', 'walkup', 8, 8, 24, {
    family: 'residential-skyscraper', form: ['podium', 'crown'], levels: citySky, doorAt: 0.5, campaignExtra: { maxRepeats: 3 },
  });
  def.coreCollapse = {
    supports: coreSupports(8, 8),
    capacityThreshold: 0.45,
    warningDuration: 1.1,
    duration: 5,
  };
  add({
    group: 'residential',
    def,
    layouts: {
      'podium-north': lobby(),
      'podium-sw': lobby(),
      'podium-se': lobby(),
      'west-home': home(),
      'east-home': home(),
      'stair-hall': hall(),
      mechanical: mech(),
    },
    sections: [
      { id: 'podium-north', role: 'podium', x: 0, y: 0, w: 8, d: 5, floor: 0, floors: 3, layout: 'podium-north.layout.json' },
      { id: 'podium-sw', role: 'podium', x: 0, y: 5, w: 1, d: 3, floor: 0, floors: 3, layout: 'podium-sw.layout.json' },
      { id: 'podium-se', role: 'podium', x: 7, y: 5, w: 1, d: 3, floor: 0, floors: 3, layout: 'podium-se.layout.json' },
      { id: 'stair-hall', role: 'shared-circulation', x: 1, y: 5, w: 6, d: 3, floor: 0, floors: 23, layout: 'stair-hall.layout.json' },
      { id: 'west-home', role: 'apartments', x: 1, y: 1, w: 3, d: 4, floor: 3, floors: 20, layout: 'west-home.layout.json' },
      { id: 'east-home', role: 'apartments', x: 4, y: 1, w: 3, d: 4, floor: 3, floors: 20, layout: 'east-home.layout.json' },
      { id: 'mechanical', role: 'mechanical', x: 2, y: 1, w: 4, d: 3, floor: 23, floors: 1, layout: 'mechanical.layout.json' },
    ],
    connections: [
      ...[0, 1, 2].flatMap(floor => [
        { a: `podium-north/${floor}/lobby`, b: `stair-hall/${floor}/hall`, at: 0.5, width: 0.35 },
        { a: `podium-sw/${floor}/lobby`, b: `stair-hall/${floor}/hall`, at: 0.5, width: 0.35 },
        { a: `podium-se/${floor}/lobby`, b: `stair-hall/${floor}/hall`, at: 0.5, width: 0.35 },
      ]),
      ...Array.from({ length: 20 }, (_, i) => {
        const floor = 3 + i;
        return ['west-home', 'east-home'].map(id => ({
          a: `${id}/${floor}/living`, b: `stair-hall/${floor}/hall`, at: 0.5, width: 0.3,
        }));
      }).flat(),
    ],
  });
}

const refresh = process.argv.find(a => a.startsWith('--refresh='))?.slice(10);
for (const pkg of packages) {
  if (refresh && refresh !== pkg.def.id) continue;
  const path = `src/world/data/buildings/${pkg.group}/${pkg.def.id}`;
  await mkdir(path, { recursive: true });
  const definition = {
    ...pkg.def,
    sections: pkg.sections,
    connections: pkg.connections ?? [],
    stairs: pkg.circulation?.stairs,
    floorVoids: pkg.circulation?.floorVoids,
  };
  await writeFile(`${path}/main.building.json`, `${JSON.stringify(definition, null, 2)}\n`);
  for (const [name, rooms] of Object.entries(pkg.layouts)) {
    await writeFile(`${path}/${name}.layout.json`, `${JSON.stringify({ partitions: true, rooms, connections: doors(rooms) }, null, 2)}\n`);
  }
  console.log(pkg.def.id);
}
