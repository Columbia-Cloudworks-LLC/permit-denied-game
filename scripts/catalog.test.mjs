import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import sharp from 'sharp';
import { fingerprint, buildIndexes, buildTree, digest, requiredCaptures, objectWriter, publicationFiles } from './catalog/core.mjs';
import { restoreCapture, saveCapture } from './catalog/cache.mjs';
import { uploadVerified } from './catalog/storage.mjs';
import { generateCatalog, isOpaqueIntactExterior, seriesFor, thumbnailSource } from './catalog/generate.mjs';

const compiled = ts.transpileModule(await readFile('src/catalog/search.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { searchPage } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
function memoryStore() {
  const data = new Map(), metadata = new Map(); let puts = 0;
  return { data, get: async key => data.get(key) || null,
    head: async key => data.has(key) ? { ContentLength: data.get(key).length, Metadata: metadata.get(key) } : null,
    put: async (key, bytes) => { puts++; data.set(key, bytes); metadata.set(key, { sha256: digest(bytes) }); }, puts: () => puts };
}
async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'permit-catalog-'));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('fingerprints isolate asset inputs and invalidate shared runtime/recipe changes', () => {
  const engine = { renderer: 'a', browser: 'pinned', node: '22', seed: 4517 };
  const a = fingerprint(engine, { id: 'a', roof: 'flat' }, 0), b = fingerprint(engine, { id: 'b' }, 0);
  assert.equal(a, fingerprint(engine, { roof: 'flat', id: 'a' }, 0));
  assert.notEqual(a, fingerprint(engine, { id: 'a', roof: 'gable' }, 0));
  assert.equal(b, fingerprint(engine, { id: 'b' }, 0));
  assert.notEqual(a, fingerprint({ ...engine, renderer: 'b' }, { id: 'a', roof: 'flat' }, 0));
  assert.notEqual(a, fingerprint(engine, { id: 'a', roof: 'flat' }, 1));
});

test('100,000 records have bounded pages and seek search without a catalog download', async () => {
  const objects = new Map(); let maxItems = 0;
  const put = async node => { maxItems = Math.max(maxItems, node.items?.length || node.children?.length || 0); const key = String(objects.size); objects.set(key, node); return key; };
  const records = Array.from({ length: 100000 }, (_, n) => {
    const id = `building:${String(n).padStart(6, '0')}`;
    return { key: `warehouse ${String(n).padStart(6, '0')}\t${id}`, card: { id, name: `Warehouse ${String(n).padStart(6, '0')}` } };
  });
  const root = await buildTree(records, put);
  let reads = 0; const load = async key => { reads++; return objects.get(key); };
  const first = await searchPage(root, load, 'warehouse');
  assert.equal(first.items.length, 24); assert.equal(first.more, true); assert.ok(reads < 10, `${reads} index requests`);
  reads = 0;
  const next = await searchPage(root, load, 'warehouse', first.cursor);
  assert.equal(next.items.length, 24); assert.ok(reads < 10); assert.notEqual(next.items[0].id, first.items[0].id);
  reads = 0;
  const tail = await searchPage(root, load, 'warehouse 099999');
  assert.equal(tail.items.length, 1); assert.equal(tail.more, false); assert.ok(reads < 10);
  assert.equal(maxItems, 24);
});

test('partitioned name/ID prefix search and categories deduplicate across pages', async () => {
  const objects = new Map(), put = async node => { const key = String(objects.size); objects.set(key, node); return key; };
  const cards = Array.from({ length: 63 }, (_, n) => ({ id: `building:warehouse-${n}`, name: `Warehouse warehouse ${n}`, category: n % 2 ? 'brick' : 'wood' }));
  const indexes = await buildIndexes(cards, put), load = async key => objects.get(key);
  const found = []; let cursor = '', more;
  do { const page = await searchPage(indexes.all.search, load, 'ware', cursor); found.push(...page.items); cursor = page.cursor; more = page.more; } while (more);
  assert.equal(found.length, 63); assert.equal(new Set(found.map(c => c.id)).size, 63);
  const filtered = await searchPage(indexes.brick.search, load, 'warehouse 1');
  assert.ok(filtered.items.length); assert.ok(filtered.items.every(c => c.category === 'brick'));
  assert.equal((await searchPage(indexes.all.search, load, 'no such model')).items.length, 0);
});

