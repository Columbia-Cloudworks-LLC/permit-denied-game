import { TERMS_VERSION } from './terms-version.mjs';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildIndexes, buildTree, digest } from './catalog/core.mjs';

// Exercise the actual production bundle and current vendor script at a routed
// production origin. All collection requests are intercepted, never ingested.
const output = process.env.PRIVACY_OUTPUT || 'artifacts/privacy';
await mkdir(output, { recursive: true });
const vendorResponse = await fetch('https://va.vercel-scripts.com/v1/script.js');
assert.equal(vendorResponse.status, 200);
const vendor = await vendorResponse.text();
assert.ok(vendor.includes('beforeSend'));
const browser = await chromium.launch({ headless: true });
const errors = [], evidence = [];
const origin = 'https://permitdenied.app';
const files = new Map();
const put = async data => { const bytes = Buffer.from(JSON.stringify(data)), key = `objects/${digest(bytes)}.json`; files.set(key, bytes); return key; };
const thumbnail = await sharp({ create: { width: 360, height: 270, channels: 3, background: '#48543a' } }).webp().toBuffer();
const thumbnailKey = `objects/${digest(thumbnail)}.webp`; files.set(thumbnailKey, thumbnail);
const frame = { file: thumbnailKey, label: 'Intact', width: 360, height: 270, seconds: 0 };
const card = { id: 'vehicle:bus', name: 'Bus', category: 'vehicle', variants: 1, thumbnail: thumbnailKey, detail: await put({ id: 'vehicle:bus', name: 'Bus', variants: [{ variant: 0, series: [{ id: 'model', name: 'Model', frames: [frame] }] }] }) };
const release = { schema: 1, version: 'test', commit: 'test', assetCount: 1, indexes: await buildIndexes([card], put), byId: await buildTree([{ key: card.id, card }], put) };
files.set('release.json', Buffer.from(JSON.stringify(release)));
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36', ...options });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const events = [], scripts = [];
  await ctx.route('https://assets.permitdenied.app/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({ status: files.has(name) ? 200 : 404, body: files.get(name) || '', contentType: name.endsWith('webp') ? 'image/webp' : 'application/json', headers: { 'access-control-allow-origin': '*' } });
  });
  await ctx.route('https://permitdenied.app/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/_vercel/insights/')) {
      if (url.pathname.endsWith('script.js')) { scripts.push(url.pathname); await route.fulfill({ contentType: 'text/javascript', body: vendor }); }
      else { events.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ status: 200, body: '{}' }); }
      return;
    }
    if (url.pathname === '/sw.js') { await route.fulfill({ status: 404, body: '' }); return; }
    if (url.pathname === '/catalog/release.json') { await route.fulfill({ json: { url: 'https://assets.permitdenied.app/release.json', commit: 'test', version: 'test' } }); return; }
    let relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    if (/^(privacy|terms|catalog)\/?$/.test(relative)) relative = relative.replace(/\/$/, '') + '/index.html';
    const absolute = path.resolve('dist', relative);
    assert.ok(absolute.startsWith(path.resolve('dist') + path.sep));
    try {
      const body = await readFile(absolute), extension = path.extname(relative);
      await route.fulfill({ body, contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream', headers: { 'referrer-policy': 'no-referrer' } });
    } catch { await route.fulfill({ status: 404, body: '' }); }
  });
  ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return { ctx, events, scripts };
}
try {
  {
    const { ctx: prod } = await context();
    const prodPage = await prod.newPage();
    await prodPage.goto(origin);
    await prodPage.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await prodPage.getByRole('button', { name: 'Play', exact: true }).click();
    await prodPage.getByRole('button', { name: 'Start Game', exact: true }).click();
    await prodPage.locator('#terms-agree').waitFor();
    const exposed = await prodPage.evaluate(() => {
      const pd = window.__pd;
      if (!pd) return null;
      return { version: pd.version ?? null, town: Object.prototype.hasOwnProperty.call(pd, 'town') };
    });
    assert.equal(exposed, null);
    await prod.close();
  }
  const { ctx, events, scripts } = await context();
  const page = await ctx.newPage(); await page.goto(origin + '/?debug=1'); await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  assert.equal(scripts.length, 0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await page.locator('#terms-agree').waitFor();
  assert.equal(await page.locator('#terms-continue').isDisabled(), true);
  const before = await page.evaluate(() => window.__pd.snapshot());
  await page.keyboard.press('r'); await page.keyboard.press('w'); await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__pd.snapshot());
  assert.equal(before.elapsed, after.elapsed); assert.deepEqual(before.dozer, after.dozer);
  await page.screenshot({ path: `${output}/desktop-terms.png` });
  await page.locator('#terms-agree').check(); await page.locator('#terms-continue').click();
  await page.locator('#analytics-allow').waitFor();
  assert.equal(await page.locator('#analytics-allow').isDisabled(), true);
  assert.equal(events.length, 0); assert.equal(scripts.length, 0);
  await page.locator('#analytics-decline').click();
  await page.waitForFunction(() => window.__pd?.ready?.() === true && window.__pd.snapshot().elapsed > 0);
  await page.reload(); await page.waitForFunction(() => window.__pd?.version === 1);
  assert.equal(await page.locator('.privacy-dialog').count(), 0);
  assert.equal(events.length, 0);
  // A second tab can enable consent, and withdrawal propagates back to the game.
  const settings = await ctx.newPage(); await settings.goto(origin + '/privacy');
  await settings.getByRole('button', { name: 'Privacy Settings', exact: true }).first().click();
  await settings.locator('#analytics-adult').check(); await settings.locator('#analytics-allow').click();
  await settings.waitForTimeout(400); assert.ok(scripts.length > 0);
  await page.bringToFront();
  await page.evaluate(() => { const game = window.__pd; for (let i = 0; i < 61; i++) game.analyticsStep(1, 'sandbox', 'd10'); game.finish('', true); game.reset('same'); });
  await page.waitForTimeout(300);
  assert.ok(events.some(e => e.en === 'game_started'));
  assert.ok(events.some(e => e.en === 'game_engaged'));
  assert.ok(events.some(e => e.en === 'game_finished'));
  await page.evaluate(() => window.__pd.reset('same')); await page.waitForTimeout(200);
  assert.ok(events.some(e => e.en === 'game_restarted'));
  const catalog = await ctx.newPage(); await catalog.goto(origin + '/catalog/?q=private@example.com');
  await catalog.waitForFunction(() => document.querySelector('#release').textContent.includes('assets ·'));
  await catalog.locator('#search').fill(''); await catalog.locator('#filters button').click();
  await catalog.locator('.card').first().click(); await catalog.waitForTimeout(200);
  assert.ok(events.some(e => e.en === 'catalog_asset_opened' && e.ed.asset === 'vehicle:bus'));
  for (const e of events) { assert.ok(!e.o.includes('?') && !e.o.includes('#')); assert.ok(!JSON.stringify(e).includes('private@example.com')); assert.ok(!e.r); }
  await settings.bringToFront(); await settings.getByRole('button', { name: 'Privacy Settings', exact: true }).first().click();
  await settings.locator('#analytics-decline').click(); await page.waitForTimeout(200);
  const count = events.length;
  await page.bringToFront(); await page.evaluate(() => { window.__pd.reset('same'); window.__pd.analyticsStep(100, 'sandbox', 'd10'); });
  await page.waitForTimeout(250); assert.equal(events.length, count);
  evidence.push('First-play acknowledgment, keyboard isolation, refusal persistence, adult-only consent, five events, query redaction, cross-tab withdrawal.');
  // Mobile geometry and disclosure pages are checked without loading the game.
  for (const [width, height] of [[390, 844], [844, 390], [360, 640]]) {
    const { ctx: mobile, scripts: mobileScripts } = await context({ viewport: { width, height }, isMobile: true, hasTouch: true });
    const p = await mobile.newPage(); await p.goto(origin + '/terms');
    assert.equal(await p.locator('canvas').count(), 0);
    assert.ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await p.screenshot({ path: `${output}/terms-${width}x${height}.png`, fullPage: true });
    await p.getByRole('button', { name: 'Privacy Settings', exact: true }).click();
    await p.screenshot({ path: `${output}/consent-${width}x${height}.png` });
    const box = await p.locator('.privacy-dialog').boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
    await p.keyboard.press('Escape'); assert.equal(await p.locator('.privacy-dialog').count(), 0); assert.equal(mobileScripts.length, 0);
    await mobile.close();
  }
  const { ctx: denied, scripts: deniedScripts } = await context();
  await denied.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Unavailable', 'SecurityError'); } }); });
  const p = await denied.newPage(); await p.goto(origin + '/?mode=sandbox&debug=1');
  await p.locator('#terms-agree').check(); await p.locator('#terms-continue').click(); await p.locator('#analytics-decline').click();
  await p.waitForFunction(() => window.__pd.snapshot().elapsed > 0); assert.equal(deniedScripts.length, 0);
  evidence.push('Mobile portrait/landscape disclosure and consent layout; Escape handling; gameplay with unavailable browser storage.');
  await denied.close();
  const { ctx: yard, scripts: yardScripts } = await context();
  await yard.addInitScript(({ version }) => { try { localStorage.setItem('pd.terms', version); localStorage.setItem('pd.analytics', 'adult-allowed'); } catch {} }, { version: TERMS_VERSION });
  const yp = await yard.newPage(); await yp.goto(origin + '/?testAsset=vehicle:bus'); await yp.waitForFunction(() => window.__pd?.version === 1);
  await yp.waitForTimeout(300); assert.equal(yardScripts.length, 0); await yard.close();
  evidence.push('Focused test map excluded even with a stored adult opt-in.');
  const { ctx: slow, events: slowEvents } = await context();
  let releaseScript;
  const ready = new Promise(resolve => { releaseScript = resolve; });
  await slow.route('**/_vercel/insights/script.js', async route => { await ready; await route.fallback(); });
  const sp = await slow.newPage(); await sp.goto(origin + '/privacy');
  await sp.getByRole('button', { name: 'Privacy Settings', exact: true }).first().click();
  await sp.locator('#analytics-adult').check(); await sp.locator('#analytics-allow').click();
  await sp.getByRole('button', { name: 'Privacy Settings', exact: true }).first().click(); await sp.locator('#analytics-decline').click();
  releaseScript(); await sp.waitForTimeout(300); assert.equal(slowEvents.length, 0); await slow.close();
  evidence.push('Withdrawal before a delayed vendor script loads discards queued reporting.');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ evidence, eventNames: [...new Set(events.map(e => e.en).filter(Boolean))], errors, note: 'Browser emulation; collection requests intercepted, no production analytics ingested.' }, null, 2));
  console.log(evidence.join('\n'));
} finally { await browser.close(); }
