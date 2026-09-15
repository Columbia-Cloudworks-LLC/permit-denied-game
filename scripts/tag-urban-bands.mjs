import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../src/world/data/buildings', import.meta.url);
const files = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.building.json')) files.push(path);
  }
}

await walk(root.pathname);

const CORNER = new Set(['corner-shop', 'corner-apartments']);
const RUN = new Set(['rowhouse-unit', 'walkup-block', 'terrace-apartments', 'storefront']);
const CITY_EDGE = {
  storefront: { 'city-borough': 2, 'city-downtown': 1 },
  'corner-shop': { 'city-borough': 2, 'city-downtown': 1 },
  walkup: { 'city-borough': 2 },
  'rowhouse-unit': { 'city-borough': 3 },
  fourplex: { 'city-borough': 1 },
  'garden-apartment-block': { 'city-borough': 1 },
  'hardware-store': { 'city-borough': 1, 'city-downtown': 1 },
  bakery: { 'city-downtown': 1 },
  laundromat: { 'city-downtown': 1 },
  'small-grocery': { 'city-downtown': 1 },
  'neighborhood-theater': { 'city-borough': 1 },
  'branch-library': { 'city-borough': 1 },
  'fire-station': { 'city-borough': 1 },
  warehouse: { 'city-borough': 1, 'city-downtown': 1 },
  'auto-repair-shop': { 'city-borough': 1, 'city-downtown': 1 },
  'contractor-workshop': { 'city-borough': 1, 'city-downtown': 1 },
  'steel-warehouse': { 'city-downtown': 1 },
  'printing-works': { 'city-downtown': 1 },
  'self-storage-row': { 'city-downtown': 1 },
  'recycling-shed': { 'city-downtown': 1 },
  'service-station-canopy': { 'city-downtown': 1 },
  'strip-retail-block': { 'city-downtown': 1 },
};

const AGRICULTURAL = new Set([
  'greenhouse', 'orchard-packing-shed', 'farmhouse-rear-wing', 'gable-barn', 'stable-block',
  'farm-equipment-shed', 'feed-store', 'grain-elevator', 'dairy-building', 'poultry-house',
]);
const ESTATE = new Set([
  'governors-mansion', 'mansion-admin-wing', 'mansion-service', 'mansion-gatehouse', 'mansion-garage',
]);
const RURAL_HOUSES = new Set(['ranch', 'cottage', 'porch-house', 'colonial', 'stepped-house', 'manufactured-home', 'detached-garage']);

function bandsFor(pkg) {
  const id = pkg.id;
  const floors = pkg.floors ?? 1;
  const levels = Object.keys(pkg.campaign?.levels ?? {});
  const landmark = !!pkg.campaign?.landmarkOnly;
  const industrial = /industrial|warehouse|depot|garage|repair|factory|mill|storage|recycling|printing|contractor|station-canopy/.test(id)
    || pkg.kind === 'industrial';
  if (ESTATE.has(id)) return ['estate'];
  if (id === 'county-sheriff-office') return ['rural'];
  if (AGRICULTURAL.has(id)) return ['rural'];
  if (RURAL_HOUSES.has(id)) {
    const house = new Set(['rural']);
    if (levels.includes('village')) house.add('suburban');
    if (levels.includes('township') || levels.includes('suburb')) house.add('suburban');
    if (levels.includes('governors-mansion')) house.add('estate');
    return [...house];
  }
  if (landmark) {
    if (id === 'village-hall') return ['village-main-street'];
    if (id === 'township-hall') return ['village-main-street', 'suburban'];
    if (id === 'district-police-station') return ['suburban'];
    if (id === 'police-headquarters') return ['borough-mixed'];
    if (id === 'city-hall') return ['downtown-core'];
    return ['rural'];
  }
  if (industrial || pkg.campaign?.exception) return ['service-industrial'];
  if (floors >= 20) return ['downtown-core'];
  if (floors >= 5) return ['downtown-core', 'downtown-transition', 'borough-mixed'];
  if (floors >= 4) return ['downtown-transition', 'borough-mixed', 'service-industrial'];
  const bands = new Set();
  if (levels.includes('county')) bands.add('rural');
  if (levels.includes('village')) bands.add('village-main-street');
  if (levels.includes('township') || levels.includes('suburb')) bands.add('suburban');
  if (levels.includes('city-borough') || CITY_EDGE[id]?.['city-borough']) bands.add('borough-mixed');
  if (floors <= 1) bands.add('service-industrial');
  if (levels.includes('city-downtown') || CITY_EDGE[id]?.['city-downtown']) {
    if (floors <= 1) {
      bands.add('downtown-transition');
      bands.add('service-industrial');
    } else {
      bands.add('downtown-transition');
      bands.add('borough-mixed');
    }
  }
  if (id === 'walkup' || id === 'rowhouse-unit' || id === 'fourplex' || id === 'garden-apartment-block') {
    bands.add('borough-mixed');
    bands.add('suburban');
    bands.add('service-industrial');
  }
  if (id === 'storefront' || id === 'corner-shop' || id === 'hardware-store') {
    bands.add('village-main-street');
    bands.add('suburban');
    bands.add('borough-mixed');
    bands.add('downtown-transition');
    bands.add('service-industrial');
  }
  if (!bands.size) bands.add(levels.includes('suburb') ? 'suburban' : 'rural');
  return [...bands];
}

function injectCampaignFields(source, campaign) {
  const start = source.search(/"campaign"\s*:\s*\{/);
  if (start < 0) return null;
  let i = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  const pretty = JSON.stringify(campaign, null, 2).replace(/^/gm, '  ').trimStart();
  return `${source.slice(0, start)}"campaign": ${pretty}${source.slice(end)}`;
}

let updated = 0;
for (const path of files) {
  const source = await readFile(path, 'utf8');
  const pkg = JSON.parse(source);
  if (!pkg.campaign) continue;
  const campaign = { ...pkg.campaign };
  campaign.urbanBands = bandsFor(pkg);
  if (CORNER.has(pkg.id)) campaign.streetRole = 'corner';
  else if (RUN.has(pkg.id)) campaign.streetRole = 'run';
  const extra = CITY_EDGE[pkg.id];
  if (extra) campaign.levels = { ...campaign.levels, ...extra };
  const next = injectCampaignFields(source, campaign);
  if (!next) throw new Error(`could not patch campaign in ${path}`);
  if (next !== source) {
    await writeFile(path, next);
    updated += 1;
  }
}

console.log(`tagged ${updated} campaign buildings`);
