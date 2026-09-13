import { apartmentCirculation } from './apartment-circulation-recipe.mjs';
import { towerAccess } from './tower-access-recipe.mjs';
import { hotelAccess } from './hotel-access-recipe.mjs';
import { boardingAccess } from './boarding-access-recipe.mjs';
import { fourplexAccess } from './fourplex-access-recipe.mjs';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { buildingDetails } from './building-detail-recipes.mjs';

// Each entry below owns its generated layouts. Templates describe furnishing
// arrangements, while the explicit sections below describe individual buildings.
const f = (kind, x, y, w, d, h = 1) => ({ kind, x, y, w, d, h, rotation: 0 });
const r = (id, kind, x, y, w, d, contents = [], finish = 'linoleum') => ({ id, kind, floor: 0, x, y, w, d, finish, contents: contents.map((v, i) => ({ id: `${id}-${i}`, ...v })) });
const all = (id, kind, contents, finish) => r(id, kind, 0, 0, 1, 1, contents, finish);
const rows = (kind, count = 3, depth = .7, h = 1.3) => Array.from({ length: count }, (_, i) => f(kind, .08 + i * .85 / count, .1, .12, depth, h));
const desks = () => [.1, .57].flatMap(x => [.12, .62].map(y => f('office-desk', x, y, .3, .2, .8)));
const home = () => [
  r('sleep', 'bedroom', 0, 0, .65, .5, [f('bed', .12, .1, .6, .65, .7)], 'plank'),
  r('bath', 'bathroom', .65, 0, .35, .5, [f('toilet', .15, .1, .4, .4, .7)], 'tile'),
  r('living', 'living', 0, .5, .65, .5, [f('sofa', .08, .1, .7, .22, .8), f('table', .3, .6, .4, .25, .6)], 'plank'),
  r('kitchen', 'kitchen', .65, .5, .35, .5, [f('counter', .05, .1, .25, .8, .8), f('fridge', .65, .1, .25, .3, 1.3)], 'tile'),
];
const recipes = {
  'open-volume':()=>[all('open-volume','living',[],'plank')],
  home,
  sleeping: () => [r('bedroom', 'bedroom', 0, 0, .7, 1, [f('bed', .1, .15, .6, .55, .7)], 'plank'), r('bath', 'bathroom', .7, 0, .3, 1, [f('toilet', .1, .2, .45, .3, .7)], 'tile')],
  lounge: () => [all('common-room', 'living', [f('sofa', .08, .1, .35, .2, .8), f('sofa', .57, .1, .35, .2, .8), f('table', .25, .55, .5, .3, .65)], 'plank')],
  office: () => [r('workroom', 'production', 0, 0, .75, 1, desks()), r('files', 'storage', .75, 0, .25, 1, rows('filing-cabinet', 2))],
  retail: () => [r('sales', 'retail', 0, .25, 1, .75, [...rows('shelf', 3, .5), f('checkout-register', .55, .8, .3, .12, .85)], 'tile'), r('stock', 'storage', 0, 0, 1, .25, rows('pallet', 3, .65, .8), 'concrete')],
  stock: () => [all('stockroom', 'storage', rows('rack', 3), 'concrete')],
  machines: () => [all('work-floor', 'production', [.12, .58].flatMap(x => [.1, .6].map(y => f('machine', x, y, .22, .25, 1.2))), 'concrete')],
  laundry: () => [all('laundry', 'retail', [f('washer-dryer', .05, .05, .4, .2, 1), f('washer-dryer', .55, .05, .4, .2, 1), f('washer-dryer', .05, .7, .4, .2, 1), f('table', .58, .68, .32, .2, .7)], 'tile')],
  bakery: () => [r('sales', 'retail', 0, .6, 1, .4, [f('display-fridge', .08, .12, .45, .25, 1), f('checkout-register', .7, .12, .2, .25, .8)], 'tile'), r('bakehouse', 'kitchen', 0, 0, 1, .6, [f('commercial-oven', .08, .1, .3, .25, 1), f('commercial-oven', .6, .1, .3, .25, 1), f('counter', .1, .65, .75, .2, .8)], 'tile')],
  furniture: () => [all('showroom', 'retail', [f('sofa', .1, .1, .3, .2), f('bed', .6, .08, .25, .3, .7), f('cabinet', .1, .6, .2, .3, 1.2), f('table', .55, .6, .25, .22, .7)], 'plank')],
  nursery: () => [r('plants', 'retail', 0, 0, .75, 1, rows('nursery-bench', 3, .55, 1), 'concrete'), r('supplies', 'storage', .75, 0, .25, 1, rows('shelf', 2), 'concrete')],
  stalls: () => Array.from({ length: 4 }, (_, i) => r(`stall-${i}`, 'storage', i / 4, 0, .25, 1, [f('pallet', .1, .1, .3, .22, .5)], 'plank')),
  packing: () => [r('sorting', 'production', 0, 0, .6, 1, [f('machine', .15, .15, .5, .2, 1), f('machine', .15, .6, .5, .2, 1)], 'concrete'), r('boxes', 'storage', .6, 0, .4, 1, rows('pallet', 2, .6, 1), 'concrete')],
  post: () => [r('counter', 'retail', 0, .65, 1, .35, [f('counter', .1, .05, .8, .22, .8)], 'tile'), r('sorting', 'production', 0, 0, .7, .65, [f('table', .1, .1, .3, .25, .8), f('table', .55, .55, .3, .25, .8)]), r('mail', 'storage', .7, 0, .3, .65, rows('shelf', 2))],
  library: () => [r('stacks', 'storage', 0, 0, .7, 1, rows('shelf', 3)), r('reading', 'living', .7, 0, .3, 1, [f('table', .15, .12, .6, .2, .7), f('table', .15, .62, .6, .2, .7)])],
  garage: () => [all('apparatus-bay', 'production', [f('rack', .08, .05, .8, .12, 1.5), f('machine', .7, .45, .2, .2, 1)], 'concrete')],
  clinic: () => [r('reception', 'retail', 0, .7, 1, .3, [f('counter', .15, .1, .45, .2, .8)], 'tile'), r('exam-west', 'bedroom', 0, 0, .5, .7, [f('examination-table', .2, .15, .5, .5, .8)], 'tile'), r('exam-east', 'bedroom', .5, 0, .5, .7, [f('examination-table', .2, .15, .5, .5, .8)], 'tile')],
  classroom: () => [all('classroom', 'production', [.15, .6].flatMap(y => [f('school-desks', .1, y, .32, .25, .8), f('school-desks', .58, y, .32, .25, .8)]))],
  meeting: () => [all('hall', 'living', [.15, .6].flatMap(y => [f('table', .1, y, .3, .2, .8), f('table', .6, y, .3, .2, .8)]), 'plank')],
  exchange: () => [all('switching-room', 'production', rows('rack', 4, .7, 1.8), 'concrete')],
  pump: () => [all('pump-room', 'production', [f('machine', .1, .12, .3, .6, 1.4), f('machine', .6, .12, .3, .6, 1.4)], 'concrete')],
  kitchen: () => [all('kitchen', 'kitchen', [f('counter', .05, .05, .8, .16, .8), f('fridge', .75, .45, .18, .25, 1.3), f('table', .2, .5, .3, .25, .65)], 'tile')],
  theater: () => [all('auditorium', 'living', [.2, .45, .7].flatMap(y => [f('theater-seats', .08, y, .35, .15, .9), f('theater-seats', .57, y, .35, .15, .9)]), 'plank')],
  cold: () => [all('cold-room', 'storage', rows('display-fridge', 4, .7, 1.5), 'concrete')],
};
const s = (id, x, y, w, d, floor, floors, recipe) => ({ id, role: id, x, y, w, d, floor, floors, recipe });
const plans = [
  ['B03', 'fourplex', 'FOURPLEX', 'residential', 'brick-mixed-use', 'flat', 'colonial', 8, 6, [s('west-units', 0, 0, 4, 6, 0, 2, 'home'), s('east-units', 4, 0, 4, 6, 0, 2, 'home')]],
  ['B07', 'boarding-house', 'BOARDING HOUSE', 'residential', 'timber-house', 'gable', 'porch', 8, 7, [s('commons', 0, 0, 8, 7, 0, 1, 'lounge'), s('west-rooms', 0, 0, 4, 7, 1, 2, 'sleeping'), s('east-rooms', 4, 0, 4, 7, 1, 2, 'sleeping')]],
  ['B08', 'manufactured-home', 'SINGLE WIDE HOME', 'residential', 'timber-house', 'gable', 'ranch', 10, 3, [s('home', 0, 0, 10, 3, 0, 1, 'home')]],
  ['B10', 'stepped-house', 'STEPPED HOUSE', 'residential', 'brick-mixed-use', 'flat', 'colonial', 8, 6, [s('ground', 0, 0, 8, 6, 0, 1, 'home'), s('upper', 0, 0, 4, 6, 1, 1, 'sleeping')]],
  ['B13', 'laundromat', 'LAUNDROMAT', 'commercial', 'brick-mixed-use', 'flat', 'storefront', 6, 5, [s('laundry', 0, 0, 6, 5, 0, 1, 'laundry')]],
  ['B14', 'hardware-store', 'HARDWARE STORE', 'commercial', 'brick-mixed-use', 'flat', 'corner', 5, 9, [s('store', 0, 0, 5, 9, 0, 1, 'retail'), s('stock', 0, 0, 5, 9, 1, 1, 'stock')]],
  ['B15', 'bakery', 'NEIGHBORHOOD BAKERY', 'commercial', 'brick-mixed-use', 'gable', 'storefront', 5, 6, [s('bakery', 0, 0, 5, 6, 0, 1, 'bakery')]],
  ['B17', 'furniture-showroom', 'FURNITURE SHOWROOM', 'commercial', 'steel-hall', 'flat', 'storefront', 11, 8, [s('showroom', 0, 0, 11, 8, 0, 1, 'furniture')]],
  ['B20', 'garden-center-shop', 'GARDEN CENTER', 'commercial', 'timber-house', 'shed', 'storefront', 6, 8, [s('shop', 0, 0, 6, 8, 0, 1, 'nursery')]],
  ['B33', 'stable-block', 'STABLE BLOCK', 'agricultural', 'timber-house', 'gable', 'ranch', 12, 4, [s('stables', 0, 0, 12, 4, 0, 1, 'stalls')]],
  ['B35', 'feed-store', 'FEED STORE', 'agricultural', 'brick-mixed-use', 'gable', 'corner', 6, 7, [s('shop', 0, 0, 6, 7, 0, 1, 'retail'), s('stock', 0, 0, 6, 7, 1, 1, 'stock')]],
  ['B36', 'poultry-house', 'POULTRY HOUSE', 'agricultural', 'timber-house', 'shed', 'ranch', 16, 3, [s('pens', 0, 0, 16, 3, 0, 1, 'stalls')]],
  ['B37', 'orchard-packing-shed', 'ORCHARD PACKING SHED', 'agricultural', 'steel-hall', 'shed', 'warehouse', 10, 7, [s('packing', 0, 0, 10, 7, 0, 1, 'packing')]],
  ['B38', 'farmhouse-rear-wing', 'FARMHOUSE AND REAR WING', 'agricultural', 'timber-house', 'gable', 'porch', 7, 9, [s('front-home', 0, 4, 7, 5, 0, 2, 'home'), s('rear-wing', 0, 0, 4, 4, 0, 1, 'kitchen')]],
  ['B42', 'post-office', 'POST OFFICE', 'civic', 'brick-mixed-use', 'flat', 'civic', 7, 6, [s('post', 0, 0, 7, 6, 0, 1, 'post')]],
  ['B43', 'branch-library', 'BRANCH LIBRARY', 'civic', 'brick-mixed-use', 'flat', 'civic', 9, 7, [s('public', 0, 0, 9, 7, 0, 1, 'library'), s('upper-reading', 1, 0, 7, 4, 1, 1, 'meeting')]],
  ['B44', 'fire-station', 'FIRE STATION', 'civic', 'concrete-bearing', 'flat', 'civic', 10, 6, [s('garage', 0, 0, 10, 6, 0, 1, 'garage'), s('staff', 2, 0, 6, 4, 1, 1, 'sleeping')]],
  ['B45', 'neighborhood-clinic', 'NEIGHBORHOOD CLINIC', 'civic', 'brick-mixed-use', 'flat', 'civic', 9, 5, [s('clinic', 0, 0, 9, 5, 0, 1, 'clinic')]],
  ['B46', 'school-classroom-wing', 'CLASSROOM WING', 'civic', 'brick-mixed-use', 'flat', 'civic', 15, 6, [s('west-class', 0, 0, 5, 6, 0, 2, 'classroom'), s('middle-class', 5, 0, 5, 6, 0, 2, 'classroom'), s('east-class', 10, 0, 5, 6, 0, 2, 'classroom')]],
  ['B47', 'community-hall', 'COMMUNITY HALL', 'civic', 'timber-house', 'gable', 'porch', 9, 8, [s('meeting', 0, 0, 7, 8, 0, 1, 'meeting'), s('service', 7, 0, 2, 8, 0, 1, 'stock')]],
  ['B48', 'public-works-office', 'PUBLIC WORKS OFFICE', 'civic', 'concrete-bearing', 'flat', 'civic', 10, 8, [s('main', 0, 0, 6, 8, 0, 2, 'office'), s('counter-wing', 6, 4, 4, 4, 0, 1, 'post')]],
  ['B49', 'telephone-exchange', 'TELEPHONE EXCHANGE', 'civic', 'concrete-bearing', 'flat', 'civic', 5, 6, [s('exchange', 0, 0, 5, 6, 0, 3, 'exchange')]],
  ['B50', 'pump-house', 'PUMP HOUSE', 'civic', 'concrete-bearing', 'flat', 'warehouse', 4, 5, [s('pumps', 0, 0, 4, 5, 0, 1, 'pump')]],
  ['B05', 'courtyard-apartment', 'COURTYARD APARTMENTS', 'residential', 'brick-mixed-use', 'flat', 'walkup', 12, 10, [s('rear', 0, 0, 12, 3, 0, 3, 'home'), s('west', 0, 3, 3, 7, 0, 3, 'home'), s('east', 9, 3, 3, 7, 0, 3, 'home')]],
  ['B09', 'garden-apartment-block', 'GARDEN APARTMENTS', 'residential', 'brick-mixed-use', 'flat', 'walkup', 12, 8, [s('main', 0, 0, 12, 5, 0, 3, 'home'), s('west', 0, 5, 3, 3, 0, 2, 'sleeping'), s('east', 9, 5, 3, 3, 0, 2, 'sleeping')]],
  ['B16', 'strip-retail-block', 'STRIP RETAIL BLOCK', 'commercial', 'brick-mixed-use', 'flat', 'storefront', 15, 5, [s('west-shop', 0, 0, 5, 5, 0, 1, 'retail'), s('middle-shop', 5, 0, 5, 5, 0, 1, 'bakery'), s('east-shop', 10, 0, 5, 5, 0, 1, 'laundry')]],
  ['B18', 'neighborhood-theater', 'NEIGHBORHOOD THEATER', 'commercial', 'brick-mixed-use', 'flat', 'corner', 10, 13, [s('auditorium', 0, 0, 10, 9, 0, 1, 'theater'), s('lobby', 0, 9, 10, 4, 0, 1, 'post'), s('upper-auditorium',0,0,10,9,1,1,'open-volume')]],
  ['B19', 'bowling-alley', 'BOWLING ALLEY', 'commercial', 'steel-hall', 'flat', 'storefront', 10, 18, [s('lanes', 0, 0, 10, 14, 0, 1, 'machines'), s('front-desk', 0, 14, 10, 4, 0, 1, 'lounge')]],
  ['B23', 'contractor-workshop', 'CONTRACTOR WORKSHOP', 'industrial', 'steel-hall', 'flat', 'warehouse', 11, 8, [s('work-floor', 0, 0, 11, 8, 0, 1, 'machines'), s('office', 0, 0, 4, 4, 1, 1, 'office')]],
  ['B24', 'cold-storage-depot', 'COLD STORAGE DEPOT', 'industrial', 'steel-hall', 'flat', 'warehouse', 12, 9, [s('freezers', 0, 0, 9, 9, 0, 1, 'cold'), s('receiving', 9, 0, 3, 9, 0, 1, 'stock')]],
  ['B25', 'textile-mill', 'TEXTILE MILL', 'industrial', 'brick-mixed-use', 'flat', 'corner', 14, 7, [s('mill', 0, 0, 14, 7, 0, 4, 'machines')]],
  ['B26', 'printing-works', 'PRINTING WORKS', 'industrial', 'brick-mixed-use', 'flat', 'warehouse', 12, 8, [s('presses', 0, 0, 8, 8, 0, 2, 'machines'), s('office', 8, 3, 4, 5, 0, 2, 'office')]],
  ['B27', 'recycling-shed', 'RECYCLING SHED', 'industrial', 'steel-hall', 'shed', 'warehouse', 14, 9, [s('sorting', 0, 0, 10, 9, 0, 1, 'packing'), s('stock', 10, 0, 4, 9, 0, 1, 'stock')]],
  ['B28', 'freight-transfer-depot', 'FREIGHT TRANSFER DEPOT', 'industrial', 'steel-hall', 'flat', 'warehouse', 18, 5, [s('depot', 0, 0, 18, 5, 0, 1, 'packing')]],
  ['B29', 'vehicle-service-depot', 'VEHICLE SERVICE DEPOT', 'industrial', 'concrete-bearing', 'flat', 'warehouse', 15, 10, [s('service', 0, 0, 15, 10, 0, 1, 'garage'), s('offices', 0, 0, 15, 3, 1, 1, 'office')]],
  ['B34', 'dairy-building', 'DAIRY BUILDING', 'agricultural', 'concrete-bearing', 'gable', 'warehouse', 11, 5, [s('processing', 0, 0, 8, 5, 0, 1, 'machines'), s('cold-store', 8, 0, 3, 5, 0, 1, 'cold')]],
  ['B52', 'stepped-office-block', 'STEPPED OFFICE BLOCK', 'commercial', 'concrete-bearing', 'flat', 'civic', 12, 10, [s('base', 0, 0, 12, 10, 0, 3, 'office'), s('middle', 1, 1, 10, 8, 3, 3, 'office'), s('top', 3, 2, 6, 6, 6, 2, 'office')]],
  ['B53', 'apartment-tower', 'APARTMENT TOWER', 'residential', 'concrete-bearing', 'flat', 'walkup', 7, 7, [s('apartments', 0, 0, 7, 7, 0, 12, 'home')]],
  ['B54', 'hotel-podium', 'HOTEL AND PODIUM', 'commercial', 'concrete-bearing', 'flat', 'civic', 12, 9, [s('lobby', 0, 0, 12, 9, 0, 1, 'lounge'), s('rooms', 2, 1, 8, 7, 1, 6, 'sleeping'), s('service', 3, 2, 6, 5, 7, 1, 'stock')]],
  ['B55', 'department-store', 'DEPARTMENT STORE', 'commercial', 'concrete-bearing', 'flat', 'corner', 12, 11, [s('retail', 0, 0, 12, 11, 0, 3, 'retail'), s('furniture', 0, 0, 12, 11, 3, 1, 'furniture')]],
  ['B56', 'civic-records-tower', 'CIVIC RECORDS TOWER', 'civic', 'concrete-bearing', 'flat', 'civic', 6, 8, [s('archives', 0, 0, 6, 8, 0, 7, 'stock')]],
  ['B57', 'clock-hall', 'CLOCK HALL', 'civic', 'brick-mixed-use', 'flat', 'civic', 11, 8, [s('hall', 0, 0, 11, 8, 0, 2, 'meeting'), s('clock', 4, 2, 3, 4, 2, 3, 'pump')]],
  ['B58', 'twin-office-building', 'TWIN OFFICE BUILDING', 'commercial', 'concrete-bearing', 'flat', 'civic', 8, 7, [s('tower', 0, 0, 8, 7, 0, 10, 'office')]],
];
const adjacent = (a, b) => a.floor === b.floor && (
  ((Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6) && Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 1e-6) ||
  ((Math.abs(a.y + a.d - b.y) < 1e-6 || Math.abs(b.y + b.d - a.y) < 1e-6) && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6));
