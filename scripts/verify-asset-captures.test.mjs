import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'pd-capture-coverage-'));
  try {
    const bytes = Buffer.from('deterministic screenshot bytes');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const folder = 'building/example/variant-0';
    await mkdir(join(root, 'shard-1', folder, 'destruction'), { recursive: true });
    const names = ['model.png', 'destruction/99-cleared-structure.png'];
    for (const view of ['cutaway','structure','collision','rooms']) names.push('layers/'+view+'.png');
    for (const layer of ['roofs','walls','floors','contents','props','debris','vehicles','details','effects','terrain','roads','sites']) for (const mode of ['only','without']) names.push('layers/'+mode+'-'+layer+'.png');
    for (const stage of ['00-intact','01-damaged','02-breached','03-support-loss']) names.push('destruction/'+stage+'.png');
    for (const frame of [6,15,30,60,90,120,180,240,360,600,900]) for (const view of ['','-cutaway','-no-effects']) names.push('destruction/frame-'+String(frame).padStart(4,'0')+view+'.png');
    for (const view of ['cutaway','structure']) names.push('floors/00-'+view+'.png');
    await mkdir(join(root,'shard-1',folder,'layers'));
    await mkdir(join(root,'shard-1',folder,'floors'));
    const captures = names.map(file => ({file,sha256:digest,state:{debug:{vehicles:false}}}));
    for (const { file } of captures) await writeFile(join(root, 'shard-1', folder, file), bytes);
    const data = { catalog: [{ id: 'building:example', variants: 1, floors: 1 }], filter: '', errors: [], assets: [{ id: 'building:example', variant: 0, folder, captures, restorationVerified: true }] };
    const check = async () => {
      await writeFile(join(root, 'shard-1', 'manifest.json'), JSON.stringify(data));
      return spawnSync(process.execPath, [resolve('scripts/verify-asset-captures.mjs'), root], { encoding: 'utf8', windowsHide: true });
    };
    await run({ root, folder, data, check });
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\') || resolve(root).startsWith(resolve(tmpdir()) + '/'));
    await rm(root, { recursive: true, force: true });
  }
}

test('accepts complete coverage and emits a reviewable catalog summary', () => fixture(async ({ root, check }) => {
  const result = await check(); assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(await readFile(join(root, 'verification.json'), 'utf8'));
  assert.deepEqual(summary, { assets: 1, variants: 1, screenshots: 69, errors: 0 });
}));
test('rejects a missing declared variant even when captured variants succeeded', () => fixture(async ({ data, check }) => {
  data.catalog[0].variants = 2;
  const result = await check(); assert.notEqual(result.status, 0); assert.match(result.stderr, /coverage is incomplete/);
}));
test('rejects modified screenshot contents', () => fixture(async ({ root, folder, check }) => {
  await writeFile(join(root, 'shard-1', folder, 'model.png'), 'changed');
  const result = await check(); assert.notEqual(result.status, 0); assert.match(result.stderr, /hash mismatch/);
}));
test('rejects incomplete destruction or restoration and filtered coverage', () => fixture(async ({ data, check }) => {
  data.assets[0].restorationVerified = false;
  assert.notEqual((await check()).status, 0);
  data.assets[0].restorationVerified = true; data.filter = 'building:';
  const result = await check(); assert.notEqual(result.status, 0); assert.match(result.stderr, /filtered run/);
}));

test('accepts runtime vehicle motion only with an explicit destruction explanation', () => fixture(async ({ root, folder, data, check }) => {
  data.catalog[0].category = 'runtime-vehicle'; data.catalog[0].destruction = 'unsupported';
  data.assets[0].destructionUnsupported = 'No production destruction mechanic.';
  const final = data.assets[0].captures[1];
  const bytes = await readFile(join(root, 'shard-1', folder, final.file));
  final.file = 'motion/frame-0180.png';
  await mkdir(join(root, 'shard-1', folder, 'motion'));
  await writeFile(join(root, 'shard-1', folder, final.file), bytes);
  for (const frame of [15,30,60,120]) {
    const file = 'motion/frame-'+String(frame).padStart(4,'0')+'.png';
    await writeFile(join(root,'shard-1',folder,file),bytes);
    data.assets[0].captures.push({file,sha256:final.sha256});
  }
  await writeFile(join(root, 'shard-1', folder, 'destruction/README.md'), data.assets[0].destructionUnsupported);
  const result = await check(); assert.equal(result.status, 0, result.stderr);
  data.assets[0].destructionUnsupported = '';
  assert.match((await check()).stderr, /missing destruction explanation/);
  data.catalog[0].category = 'building';
  assert.match((await check()).stderr, /invalid destruction exemption/);
}));

for (const file of ['layers/without-walls.png','layers/only-contents.png','floors/00-cutaway.png','destruction/frame-0060-no-effects.png','destruction/02-breached.png']) {
  test('rejects missing required view '+file, () => fixture(async ({data,check}) => {
    data.assets[0].captures = data.assets[0].captures.filter(c => c.file !== file);
    const result = await check(); assert.notEqual(result.status,0); assert.match(result.stderr,/missing required screenshot/);
  }));
}
test('rejects an incomplete exhaustive capture', () => fixture(async ({data,check}) => {
  data.exhaustive=true;
  const result=await check(); assert.notEqual(result.status,0); assert.match(result.stderr,/combination-0000/);
}));

test('rejects runtime vehicles enabled during isolated asset destruction', () => fixture(async ({data,check}) => {
  data.assets[0].captures.find(c => c.file === 'destruction/frame-0180.png').state.debug.vehicles = true;
  const result = await check();
  assert.notEqual(result.status, 0); assert.match(result.stderr, /runtime vehicle isolation is not verified/);
}));

test('rejects missing isolation evidence even when image hashes match', () => fixture(async ({data,check}) => {
  delete data.assets[0].captures[0].state;
  const result = await check();
  assert.notEqual(result.status, 0); assert.match(result.stderr, /runtime vehicle isolation is not verified/);
}));
