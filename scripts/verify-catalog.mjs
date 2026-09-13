import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import sharp from 'sharp';
import { digest, buildIndexes, buildTree } from './catalog/core.mjs';

// A deterministic UI fixture, not production coverage evidence. The real game
// bundle is served unchanged; only the catalog's HTTP data is intercepted.
const files = new Map();
const put = async (data, extension = 'json') => {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
  const key = `objects/${digest(bytes)}.${extension}`; files.set(key, bytes); return key;
};
const frames = [];
for (let n = 0; n < 7; n++) {
  const bytes = await sharp({ create: { width: 1280, height: 960, channels: 3, background: { r: 35 + n * 20, g: 55, b: 42 } } }).webp({ lossless: true }).toBuffer();
  frames.push({ file: await put(bytes, 'webp'), label: n === 5 ? 'Fully cleared · additional full-damage cleanup' : `Stage ${n}`, width: 1280, height: 960, seconds: n / 60 });
}
const thumbnail = await put(await sharp({ create: { width: 360, height: 270, channels: 3, background: '#48543a' } }).webp().toBuffer(), 'webp');
const cards = [];
for (let n = 0; n < 60; n++) {
  const id = `building:warehouse-${String(n).padStart(2, '0')}`, name = `Warehouse ${String(n).padStart(2, '0')}`;
  const series = [{ id: 'model', name: 'Model', frames: [frames[0]] }, { id: 'destruction', name: 'Destruction', frames: frames.slice(0, 6) },
    { id: 'layers', name: 'Layer studies', frames: frames.slice(0, 6).reverse() }, { id: 'failure', name: 'Failure fixture', frames: [frames[6], frames[0]] }];
  const detail = await put({ schema: 1, id, name, variants: [{ variant: 0, series }, { variant: 1, series }] });
  cards.push({ id, name, variants: 2, category: n % 2 ? 'brick' : 'wood', thumbnail, detail });
}
const release = { schema: 1, commit: 'ui-test', version: 'test', assetCount: cards.length,
  indexes: await buildIndexes(cards, put), byId: await buildTree(cards.map(card => ({ key: card.id, card })), put) };
