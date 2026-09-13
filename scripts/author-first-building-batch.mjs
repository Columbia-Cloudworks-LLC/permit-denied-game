import { rowhouseAccess } from './rowhouse-access-recipe.mjs';
import { motelAccess } from './motel-access-recipe.mjs';
import { independentDuplex } from './independent-duplex-recipe.mjs';
// Explicit blueprints for the first approved backlog batch. Re-running is opt-in:
// this authoring utility never runs as part of builds or tests.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { buildingDetails } from './building-detail-recipes.mjs';
const fixture = (kind, x, y, w, d, h = .8) => ({ kind, x, y, w, d, h, rotation: 0 });
const room = (id, kind, x, y, w, d, contents, finish = 'plank') => ({ id, kind, floor: 0, x, y, w, d, finish,
  contents: contents.map((f, i) => ({ id: `${id}-${i}`, ...f })) });
const full = (id, kind, contents, finish = 'concrete') => room(id, kind, 0, 0, 1, 1, contents, finish);
const section = (id, x, y, w, d, floor, floors, rooms) => ({ id, role: id, x, y, w, d, floor, floors, rooms });
const table = (x, y) => fixture('table', x, y, .2, .15, .65);
const shelf = (x, y, w = .15, d = .65) => fixture('shelf', x, y, w, d, 1.3);
const domestic = () => [
  room('living', 'living', 0, .5, .6, .5, [fixture('sofa', .1, .1, .65, .25), table(.4, .55)]),
  room('kitchen', 'kitchen', .6, .5, .4, .5, [fixture('counter', .05, .1, .2, .8), fixture('fridge', .6, .1, .25, .25, 1.2)], 'linoleum'),
  room('bedroom', 'bedroom', 0, 0, .6, .5, [fixture('bed', .15, .12, .55, .6, .65)]),
  room('bath', 'bathroom', .6, 0, .4, .5, [fixture('toilet', .15, .12, .3, .3)], 'tile'),
];
const office = () => [
  room('workroom', 'production', 0, 0, .75, 1, [table(.15, .15), table(.6, .15), table(.15, .6), table(.6, .6)], 'linoleum'),
  room('records', 'storage', .75, 0, .25, 1, [shelf(.1, .1, .3, .75)], 'linoleum'),
];
const adjacent = (a, b) => a.floor === b.floor && (
  ((Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6) && Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 1e-6) ||
  ((Math.abs(a.y + a.d - b.y) < 1e-6 || Math.abs(b.y + b.d - a.y) < 1e-6) && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6));