test('uploads resume idempotently; corrupt metadata and failed verification cannot report success', async () => {
  const store = memoryStore(), bytes = Buffer.from('image');
  assert.equal(await uploadVerified(store, 'objects/test.webp', bytes, 'image/webp'), true);
  assert.equal(await uploadVerified(store, 'objects/test.webp', bytes, 'image/webp'), false);
  assert.equal(store.puts(), 1);
  store.data.set('objects/test.webp', Buffer.from('bad'));
  assert.equal(await uploadVerified(store, 'objects/test.webp', bytes, 'image/webp'), true);
  let heads = 0;
  const delayed = {
    head: async () => {
      heads += 1;
      if (heads < 3) return null;
      return { ContentLength: bytes.length, Metadata: { sha256: digest(bytes) } };
    },
    put: async () => {},
  };
  assert.equal(await uploadVerified(delayed, 'objects/late.webp', bytes, 'image/webp'), true);
  await assert.rejects(uploadVerified({ head: async () => null, put: async () => {} }, 'objects/test.webp', bytes), /verification failed/);
});

test('cache restoration rejects missing stages, corrupted evidence, and wrong variants', () => fixture(async root => {
  const store = memoryStore(), image = Buffer.from('png'), sha256 = digest(image);
  const asset = { id: 'building:a', variant: 0, folder: 'building/a/variant-0', floors: 1, destruction: 'supported' };
  const record = { ...asset, fingerprint: 'abc', restorationVerified: true,
    captures: requiredCaptures(asset).map(file => ({ file, sha256 })) };
  store.data.set('captures/abc.json', Buffer.from(JSON.stringify(record))); store.data.set(`evidence/${sha256}.png`, image);
  assert.ok(await restoreCapture(store, 'abc', root, asset));
  assert.equal(await restoreCapture(store, 'abc', root, { ...asset, variant: 1 }), null);
  store.data.set(`evidence/${sha256}.png`, Buffer.from('corrupt'));
  assert.equal(await restoreCapture(store, 'abc', root, asset), null);
  store.data.set(`evidence/${sha256}.png`, image); record.captures.pop();
  store.data.set('captures/abc.json', Buffer.from(JSON.stringify(record)));
  assert.equal(await restoreCapture(store, 'abc', root, asset), null);
}));

test('interrupted evidence upload does not publish a cache commit marker', () => fixture(async root => {
  await mkdir(join(root, 'asset'));
  const data = Buffer.from('png'); await writeFile(join(root, 'asset/model.png'), data);
  const store = memoryStore(); store.put = async () => { throw new Error('network interrupted'); };
  await assert.rejects(saveCapture(store, { folder: 'asset', fingerprint: 'test', captures: [{ file: 'model.png', sha256: digest(data) }] }, root));
  assert.equal(await store.get('captures/test.json'), null);
}));

test('public images deduplicate and contain no private simulation state; provenance is enforced', () => fixture(async root => {
  const shard = join(root, 'captures/shard'), folder = 'building/a/variant-0';
  await mkdir(join(shard, folder), { recursive: true });
  const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#30362e' } }).png().toBuffer();
  await writeFile(join(shard, folder, 'model.png'), png);
  const asset = { id: 'building:a', name: 'A', category: 'building', variant: 0, folder, fingerprint: 'fp', restorationVerified: true,
    captures: [{ file: 'model.png', sha256: digest(png), state: { seconds: 0, privateEvidence: 'not public' } }] };
  await writeFile(join(shard, 'manifest.json'), JSON.stringify({ commit: 'commit-a', assets: [asset] }));
  const result = await generateCatalog(join(root, 'captures'), join(root, 'public'), { commit: 'commit-a', version: '1' });
  const files = await publicationFiles(join(root, 'public'), result.file);
  for (const key of files.filter(p => p.endsWith('.json'))) assert.ok(!(await readFile(join(root, 'public', key), 'utf8')).includes('privateEvidence'));
  await assert.rejects(generateCatalog(join(root, 'captures'), join(root, 'other'), { commit: 'commit-b', version: '1' }), /commit mismatch/);
  const writer = await objectWriter(join(root, 'dedup'));
  assert.equal(await writer.put(png, 'png'), await writer.put(png, 'png')); assert.equal(writer.stats().objects, 1);
}));