const doors = rooms => rooms.flatMap((a, i) => rooms.slice(i + 1).filter(b => adjacent(a, b)).map(b => ({ a: a.id, b: b.id, at: .5, width: .35 })));
for (const [backlog, id, label, group, construction, roof, theme, w, d, parts] of plans) {
  const refresh = process.argv.find(a => a.startsWith('--refresh='))?.slice(10);
  if (refresh && refresh !== id) continue;
  const path = `src/world/data/buildings/${group}/${id}`;
  try { await access(`${path}/main.building.json`); if (process.argv.includes('--only-new')) continue; if (refresh !== id) throw new Error(`Refusing to overwrite ${id}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(path, { recursive: true });
  const layouts = new Map(parts.map(s => [s.id, recipes[s.recipe]() ]));
  if(id==='neighborhood-theater') {
    layouts.get('auditorium')[0].contents.unshift({id:'screen',...f('theater-screen',.2,.025,.6,.05,3.2)});
    layouts.set('lobby',[all('lobby','retail',[
      {id:'ticket-counter',...f('checkout-register',.07,.12,.27,.23,.9)},
      {id:'concessions',...f('counter',.62,.12,.3,.23,.9)},
      {id:'drinks',...f('display-fridge',.8,.53,.15,.3,1.3)},
      {id:'waiting',...f('theater-seats',.05,.65,.28,.2,.9)},
    ],'tile')]);
  }
  if(id==='printing-works') layouts.set('presses',[all('work-floor','production',
    [.06,.55].flatMap(x=>[.1,.6].map(y=>f('printing-press',x,y,.38,.22,1.4))),'concrete')]);
  if(id==='dairy-building') layouts.set('processing',[all('work-floor','production',[
    f('dairy-vat',.08,.1,.2,.32,1.8),f('dairy-vat',.42,.1,.2,.32,1.8),
    f('bottling-line',.12,.68,.75,.16,1.2),
  ],'tile')]);
  if (id === 'bowling-alley') {
    layouts.set('lanes',[all('work-floor','production',Array.from({length:6},(_,i)=>[
      {id:`bowling-lane-${i}`,...f('bowling-lane',.065+i*.145,.18,.12,.72,.16)},
      {id:`pinsetter-${i}`,...f('pinsetter',.065+i*.145,.04,.12,.12,1.3)},
    ]).flat(),'plank')]);
    layouts.set('front-desk',[all('common-room','retail',[
      {id:'rental-counter',...f('checkout-register',.08,.08,.3,.28,.9)},
      {id:'shoe-rack',...f('shelf',.06,.55,.3,.18,1.2)},
      {id:'waiting-booth',...f('diner-booth',.62,.1,.3,.55,.9)},
    ],'plank')]);
  }
  if (id === 'clock-hall') layouts.set('clock', [all('clock-service', 'storage', [
    { id: 'service-cabinet', ...f('cabinet', .08, .12, .2, .24, 1.2) },
  ], 'concrete')]);
  const expanded = parts.flatMap(s => Array.from({ length: s.floors }, (_, i) => layouts.get(s.id).map(r => ({ ...r, id: `${s.id}/${s.floor + i}/${r.id}`, floor: s.floor + i, x: (s.x + r.x * s.w) / w, y: (s.y + r.y * s.d) / d, w: r.w * s.w / w, d: r.d * s.d / d }))).flat());
  const definition = { version: 1, id, label, w, d, floors: Math.max(...parts.map(s => s.floor + s.floors)),
    kind: group === 'residential' || construction === 'timber-house' ? 'house' : construction === 'steel-hall' ? 'industrial' : 'shop',
    construction, roof, theme, windowStride: id === 'telephone-exchange' ? 8 : 2,
    facadeDetails: buildingDetails(id, d),
    floorVoids:id==='neighborhood-theater'?[{floor:1,x:0,y:0,w:10,d:9}]:undefined,
    features: { porch: theme === 'porch', awning: ['bakery', 'garden-center-shop'].includes(id), parapet: roof === 'flat', chimney: id === 'farmhouse-rear-wing', garage: false },
    zones: { residential: 0, commercial: 0, industrial: 0 }, traits: { use: [id], form: [backlog], style: [theme] }, partitions: true,
    sections: parts.map(({ recipe, ...s }) => ({ ...s, layout: `${s.id}.layout.json` })),
    connections: id === 'strip-retail-block' ? [] : doors(expanded).filter(c => c.a.split('/')[0] !== c.b.split('/')[0]),
    openings: (id === 'strip-retail-block' ? [1/6, .5, 5/6] : id === 'fire-station' ? [.2, .55, .85] : id === 'fourplex' ? [.25, .75] : [.5]).map(at => ({ floor: 0, side: 'south', at, kind: id === 'fire-station' || ['stable-block', 'poultry-house', 'orchard-packing-shed'].includes(id) ? 'loading' : 'door' })) };
  if (id === 'fourplex') fourplexAccess(definition, layouts);
  if (['garden-apartment-block','courtyard-apartment'].includes(id)) apartmentCirculation(definition, layouts);
  if (id === 'apartment-tower') towerAccess(definition, layouts);
  if (id === 'hotel-podium') hotelAccess(definition, layouts);
  if (id === 'boarding-house') boardingAccess(definition, layouts);
  await writeFile(`${path}/main.building.json`, JSON.stringify(definition, null, 2) + '\n');
  for (const [name, rooms] of layouts) await writeFile(`${path}/${name}.layout.json`, JSON.stringify({ partitions: true, rooms, connections: doors(rooms).filter(c => !(['garden-apartment-block','courtyard-apartment'].includes(id) && ['west','east'].includes(name) && (c.a === 'hall' || c.b === 'hall')) || c.a === (id==='garden-apartment-block'?'bedroom':'living') || c.b === (id==='garden-apartment-block'?'bedroom':'living')) }, null, 2) + '\n');
  console.log(`${backlog}: ${id}`);
}