const connections = rooms => rooms.flatMap((a, i) => rooms.slice(i + 1).filter(b => adjacent(a, b)).map(b => ({ a: a.id, b: b.id, at: .5, width: .35 })));
const blueprints = [
  { id: 'detached-garage', backlog: 'B01', label: 'DETACHED GARAGE', group: 'residential', kind: 'house', w: 4, d: 4, roof: 'gable', theme: 'ranch', construction: 'timber-house', doors: [[.5, 'loading']], sections: [
    section('garage', 0, 0, 4, 4, 0, 1, [full('workshop', 'storage', [shelf(.08, .08), fixture('table', .4, .08, .45, .15, .65)])]),
  ] },
  { id: 'side-by-side-duplex', backlog: 'B02', label: 'SIDE BY SIDE DUPLEX', group: 'residential', kind: 'house', w: 8, d: 5, roof: 'gable', theme: 'colonial', construction: 'brick-mixed-use', doors: [[.25, 'door'], [.75, 'door']], sections: [
    section('west-home', 0, 0, 4, 5, 0, 2, domestic()), section('east-home', 4, 0, 4, 5, 0, 2, domestic()),
  ] },
  { id: 'auto-repair-shop', backlog: 'B21', label: 'TWO BAY AUTO REPAIR', group: 'industrial', kind: 'industrial', w: 10, d: 6, roof: 'flat', theme: 'warehouse', construction: 'steel-hall', doors: [[.2, 'loading'], [.55, 'loading'], [.9, 'door']], sections: [
    section('service-bays', 0, 0, 7, 6, 0, 1, [full('workshop', 'production', [fixture('machine', .1, .2, .2, .3, 1.2), fixture('machine', .55, .2, .2, .3, 1.2), shelf(.08, .05, .75, .08)])]),
    section('office-parts', 7, 0, 3, 6, 0, 1, [room('parts', 'storage', 0, 0, 1, .5, [shelf(.1, .1), shelf(.7, .1)], 'concrete'), room('office', 'retail', 0, .5, 1, .5, [fixture('counter', .1, .1, .7, .2), table(.3, .6)], 'linoleum')]),
  ] },
  { id: 'gable-barn', backlog: 'B31', label: 'GABLE BARN', group: 'agricultural', kind: 'house', w: 8, d: 10, roof: 'gable', theme: 'ranch', construction: 'timber-house', doors: [[.5, 'loading']], sections: [
    section('barn', 0, 0, 8, 10, 0, 1, [room('west-store', 'storage', 0, 0, .3, 1, [fixture('pallet', .15, .1, .6, .25), fixture('pallet', .15, .55, .6, .25)]), room('aisle', 'production', .3, 0, .4, 1, []), room('east-store', 'storage', .7, 0, .3, 1, [shelf(.1, .1, .35, .7)])]),
  ] },
  { id: 'roadside-diner', backlog: 'B11', label: 'ROADSIDE DINER', group: 'commercial', kind: 'shop', w: 10, d: 4, roof: 'flat', theme: 'storefront', construction: 'brick-mixed-use', doors: [[.45, 'door']], sections: [
    section('diner', 0, 0, 10, 4, 0, 1, [room('dining', 'retail', 0, 0, .7, 1, [fixture('sofa', .1, .1, .2, .18), table(.12, .38), fixture('sofa', .45, .1, .2, .18), table(.48, .38), fixture('counter', .08, .75, .8, .12)], 'tile'), room('kitchen', 'kitchen', .7, 0, .3, 1, [fixture('counter', .1, .1, .2, .7), fixture('fridge', .65, .1, .25, .3, 1.3)], 'tile')]),
  ] },
  { id: 'self-storage-row', backlog: 'B22', label: 'SELF STORAGE ROW', group: 'industrial', kind: 'industrial', w: 12, d: 3, roof: 'shed', theme: 'warehouse', construction: 'steel-hall', doors: Array.from({ length: 4 }, (_, i) => [(i + .5) / 4, 'loading']), sections: Array.from({ length: 4 }, (_, i) => section(`unit-${i + 1}`, i * 3, 0, 3, 3, 0, 1, [full('storage', 'storage', [fixture('pallet', .1, .1, .35, .3), shelf(.7, .1, .15, .55)])])) },
  { id: 'rowhouse-unit', backlog: 'B04', label: 'BRICK ROWHOUSE', group: 'residential', kind: 'house', w: 3, d: 7, roof: 'flat', theme: 'corner', construction: 'brick-mixed-use', doors: [[.5, 'door']], sections: [section('home', 0, 0, 3, 7, 0, 3, domestic())] },
  { id: 'small-grocery', backlog: 'B12', label: 'NEIGHBORHOOD GROCERY', group: 'commercial', kind: 'shop', w: 8, d: 7, roof: 'flat', theme: 'storefront', construction: 'brick-mixed-use', doors: [[.3, 'door'], [.85, 'loading']], sections: [
    section('grocery', 0, 0, 8, 7, 0, 1, [room('sales', 'retail', 0, .25, 1, .75, [shelf(.12, .08, .08, .55), shelf(.4, .08, .08, .55), shelf(.68, .08, .08, .55), fixture('counter', .55, .8, .3, .1)], 'tile'), room('stock', 'storage', 0, 0, 1, .25, [fixture('pallet', .1, .1, .18, .7), fixture('fridge', .6, .1, .25, .65, 1.3)], 'concrete')]),
  ] },
  { id: 'farm-equipment-shed', backlog: 'B32', label: 'FARM EQUIPMENT SHED', group: 'agricultural', kind: 'industrial', w: 12, d: 6, roof: 'shed', theme: 'warehouse', construction: 'steel-hall', doors: [[.25, 'loading'], [.75, 'loading']], sections: [
    section('equipment', 0, 0, 12, 6, 0, 1, [full('machinery', 'production', [fixture('machine', .12, .2, .16, .3, 1.3), fixture('machine', .5, .15, .22, .3, 1.4), fixture('rack', .05, .02, .8, .08, 1.6)])]),
  ] },
  { id: 'permit-office', backlog: 'B41', label: 'PERMIT OFFICE', group: 'civic', kind: 'shop', w: 8, d: 6, roof: 'flat', theme: 'civic', construction: 'concrete-bearing', doors: [[.5, 'door']], sections: [
    section('public', 0, 0, 8, 6, 0, 1, [room('waiting', 'retail', 0, .5, 1, .5, [fixture('sofa', .08, .5, .3, .2), fixture('counter', .15, .05, .7, .15)], 'tile'), room('records', 'storage', 0, 0, 1, .5, [shelf(.1, .1), shelf(.45, .1), shelf(.8, .1)], 'linoleum')]),
    section('offices', 1, 0, 6, 3, 1, 1, office()),
  ] },
  { id: 'motel-room-block', backlog: 'B06', label: 'MOTEL ROOM BLOCK', group: 'residential', kind: 'house', w: 12, d: 4, roof: 'flat', theme: 'walkup', construction: 'brick-mixed-use', doors: [[.125, 'door'], [.375, 'door'], [.625, 'door'], [.875, 'door']], sections: Array.from({ length: 4 }, (_, i) => section(`room-${i + 1}`, i * 3, 0, 3, 4, 0, 2, [room('sleeping', 'bedroom', 0, 0, .7, 1, [fixture('bed', .08, .12, .6, .45, .65), table(.3, .75)]), room('bathroom', 'bathroom', .7, 0, .3, 1, [fixture('toilet', .1, .1, .55, .25)], 'tile')])) },
  { id: 'mid-rise-office-slab', backlog: 'B51', label: 'MID RISE OFFICE SLAB', group: 'commercial', kind: 'shop', w: 9, d: 6, roof: 'flat', theme: 'civic', construction: 'concrete-bearing', doors: [[.5, 'door']], sections: [section('offices', 0, 0, 9, 6, 0, 6, office())] },
];