test('release graph verification rejects corruption and missing files and keeps old releases addressable', () => fixture(async root => {
  const writer = await objectWriter(root), image = await writer.put(Buffer.from('image'), 'webp');
  const detail = await writer.put({ image });
  const release = Buffer.from(JSON.stringify({ detail })), key = `releases/${digest(release)}.json`;
  await mkdir(join(root, 'releases')); await writeFile(join(root, key), release);
  assert.equal((await publicationFiles(root, key)).length, 3);
  await writer.put({ differentRelease: true });
  assert.equal((await publicationFiles(root, key)).length, 3);
  await writeFile(join(root, image), 'corrupt');
  await assert.rejects(publicationFiles(root, key), /checksum/);
  await rm(join(root, image)); await assert.rejects(publicationFiles(root, key), /ENOENT/);
}));

test('destruction views remain separate and vehicles expose motion', () => {
  const captures = ['model.png', 'destruction/00-intact.png', 'destruction/frame-0006.png', 'destruction/frame-0006-cutaway.png',
    'destruction/frame-0006-no-effects.png', 'destruction/99-cleared-structure.png'].map(source => ({ source }));
  const series = seriesFor(captures);
  assert.equal(series.find(s => s.id === 'destruction').frames.length, 3);
  assert.equal(series.find(s => s.id === 'cutaway').frames.length, 1);
  assert.equal(seriesFor([{ source: 'motion/frame-0015.png' }], 'Unsupported')[0].id, 'motion');
});

test('fixture cards use the ground-floor cutaway; buildings keep the intact model', () => {
  assert.equal(thumbnailSource({ category: 'fixture' }), 'floors/00-cutaway.png');
  assert.equal(thumbnailSource({ category: 'building' }), 'model.png');
  assert.equal(thumbnailSource({ category: 'site' }), 'model.png');
  assert.equal(thumbnailSource({ category: 'vehicle' }), 'model.png');
  assert.ok(isOpaqueIntactExterior('model.png'));
  assert.ok(isOpaqueIntactExterior('destruction/00-intact.png'));
  assert.equal(isOpaqueIntactExterior('floors/00-cutaway.png'), false);
  assert.equal(isOpaqueIntactExterior('layers/cutaway.png'), false);
});

test('generation rejects a fixture thumbnail sourced from an opaque intact exterior', () => fixture(async root => {
  const shard = join(root, 'captures/shard'), folder = 'fixture/interior-bed/variant-0';
  await mkdir(join(shard, folder, 'floors'), { recursive: true });
  const intact = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#a03030' } }).png().toBuffer();
  const cutaway = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#3060a0' } }).png().toBuffer();
  await writeFile(join(shard, folder, 'model.png'), intact);
  await writeFile(join(shard, folder, 'floors/00-cutaway.png'), cutaway);
  const writeManifest = async captures => writeFile(join(shard, 'manifest.json'), JSON.stringify({
    commit: 'commit-a', assets: [{ id: 'fixture:interior-bed', name: 'bed (interior)', category: 'fixture', variant: 0,
      folder, fingerprint: 'fp', restorationVerified: true, captures }] }));
  await writeManifest([{ file: 'model.png', sha256: digest(intact), state: { seconds: 0 } }]);
  await assert.rejects(generateCatalog(join(root, 'captures'), join(root, 'missing'), { commit: 'commit-a', version: '1' }),
    /missing thumbnail source floors\/00-cutaway/);
  await writeManifest([
    { file: 'model.png', sha256: digest(intact), state: { seconds: 0 } },
    { file: 'floors/00-cutaway.png', sha256: digest(intact), state: { seconds: 0 } },
  ]);
  await writeFile(join(shard, folder, 'floors/00-cutaway.png'), intact);
  await assert.rejects(generateCatalog(join(root, 'captures'), join(root, 'same-hash'), { commit: 'commit-a', version: '1' }),
    /matches the opaque intact exterior/);
}));

