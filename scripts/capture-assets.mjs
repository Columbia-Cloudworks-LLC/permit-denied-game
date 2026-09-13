import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const output = resolve(option('output', `artifacts/asset-captures/${new Date().toISOString().replaceAll(':', '-')}`));
const filter = option('filter', '');
const [shard, shards] = option('shard', '1/1').split('/').map(Number);
if (!Number.isInteger(shard) || !Number.isInteger(shards) || shard < 1 || shard > shards) throw new Error('Invalid --shard=N/TOTAL');
const external = option('url', '');
const port = Number(option('port', '4175'));
const previewDir = option('preview-dir', 'dist');
const base = external || `http://127.0.0.1:${port}`;
const server = external ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', previewDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe', windowsHide: true });
let serverLog = '';
server?.stdout.on('data', data => { serverLog += data; });
server?.stderr.on('data', data => { serverLog += data; });
const manifest = { version: 1, base, shard, shards, filter, exhaustive: args.includes('--exhaustive'), assets: [], errors: [] };
let browser;
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
try {
  await mkdir(output, { recursive: true });
  if (server) {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(`Preview exited: ${serverLog}`);
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`Preview unavailable: ${serverLog}`);
  }
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', e => manifest.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') manifest.errors.push(m.text()); });
  await page.goto(`${base}/?capture=1`);
  await page.waitForFunction(() => window.__assetCapture, undefined, { timeout: 60000 });
  const catalog = await page.evaluate(() => window.__assetCapture.catalog);
  const selected = catalog.filter(a => !filter || a.id.includes(filter)).filter((_, index) => index % shards === shard - 1);
  if (!selected.length) throw new Error('No assets matched this selection/shard');
  manifest.catalog = catalog;
  const layers = await page.evaluate(() => window.__assetCapture.layers);
  for (const asset of selected) for (let variant = 0; variant < asset.variants; variant++) {
    const folder = `${asset.id.replaceAll(':', '/')}/variant-${variant}`;
    await mkdir(join(output, folder, 'layers'), { recursive: true });
    await mkdir(join(output, folder, 'floors'), { recursive: true });
    await mkdir(join(output, folder, 'destruction'), { recursive: true });
    const record = { ...asset, variant, folder, captures: [] };
    manifest.assets.push(record);
    await page.evaluate(({ id, variant }) => window.__assetCapture.load(id, variant), { id: asset.id, variant });
    async function capture(file, view = {}) {
      const state = await page.evaluate(view => window.__assetCapture.render(view), view);
      if (asset.category !== 'runtime-vehicle') assert.equal(state.debug.vehicles, false, `${asset.id}: runtime vehicle leaked into an isolated asset view`);
      const png = await page.locator('canvas').screenshot({ path: join(output, folder, file) });
      record.captures.push({ file, sha256: createHash('sha256').update(png).digest('hex'), state });
    }
    await capture('model.png');
    await capture('layers/cutaway.png', { roofs: false, walls: false, reveal: true });
    await capture('layers/structure.png', { roofs: false, contents: false, props: false, supports: true, reveal: true });
    await capture('layers/collision.png', { roofs: false, reveal: true, collision: true });
    await capture('layers/rooms.png', { roofs: false, walls: false, reveal: true, rooms: true });
    for (const layer of layers) {
      await capture(`layers/without-${layer}.png`, { [layer]: false });
      await capture(`layers/only-${layer}.png`, { ...Object.fromEntries(layers.map(key => [key, key === layer])), reveal: true });
    }
    if (args.includes('--exhaustive')) for (let mask = 0; mask < 2 ** layers.length; mask++) {
      await capture(`layers/combination-${String(mask).padStart(4, '0')}.png`, Object.fromEntries(layers.map((key, i) => [key, Boolean(mask & (1 << i))])));
    }
    for (let floor = 0; floor < asset.floors; floor++) {
      await capture(`floors/${String(floor).padStart(2, '0')}-cutaway.png`, { maxFloor: floor, roofs: false, walls: false, reveal: true });
      await capture(`floors/${String(floor).padStart(2, '0')}-structure.png`, { maxFloor: floor, roofs: false, contents: false, reveal: true, supports: true });
    }
    const initial = record.captures[0];
    if (asset.category === 'detail') assert.notEqual(record.captures.find(c => c.file === 'layers/without-details.png').sha256,
      initial.sha256, `${asset.id}: mounted detail is not visible in its host`);
    if (asset.destruction === 'unsupported') {
      assert.equal(asset.category, 'runtime-vehicle', 'Only runtime vehicles may omit destruction');
      await mkdir(join(output, folder, 'motion'), { recursive: true });
      record.destructionUnsupported = 'This production vehicle has no damage or destruction mechanic. See motion/ for its actual simulation.';
      await writeFile(join(output, folder, 'destruction', 'README.md'), record.destructionUnsupported + '\n');
      let elapsed = 0;
      for (const frame of [15, 30, 60, 120, 180]) {
        await page.evaluate(n => window.__assetCapture.advance(n), frame - elapsed); elapsed = frame;
        await capture(`motion/frame-${String(frame).padStart(4, '0')}.png`);
      }
      const final = record.captures.at(-1);
      assert.ok(final.state.vehicle.odo > initial.state.vehicle.odo, `${asset.id}: vehicle did not move`);
      assert.notEqual(final.sha256, initial.sha256, `${asset.id}: motion never changed the rendered image`);
      assert.notEqual(record.captures.find(c => c.file === 'layers/without-vehicles.png').sha256, initial.sha256, `${asset.id}: vehicle visibility switch did not hide the model`);
    } else {
    await capture('destruction/00-intact.png');
    await page.evaluate(() => window.__assetCapture.damage('crack'));
    await capture('destruction/01-damaged.png');
    await page.evaluate(() => window.__assetCapture.damage('breach'));
    await capture('destruction/02-breached.png');
    await page.evaluate(() => window.__assetCapture.damage('supports'));
    await capture('destruction/03-support-loss.png');
    let elapsed = 0;
    for (const frame of [6, 15, 30, 60, 90, 120, 180, 240, 360, 600, 900]) {
      await page.evaluate(n => window.__assetCapture.advance(n), frame - elapsed); elapsed = frame;
      const prefix = `destruction/frame-${String(frame).padStart(4, '0')}`;
      await capture(`${prefix}.png`);
      await capture(`${prefix}-cutaway.png`, { roofs: false, walls: false, reveal: true });
      await capture(`${prefix}-no-effects.png`, { effects: false });
    }
    // Full-damage cleanup is explicit and distinct from the support-loss sequence.
    await page.evaluate(() => { window.__assetCapture.damage('all'); window.__assetCapture.advance(900); });
    await capture('destruction/99-cleared-structure.png');
    const final = record.captures.at(-1);
    assert.notEqual(final.sha256, initial.sha256, `${asset.id}: destruction never changed the rendered image`);
    assert.ok(final.state.props.every(p => p.broken), `${asset.id}: an outdoor prop survived full damage`);
    if (asset.category === 'fixture') assert.ok(final.state.buildings.every(b => b.brokenFixtures === b.fixtures), `${asset.id}: fixture survived full damage`);
    else assert.ok(final.state.buildings.every(b => !b.cells.intact && !b.cells.cracked), `${asset.id}: intact structural cells survived full damage`);
    assert.ok(final.state.buildings.every(b => b.details.every(d => d.pose === null)), `${asset.id}: attached detail survived full damage`);
    assert.ok(final.state.buildings.every(b => !b.elevatedTank || b.elevatedTank.phase === 'gone'), `${asset.id}: elevated tank survived full damage`);
    assert.ok(final.state.buildings.every(b => (b.silos ?? []).every(s => s.phase === 'gone')), `${asset.id}: silo survived full damage`);
    }
    await page.evaluate(({ id, variant }) => window.__assetCapture.load(id, variant), { id: asset.id, variant });
    const replay = await page.locator('canvas').screenshot();
    assert.equal(createHash('sha256').update(replay).digest('hex'), initial.sha256, `${asset.id}: rebuilding did not reproduce the intact screenshot`);
    record.restorationVerified = true;
    await writeFile(join(output, folder, 'manifest.json'), JSON.stringify(record, null, 2));
    await writeFile(join(output, folder, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${esc(asset.name)}</title><style>body{background:#20251f;color:#eee;font:16px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}img{width:100%}figure{margin:0}figcaption{padding:8px}</style><h1>${esc(asset.id)} / variant ${variant}</h1><main>${record.captures.map(c => `<figure><a href="${esc(c.file)}"><img loading="lazy" src="${esc(c.file)}"></a><figcaption>${esc(c.file)} · ${c.state.seconds.toFixed(2)}s</figcaption></figure>`).join('')}</main>`);
    console.log(`${asset.id} variant ${variant}: ${record.captures.length} captures`);
    if (manifest.errors.length) throw new Error(manifest.errors.join('\n'));
  }
} catch (error) {
  manifest.errors.push(String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Asset capture catalog</title><style>body{background:#20251f;color:#eee;font:16px system-ui}a{color:#dfc786}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}img{width:100%}</style><h1>Asset capture catalog</h1><p>${manifest.assets.length} variants · ${manifest.errors.length} errors</p><main>${manifest.assets.map(a => `<a href="${esc(a.folder)}/index.html"><img loading="lazy" src="${esc(a.folder)}/model.png">${esc(a.id)} / ${a.variant}</a>`).join('')}</main>`);
  console.log(`Capture output: ${output}`);
  for (const error of manifest.errors) console.error(error);
}