// Specialized furnishings added with the supporting-asset batch.
for (const b of blueprints) for (const s of b.sections) for (const r of s.rooms) {
  if (b.id === 'roadside-diner' && r.id === 'dining') r.contents = [
    fixture('diner-booth', .05, .08, .3, .55, 1), fixture('diner-booth', .5, .08, .3, .55, 1), fixture('counter', .08, .8, .8, .12, .8),
  ].map((f, i) => ({ id: `dining-${i}`, ...f }));
  if (b.id === 'roadside-diner' && r.id === 'kitchen') r.contents.push({ id: 'oven', ...fixture('commercial-oven', .55, .6, .35, .3, 1) });
  if (b.id === 'auto-repair-shop' && r.id === 'workshop') for (const f of r.contents) if (f.kind === 'machine') f.kind = 'repair-lift';
  if (['permit-office', 'mid-rise-office-slab'].includes(b.id)) for (const f of r.contents) {
    if (f.kind === 'table') f.kind = 'office-desk';
    if (f.kind === 'shelf') f.kind = 'filing-cabinet';
  }
  if (b.id === 'small-grocery') for (const f of r.contents) {
    if (f.kind === 'counter') f.kind = 'checkout-register';
    if (f.kind === 'fridge') f.kind = 'display-fridge';
  }
}

for (const b of blueprints) {
  const dir = `src/world/data/buildings/${b.group}/${b.id}`;
  try { await access(`${dir}/main.building.json`); if (!process.argv.includes('--refresh')) throw new Error(`Refusing to overwrite authored package ${b.id}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dir, { recursive: true });
  const definition = { version: 1, id: b.id, label: b.label, kind: b.kind, w: b.w, d: b.d,
    floors: Math.max(...b.sections.map(s => s.floor + s.floors)), roof: b.roof, theme: b.theme,
    windowStride: b.kind === 'industrial' ? 4 : 2,
    facadeDetails: buildingDetails(b.id, b.d),
    features: { porch: false, awning: b.id === 'roadside-diner', parapet: b.roof === 'flat', chimney: false, garage: false },
    construction: b.construction, zones: { residential: 0, commercial: 0, industrial: 0 },
    traits: { use: [b.id], form: [b.backlog, b.sections.length > 1 ? 'sectioned' : 'single-volume'], scale: [b.w >= 10 ? 'broad' : 'neighborhood'] },
    partitions: true,
    connections: b.id === 'self-storage-row' ? [] : connections(b.sections.flatMap(s => Array.from({ length: s.floors }, (_, i) => s.rooms.map(r => ({ ...r, id: `${s.id}/${s.floor + i}/${r.id}`, section: s.id, floor: s.floor + i, x: (s.x + r.x * s.w) / b.w, y: (s.y + r.y * s.d) / b.d, w: r.w * s.w / b.w, d: r.d * s.d / b.d }))).flat())).filter(c => c.a.split('/')[0] !== c.b.split('/')[0]),
    sections: b.sections.map(({ rooms, ...s }) => ({ ...s, layout: `${s.id}.layout.json` })),
    openings: b.doors.map(([at, kind]) => ({ floor: 0, side: 'south', at, kind })) };
  const layouts = Object.fromEntries(b.sections.map(s => [s.id, {partitions:true, rooms:s.rooms, connections:connections(s.rooms)}]));
  if (b.id === 'side-by-side-duplex') independentDuplex(definition, layouts);
  if (b.id === 'motel-room-block') motelAccess(definition, layouts);
  if (b.id === 'rowhouse-unit') rowhouseAccess(definition, layouts);
  await writeFile(`${dir}/main.building.json`, JSON.stringify(definition, null, 2) + '\n');
  for (const [id, layout] of Object.entries(layouts)) await writeFile(`${dir}/${id}.layout.json`, JSON.stringify(layout, null, 2) + '\n');
  console.log(`${b.backlog}: ${b.id}`);
}
