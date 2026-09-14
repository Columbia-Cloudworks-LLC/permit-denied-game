import { readFile, writeFile } from 'node:fs/promises';

const CITY = new Set(['city-borough', 'city-downtown']);

async function patch(path, edit) {
  const json = JSON.parse(await readFile(path, 'utf8'));
  edit(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

function dropCity(levels, fallback) {
  for (const id of CITY) delete levels[id];
  if (!Object.keys(levels).length && fallback) Object.assign(levels, fallback);
}

const retire = [
  ['src/world/data/buildings/commercial/bakery/main.building.json'],
  ['src/world/data/buildings/commercial/laundromat/main.building.json'],
  ['src/world/data/buildings/commercial/small-grocery/main.building.json'],
  ['src/world/data/buildings/commercial/corner-shop/main.building.json'],
  ['src/world/data/buildings/commercial/storefront/main.building.json'],
  ['src/world/data/buildings/commercial/hardware-store/main.building.json'],
  ['src/world/data/buildings/commercial/strip-retail-block/main.building.json'],
  ['src/world/data/buildings/residential/fourplex/main.building.json'],
  ['src/world/data/buildings/residential/garden-apartment-block/main.building.json'],
  ['src/world/data/buildings/residential/rowhouse-unit/main.building.json'],
  ['src/world/data/buildings/commercial/campus-office/main.building.json'],
  ['src/world/data/buildings/civic/fire-station/main.building.json'],
  ['src/world/data/buildings/industrial/freight-transfer-depot/main.building.json'],
  ['src/world/data/buildings/industrial/auto-repair-shop/main.building.json'],
  ['src/world/data/buildings/industrial/self-storage-row/main.building.json'],
  ['src/world/data/buildings/industrial/steel-warehouse/main.building.json', { township: 1 }],
  ['src/world/data/buildings/industrial/warehouse/main.building.json', { township: 1 }],
  ['src/world/data/buildings/industrial/textile-mill/main.building.json', { township: 1 }],
];

for (const [path, fallback] of retire) {
  await patch(path, json => dropCity(json.campaign.levels, fallback));
}

await patch('src/world/data/buildings/residential/walkup/main.building.json', json => {
  json.campaign.levels = { township: 2, suburb: 3 };
});
await patch('src/world/data/buildings/residential/courtyard-apartment/main.building.json', json => {
  json.campaign.levels = { suburb: 2 };
});
await patch('src/world/data/buildings/civic/telephone-exchange/main.building.json', json => {
  json.campaign.levels = { township: 1 };
});
await patch('src/world/data/buildings/commercial/furniture-showroom/main.building.json', json => {
  json.campaign.levels = { suburb: 1 };
});
await patch('src/world/data/buildings/commercial/department-store/main.building.json', json => {
  json.campaign.levels = { suburb: 1 };
});
await patch('src/world/data/buildings/industrial/civic/main.building.json', json => {
  json.campaign.levels = { township: 1 };
});
await patch('src/world/data/buildings/industrial/printing-works/main.building.json', json => {
  json.campaign.levels = { township: 1 };
});
await patch('src/world/data/buildings/industrial/recycling-shed/main.building.json', json => {
  json.campaign.levels = { township: 1 };
});
await patch('src/world/data/buildings/industrial/sawtooth-factory/main.building.json', json => {
  json.campaign.levels = { township: 1 };
});

await patch('src/world/data/buildings/residential/apartment-tower/main.building.json', json => {
  json.campaign.family = 'urban-apartment';
});
await patch('src/world/data/buildings/commercial/mid-rise-office-slab/main.building.json', json => {
  json.campaign.family = 'midrise-office';
});
await patch('src/world/data/buildings/commercial/twin-office-building/main.building.json', json => {
  json.campaign.levels = { 'city-borough': 1, 'city-downtown': 1 };
  json.campaign.family = 'midrise-office';
});
await patch('src/world/data/buildings/commercial/stepped-office-block/main.building.json', json => {
  json.campaign.levels = { 'city-borough': 1, 'city-downtown': 1 };
  json.campaign.family = 'midrise-office';
});
await patch('src/world/data/buildings/commercial/hotel-podium/main.building.json', json => {
  json.campaign.family = 'hotel';
});
await patch('src/world/data/buildings/civic/civic-records-tower/main.building.json', json => {
  json.campaign.family = 'civic-tower';
});
await patch('src/world/data/buildings/civic/clock-hall/main.building.json', json => {
  json.campaign.family = 'civic-tower';
});
await patch('src/world/data/buildings/commercial/parking-garage/main.building.json', json => {
  json.campaign.family = 'parking';
  json.campaign.exception = true;
  json.campaign.maxRepeats = 1;
});

await patch('src/world/data/sites/neighborhoods/factory-works/main.site.json', json => {
  json.campaign.levels = { township: 1 };
});
await patch('src/world/data/sites/neighborhoods/rowhouse-court/main.site.json', json => {
  delete json.campaign.levels['city-borough'];
});
await patch('src/world/data/sites/neighborhoods/storage-business/main.site.json', json => {
  delete json.campaign.levels['city-borough'];
});
await patch('src/world/data/sites/neighborhoods/office-pair-plaza/main.site.json', json => {
  const operations = json.buildings.find(member => member.id === 'operations');
  if (operations) operations.building = 'office-slab-eight';
});

console.log('patched city eligibility');