const releaseBytes = Buffer.from(JSON.stringify(release)), releaseKey = `releases/${digest(releaseBytes)}.json`;
files.set(releaseKey, releaseBytes);
const port = 4192, origin = `http://127.0.0.1:${port}`;
const build = process.argv.find(arg => arg.startsWith('--build='))?.slice(8) || 'dist';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--configLoader', 'runner', '--outDir', build, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe', windowsHide: true });
let browser, log = '';
server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
try {
  await readFile(`${build}/catalog/index.html`);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, log);
  browser = await chromium.launch({ headless: true });
  for (const [name, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['mobile', devices['iPhone 13']]]) {
    const context = await browser.newContext(options), page = await context.newPage(), requests = [], errors = [];
    page.on('request', r => requests.push(r.url())); page.on('pageerror', e => errors.push(e.message));
    await page.route('**/catalog/release.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: `https://assets.permitdenied.app/${releaseKey}`, commit: 'ui-test', version: 'test' }) }));
    await page.route('https://assets.permitdenied.app/**', route => {
      const key = new URL(route.request().url()).pathname.slice(1), body = files.get(key);
      return route.fulfill({ status: body ? 200 : 404, headers: { 'access-control-allow-origin': '*' }, contentType: key.endsWith('webp') ? 'image/webp' : 'application/json', body: body || '' });
    });
    await page.goto(`${origin}/catalog/`); await page.locator('.card').first().waitFor();
    assert.equal(await page.locator('.card').count(), 24);
    assert.ok(!requests.some(url => frames.some(frame => url.endsWith(frame.file))), 'Frames loaded before opening an asset');
    assert.ok(!requests.some(url => /\/assets\/game-|assetCapture|pixi/i.test(url)), 'Gallery imported game code');
    await page.locator('#next').click(); await page.waitForFunction(() => document.querySelector('#page-number').textContent === 'Page 2');
    await page.locator('#previous').click(); await page.waitForFunction(() => document.querySelector('#page-number').textContent === 'Page 1');
    await page.locator('#search').fill('warehouse 05'); await page.locator('#filters').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
    await page.locator('.card').click(); await page.locator('#viewer').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#frame').complete && document.querySelector('#frame').naturalWidth > 0);
    assert.ok((await page.locator('#counter').textContent()).startsWith('1 / 6'));
    assert.equal(await page.locator('#back').isDisabled(), true);
    assert.ok(!requests.some(url => frames.slice(2).some(frame => url.endsWith(frame.file))), 'Unrelated frames preloaded');
    await page.locator('#stage').press('ArrowRight');
    assert.ok((await page.locator('#counter').textContent()).startsWith('2 / 6'));
    await page.locator('#stage').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: 240, clientY: 120 });
    await page.locator('#stage').dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: 100, clientY: 125 });
    assert.ok((await page.locator('#counter').textContent()).startsWith('3 / 6'));
    const step = await page.locator('#counter').textContent();
    await page.locator('#stage').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 8, isPrimary: true, clientX: 100, clientY: 100 });
    await page.locator('#stage').dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 8, isPrimary: true, clientX: 108, clientY: 250 });
    assert.equal(await page.locator('#counter').textContent(), step, 'Vertical scroll changed frames');
    await page.locator('#variant').selectOption('1'); await page.locator('#series').selectOption('layers');
    assert.ok(page.url().includes('variant=1') && page.url().includes('series=layers'));
    await page.reload(); await page.locator('#viewer').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#variant').inputValue(), '1'); assert.equal(await page.locator('#series').inputValue(), 'layers');
    await page.locator('#scrubber').press('End');
    assert.equal(await page.locator('#forward').isDisabled(), true);
    await page.locator('#stage').press('ArrowRight'); assert.equal(await page.locator('#scrubber').inputValue(), '5');
    await page.locator('#stage').press('Escape'); assert.equal(await page.locator('#viewer').isVisible(), false);
    await page.locator('#search').fill(''); await page.locator('#category').selectOption('brick');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 24);
    assert.ok((await page.locator('.card-category').allTextContents()).every(text => text === 'brick'));
    await page.locator('.card').first().click(); await page.locator('#viewer').waitFor({ state: 'visible' });
    const failedUrl = `https://assets.permitdenied.app/${frames[6].file}`;
    const failImage = route => route.fulfill({ status: 503, body: 'unavailable' });
    await page.route(failedUrl, failImage);
    await page.locator('#series').selectOption('failure');
    await page.waitForFunction(() => document.querySelector('#image-status').textContent.includes('Frame unavailable'));
    assert.equal(await page.locator('#frame').isVisible(), false);
    await page.unroute(failedUrl, failImage);
    await page.locator('#forward').click(); await page.locator('#back').click();
    await page.waitForFunction(() => document.querySelector('#frame').naturalWidth > 0 && !document.querySelector('#frame').hidden && document.querySelector('#image-status').textContent === '');
    await page.locator('#close').click(); assert.equal(await page.locator('.card').first().evaluate(el => el === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mkdir('artifacts/catalog-ui', { recursive: true }); await page.screenshot({ path: `artifacts/catalog-ui/${name}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    const game = await context.newPage(), gameRequests = [];
    game.on('request', r => gameRequests.push(r.url())); await game.goto(origin);
    await game.waitForSelector('#game-root'); assert.ok(!gameRequests.some(url => /assets\.permitdenied|\/catalog\/|\/assets\/catalog-/.test(url)));
    await context.close(); console.log(`${name}: catalog navigation, controls, deep links, network isolation and layout passed`);
  }
} finally { await browser?.close(); server.kill(); }