test('published fixture thumbnails come from the cutaway and stay distinct from intact hosts', () => fixture(async root => {
  const shard = join(root, 'captures/shard');
  const png = async color => sharp({ create: { width: 16, height: 12, channels: 3, background: color } }).png().toBuffer();
  const host = await png('#a03030'), bed = await png('#3060a0'), pins = await png('#30a060'), building = await png('#a0a030');
  async function writeAsset(id, category, folder, modelBytes, thumbBytes) {
    await mkdir(join(shard, folder, 'floors'), { recursive: true });
    await writeFile(join(shard, folder, 'model.png'), modelBytes);
    const captures = [{ file: 'model.png', sha256: digest(modelBytes), state: { seconds: 0 } }];
    if (category === 'fixture') {
      await writeFile(join(shard, folder, 'floors/00-cutaway.png'), thumbBytes);
      captures.push({ file: 'floors/00-cutaway.png', sha256: digest(thumbBytes), state: { seconds: 0 } });
    }
    return { id, name: id, category, variant: 0, folder, fingerprint: id, restorationVerified: true, captures };
  }
  const assets = [
    await writeAsset('building:rivertown', 'building', 'building/rivertown/variant-0', building, building),
    await writeAsset('fixture:interior-bed', 'fixture', 'fixture/interior-bed/variant-0', host, bed),
    await writeAsset('fixture:interior-pinsetter', 'fixture', 'fixture/interior-pinsetter/variant-0', host, pins),
  ];
  await writeFile(join(shard, 'manifest.json'), JSON.stringify({ commit: 'commit-a', assets }));
  const result = await generateCatalog(join(root, 'captures'), join(root, 'public'), { commit: 'commit-a', version: '1' });
  const release = JSON.parse(await readFile(join(root, 'public', result.file), 'utf8'));
  const cards = [];
  async function walk(node) {
    const data = JSON.parse(await readFile(join(root, 'public', node.file), 'utf8'));
    if (data.items) cards.push(...data.items.map(item => item.card));
    else for (const child of data.children) await walk(child);
  }
  await walk(release.byId);
  const byId = Object.fromEntries(cards.map(card => [card.id, card]));
  assert.equal(byId['building:rivertown'].thumbnailSource, undefined);
  const details = {};
  for (const card of cards) details[card.id] = JSON.parse(await readFile(join(root, 'public', card.detail), 'utf8'));
  assert.equal(details['building:rivertown'].thumbnailSource, 'model.png');
  assert.equal(details['fixture:interior-bed'].thumbnailSource, 'floors/00-cutaway.png');
  assert.equal(details['fixture:interior-pinsetter'].thumbnailSource, 'floors/00-cutaway.png');
  assert.notEqual(byId['fixture:interior-bed'].thumbnail, byId['fixture:interior-pinsetter'].thumbnail);
  assert.notEqual(byId['fixture:interior-bed'].thumbnail, byId['building:rivertown'].thumbnail);
  const expectedBed = await sharp(bed).resize({ width: 360, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  const expectedBuilding = await sharp(building).resize({ width: 360, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  assert.equal(digest(await readFile(join(root, 'public', byId['fixture:interior-bed'].thumbnail))), digest(expectedBed));
  assert.equal(digest(await readFile(join(root, 'public', byId['building:rivertown'].thumbnail))), digest(expectedBuilding));
}));

test('modular vehicles require every heading, directional failure, travel and persistent wreck sequence',()=>{
  const required=requiredCaptures({category:'vehicle',destruction:'supported',floors:0});
  assert.equal(new Set(required).size,87);
  for(let view=0;view<4;view++)for(const action of ['front','side','rear','overhead']){
    assert.ok(required.includes(`vehicle/heading-${view}-${action}-0.png`));
    assert.ok(required.includes(`vehicle/heading-${view}-${action}-60.png`));
  }
  assert.ok(required.includes('vehicle/travel-180.png'));
  assert.ok(required.includes('vehicle/wreck-pushed.png'));
  const series=seriesFor(required.map(source=>({source})));
  assert.equal(series.filter(s=>/^vehicle-[0-3]$/.test(s.id)).length,4);
  assert.equal(series.find(s=>s.id==='vehicle-wreck').frames.length,3);
});
