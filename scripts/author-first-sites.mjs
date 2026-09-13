import { mkdir, writeFile, access } from 'node:fs/promises';
const b = (id, building, x, y) => ({ id, building, x, y });
const p = (id, asset, x, y) => ({ id, asset, x, y });
const sites = [
  { id: 'main-street', label: 'MAIN STREET', w: 60, d: 24, buildings: [b('corner', 'corner-shop', 3, 3), b('diner', 'roadside-diner', 12, 3), b('hardware', 'hardware-store', 29, 3), b('post-office', 'post-office', 40, 3)], equipment: [p('bin', 'dumpster', 36, 19), p('light-west', 'light', 8, 19), p('light-east', 'light', 48, 19), p('car', 'car', 21, 18)] },
  { id: 'contractor-yard', label: 'CONTRACTOR YARD', w: 53, d: 30, buildings: [b('workshop', 'contractor-workshop', 3, 3), b('depot', 'freight-transfer-depot', 24, 3)], equipment: [p('pallets', 'pallet-stack', 8, 21), p('crates', 'crate-stack', 15, 22), p('equipment', 'farm-implement', 31, 21), p('fuel', 'propane-tank', 44, 21)] },
  { id: 'civic-block', label: 'CIVIC BLOCK', w: 55, d: 28, buildings: [b('permit', 'permit-office', 3, 3), b('library', 'branch-library', 20, 3), b('post', 'post-office', 39, 3)], equipment: [p('table-west', 'picnic-table', 12, 20), p('table-east', 'picnic-table', 33, 20), p('light', 'light', 25, 23), p('tree', 'mature-tree', 45, 20)] },
  { id: 'school-grounds', label: 'SCHOOL GROUNDS', w: 51, d: 39, buildings: [b('west-classrooms', 'school-classroom-wing', 3, 3), b('east-classrooms', 'school-classroom-wing', 29, 3), b('hall', 'community-hall', 3, 24)], equipment: [p('table-a', 'picnic-table', 27, 25), p('table-b', 'picnic-table', 32, 25), p('fence-a', 'fence', 23, 19), p('fence-b', 'fence', 25, 19), p('tree', 'mature-tree', 40, 28)] },
  { id: 'factory-works', label: 'FACTORY WORKS', w: 53, d: 35, buildings: [b('mill', 'textile-mill', 3, 3), b('workshop', 'steel-warehouse', 30, 3), b('operations', 'campus-office', 3, 23)], equipment: [p('transformer', 'transformer', 23, 5), p('hvac', 'hvac', 23, 10), p('stock', 'crate-stack', 32, 24), p('dumpster', 'dumpster', 43, 24)] },
  { id: 'office-pair-plaza', label: 'OFFICE PAIR PLAZA', w: 47, d: 32, buildings: [b('west-tower', 'twin-office-building', 3, 3), b('east-tower', 'twin-office-building', 25, 3), b('operations', 'campus-office', 3, 23)], equipment: [p('shrub-a', 'shrub', 18, 5), p('shrub-b', 'shrub', 18, 9), p('transformer', 'transformer', 39, 4), p('table', 'picnic-table', 26, 24)] },
  { id: 'suburban-block', label: 'SUBURBAN BLOCK', w: 38, d: 27, buildings: [
    b('ranch', 'ranch', 3, 4), b('ranch-garage', 'detached-garage', 3, 13),
    b('duplex', 'side-by-side-duplex', 15, 4), b('duplex-garage', 'detached-garage', 17, 15),
    b('cottage', 'cottage', 29, 4),
  ], equipment: [p('ranch-mail', 'mailbox', 3, 21), p('duplex-mail', 'mailbox', 17, 22), p('cottage-mail', 'mailbox', 30, 16), p('yard-tree', 'mature-tree', 29, 21), p('picnic', 'picnic-table', 11, 16), p('fence-a', 'fence', 11, 4), p('fence-b', 'fence', 11, 6)] },
  { id: 'rowhouse-court', label: 'ROWHOUSE COURT', w: 30, d: 22, buildings: Array.from({ length: 5 }, (_, i) => b(`home-${i}`, 'rowhouse-unit', 3 + i * 5, 3)),
    equipment: Array.from({ length: 5 }, (_, i) => p(`bin-${i}`, 'trash-can', 3 + i * 5, 15)) },
  { id: 'roadside-motel', label: 'ROADSIDE MOTEL', w: 42, d: 27, buildings: [b('west-rooms', 'motel-room-block', 3, 3), b('east-rooms', 'motel-room-block', 23, 3), b('reception', 'campus-office', 3, 18)],
    equipment: [p('car-a', 'car', 15, 16), p('car-b', 'car', 24, 16), p('vending', 'vending', 13, 21), p('sign', 'billboard', 29, 22), p('ice', 'interior-display-fridge', 13, 18)] },
  { id: 'service-station', label: 'SERVICE STATION', w: 38, d: 29, buildings: [b('shop', 'storefront', 3, 3), b('repair', 'auto-repair-shop', 18, 3), b('pump-canopy', 'service-station-canopy', 4.5, 16)],
    equipment: [p('pump-a', 'fuel-pump', 6, 17), p('pump-b', 'fuel-pump', 12, 17), p('pump-c', 'fuel-pump', 6, 22), p('pump-d', 'fuel-pump', 12, 22), p('parked-car', 'car', 24, 20), p('utility', 'utility-cabinet', 33, 5)] },
  { id: 'storage-business', label: 'STORAGE BUSINESS', w: 45, d: 32, buildings: [b('office', 'campus-office', 3, 23), ...[3, 13, 23].map((y, i) => b(`east-row-${i}`, 'self-storage-row', 25, y)), b('west-row-a', 'self-storage-row', 3, 3), b('west-row-b', 'self-storage-row', 3, 13)],
    equipment: [p('dumpster', 'dumpster', 17, 26), p('light', 'light', 21, 9), p('camera', 'camera', 21, 19)] },
  { id: 'farmstead', label: 'FARMSTEAD', w: 48, d: 39, buildings: [b('house', 'colonial', 3, 3), b('barn', 'gable-barn', 16, 3), b('equipment', 'farm-equipment-shed', 29, 4)],
    equipment: [p('grain', 'grain-bin', 31, 20), p('tractor', 'tractor', 19, 24), p('implement', 'farm-implement', 26, 28), p('hay-a', 'hay-bale-square', 10, 26), p('hay-b', 'hay-bale-round', 13, 28), p('trough', 'water-trough', 4, 19), p('wood', 'woodpile', 5, 28)] },
];
for (const site of sites) {
  if (site.id === 'contractor-yard') site.equipment.push(p('dock-bumpers', 'loading-dock-bumpers', 34, 9));
  const dir = `src/world/data/sites/neighborhoods/${site.id}`;
  try { await access(`${dir}/main.site.json`); if (process.argv.includes('--only-new')) continue; throw new Error(`Refusing to overwrite ${site.id}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/main.site.json`, JSON.stringify({ version: 1, ...site }, null, 2) + '\n');
  console.log(site.id);
}
