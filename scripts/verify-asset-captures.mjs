import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(process.argv[2] || 'artifacts/catalog-verification');
const entries = await readdir(root, { withFileTypes: true });
const shards = [];
for (const entry of entries.filter(e => e.isDirectory())) {
  try { shards.push({ folder: entry.name, data: JSON.parse(await readFile(join(root, entry.name, 'manifest.json'), 'utf8')) }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
assert.ok(shards.length, 'No capture manifests found');
const catalog = shards[0].data.catalog;
const expected = new Set(catalog.flatMap(a => Array.from({ length: a.variants }, (_, i) => `${a.id}/${i}`)));
const seen = new Set(), captures = [];
for (const { folder, data } of shards) {
  assert.deepEqual(data.catalog, catalog, `${folder}: catalogs differ between shards`);
  assert.deepEqual(data.errors, [], `${folder}: capture errors`);
  assert.equal(data.filter, '', `${folder}: filtered run cannot prove full coverage`);
  for (const asset of data.assets) {
    const key = `${asset.id}/${asset.variant}`;
    assert.ok(expected.has(key) && !seen.has(key), `Unknown or duplicate variant ${key}`);
    assert.ok(asset.restorationVerified, `${key}: incomplete capture`);
    const files = new Set(asset.captures.map(c => c.file));
    const definition = catalog.find(a => a.id === asset.id);
    assert.equal(files.size, asset.captures.length, `${key}: duplicate screenshot paths`);
    const required = ['model.png', ...['cutaway', 'structure', 'collision', 'rooms'].map(n => `layers/${n}.png`)];
    for (const layer of ['roofs', 'walls', 'floors', 'contents', 'props', 'debris', 'vehicles', 'details', 'effects', 'terrain', 'roads', 'sites']) {
      required.push(`layers/only-${layer}.png`, `layers/without-${layer}.png`);
    }
    assert.ok(Number.isInteger(definition.floors) && definition.floors >= 0, `${key}: invalid floor count`);
    for (let floor = 0; floor < definition.floors; floor++) {
      for (const view of ['cutaway', 'structure']) required.push(`floors/${String(floor).padStart(2, '0')}-${view}.png`);
    }
    if (data.exhaustive) for (let mask = 0; mask < 4096; mask++) required.push(`layers/combination-${String(mask).padStart(4, '0')}.png`);
    if (definition.destruction === 'unsupported') {
      for (const frame of [15, 30, 60, 120, 180]) required.push(`motion/frame-${String(frame).padStart(4, '0')}.png`);
    } else {
      for (const stage of ['00-intact', '01-damaged', '02-breached', '03-support-loss', '99-cleared-structure']) required.push(`destruction/${stage}.png`);
      for (const frame of [6, 15, 30, 60, 90, 120, 180, 240, 360, 600, 900]) {
        for (const view of ['', '-cutaway', '-no-effects']) required.push(`destruction/frame-${String(frame).padStart(4, '0')}${view}.png`);
      }
    }
    if (definition.destruction === 'unsupported') {
      assert.equal(definition.category, 'runtime-vehicle', `${key}: invalid destruction exemption`);
      assert.ok(asset.destructionUnsupported, `${key}: missing destruction explanation`);
      assert.equal((await readFile(join(root, folder, asset.folder, 'destruction/README.md'), 'utf8')).trim(), asset.destructionUnsupported);
      assert.ok(files.has('model.png') && files.has('motion/frame-0180.png'), `${key}: missing baseline/final motion capture`);
    } else {
      assert.ok(files.has('model.png') && files.has('destruction/99-cleared-structure.png'), `${key}: missing baseline/final capture`);
    }
    for (const file of required) assert.ok(files.has(file), `${key}: missing required screenshot ${file}`);
    for (const c of asset.captures) {
      if (definition.category !== 'runtime-vehicle') assert.equal(c.state?.debug?.vehicles, false,
        `${key}/${c.file}: runtime vehicle isolation is not verified`);
      const bytes = await readFile(join(root, folder, asset.folder, c.file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), c.sha256, `${key}/${c.file}: screenshot hash mismatch`);
    }
    seen.add(key);
    captures.push({ id: asset.id, variant: asset.variant, folder: `${folder}/${asset.folder}`, count: asset.captures.length });
  }
}
assert.deepEqual([...seen].sort(), [...expected].sort(), 'Catalog coverage is incomplete');
const summary = { assets: catalog.length, variants: seen.size, screenshots: captures.reduce((n, c) => n + c.count, 0), errors: 0 };
await writeFile(join(root, 'verification.json'), JSON.stringify(summary, null, 2));
await writeFile(join(root, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Verified asset catalog</title><style>body{background:#20251f;color:#eee;font:16px system-ui}a{color:#dfc786}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}img{width:100%}</style><h1>Verified asset catalog</h1><p>${summary.assets} assets / ${summary.variants} variants / ${summary.screenshots} screenshots</p><main>${captures.map(c => `<a href="${c.folder}/index.html"><img loading="lazy" src="${c.folder}/model.png">${c.id} / ${c.variant}</a>`).join('')}</main>`);
console.log(JSON.stringify(summary));
