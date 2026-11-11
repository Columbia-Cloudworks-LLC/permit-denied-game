import { TERMS_VERSION } from './terms-version.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * Play → Illinois → Go → County 1 → Go: the menu path that starts a game. Play opens the road
 * atlas directly; it arrives folded and its flap swings open, so each step waits for the fold to
 * land. Works on the real atlas or its schematic fallback.
 */
async function deployFirstCounty(page) {
  await page.locator('.atlas-macro').waitFor();
  await page.waitForFunction(() => !document.querySelector('.atlas-flap'));
  await page.locator('[data-region-id="US-IL"]').click();
  const go = page.locator('.atlas-go').last();
  await go.click();
  await page.locator('.atlas-sheet').waitFor();
  await page.waitForFunction(() => !document.querySelector('.atlas-flap') && document.querySelector('.atlas-sheet').getAnimations({ subtree: true }).every(a => a.playState === 'finished'));
  // County labels let clicks through to the county cell underneath.
  const label = await page.locator('[data-county-label="1"] .num').boundingBox();
  await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2);
  await go.click();
}

// Exercise the production bundle at a routed production origin. The checks are about our page:
// the terms gate, consent dialogs, and whether the analytics script is ever requested. What the
// vendor may send (path redaction, withdrawal, queued events) is unit-tested in src/privacy/, so
// this script needs no network fetch and no timing-based waits for vendor traffic.
const output = process.env.PRIVACY_OUTPUT || 'artifacts/privacy';
await mkdir(output, { recursive: true });
const VENDOR_STUB = '/* analytics vendor stub: requests are counted, nothing is sent */';
const VENDOR_SCRIPT = /\/_vercel\/insights\/script\.js$/;
const browser = await chromium.launch({ headless: true });
const errors = [], evidence = [];
const origin = 'https://permitdenied.app';
async function shoot(page, path, options = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.screenshot({ path, ...options });
      return;
    } catch (error) {
      last = error;
      await page.waitForTimeout(400);
    }
  }
  throw last;
}

/** The analytics vendor script (a stub, counted) or a collection request (absorbed). */
async function serveInsights(route, url, scripts) {
  if (url.pathname.endsWith('script.js')) {
    scripts.push(url.pathname);
    await route.fulfill({ contentType: 'text/javascript', body: VENDOR_STUB });
    return;
  }
  await route.fulfill({ status: 200, body: '{}' });
}

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

/** A built file from dist/, with page directories resolved to their index.html; 404 when missing. */
async function serveDist(route, pathname) {
  const relative = distPath(pathname);
  const absolute = path.resolve('dist', relative);
  assert.ok(absolute.startsWith(path.resolve('dist') + path.sep));
  try {
    const body = await readFile(absolute);
    await route.fulfill({ body, contentType: CONTENT_TYPES[path.extname(relative)] ?? 'application/octet-stream', headers: { 'referrer-policy': 'no-referrer' } });
  } catch { await route.fulfill({ status: 404, body: '' }); }
}

/** The built file for a URL path: the root and page directories serve their index.html. */
function distPath(pathname) {
  if (pathname === '/') return 'index.html';
  const relative = pathname.replace(/^\//, '');
  return /^(privacy|terms)\/?$/.test(relative) ? relative.replace(/\/$/, '') + '/index.html' : relative;
}

async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36', ...options });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const scripts = [];
  await ctx.route('https://permitdenied.app/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/_vercel/insights/')) await serveInsights(route, url, scripts);
    else if (url.pathname === '/sw.js') await route.fulfill({ status: 404, body: '' });
    else await serveDist(route, url.pathname);
  });
  ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return { ctx, scripts };
}
try {
  {
    const { ctx: prod } = await context();
    const prodPage = await prod.newPage();
    await prodPage.goto(origin);
    await prodPage.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await prodPage.getByRole('button', { name: 'Play', exact: true }).click();
    await deployFirstCounty(prodPage);
    await prodPage.locator('#terms-agree').waitFor();
    const exposed = await prodPage.evaluate(() => {
      const pd = window.__pd;
      if (!pd) return null;
      return { version: pd.version ?? null, town: Object.prototype.hasOwnProperty.call(pd, 'town') };
    });
    assert.equal(exposed, null);
    await prod.close();
  }
  const { ctx, scripts } = await context();
  const page = await ctx.newPage(); await page.goto(origin + '/?debug=1'); await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  assert.equal(scripts.length, 0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await deployFirstCounty(page);
  await page.locator('#terms-agree').waitFor();
  assert.equal(await page.locator('#terms-continue').isDisabled(), true);
  const before = await page.evaluate(() => window.__pd.snapshot());
  await page.keyboard.press('r'); await page.keyboard.press('w'); await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__pd.snapshot());
  assert.equal(before.elapsed, after.elapsed); assert.deepEqual(before.dozer, after.dozer);
  await shoot(page, `${output}/desktop-terms.png`);
  await page.locator('#terms-agree').check(); await page.locator('#terms-continue').click();
  await page.locator('#analytics-allow').waitFor();
  assert.equal(await page.locator('#analytics-allow').isDisabled(), true);
  assert.equal(scripts.length, 0);
  await page.locator('#analytics-decline').click();
  // Time Challenge is the default mode, and a county opens on its briefing with the clock held.
  await page.locator('[data-act=begin]').click();
  await page.waitForFunction(() => window.__pd?.ready?.() === true && window.__pd.snapshot().elapsed > 0);
  await page.reload(); await page.waitForFunction(() => window.__pd?.version === 1);
  assert.equal(await page.locator('.privacy-dialog').count(), 0);
  assert.equal(scripts.length, 0);
  // An adult opt-in in a second tab loads analytics there and, through the storage event, in the game tab.
  const settings = await ctx.newPage(); await settings.goto(origin + '/privacy');
  await settings.getByRole('button', { name: 'Privacy Settings', exact: true }).first().click();
  await settings.locator('#analytics-adult').check();
  const loaded = Promise.all([settings.waitForRequest(VENDOR_SCRIPT), page.waitForRequest(VENDOR_SCRIPT)]);
  await settings.locator('#analytics-allow').click();
  await loaded;
  evidence.push('First-play acknowledgment, keyboard isolation, refusal persistence, adult-only consent, cross-tab opt-in loads analytics.');
  // Mobile geometry and disclosure pages are checked without loading the game.
  for (const [width, height] of [[390, 844], [844, 390], [360, 640]]) {
    const { ctx: mobile, scripts: mobileScripts } = await context({ viewport: { width, height }, isMobile: true, hasTouch: true });
    const p = await mobile.newPage(); await p.goto(origin + '/terms');
    assert.equal(await p.locator('canvas').count(), 0);
    assert.ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await shoot(p, `${output}/terms-${width}x${height}.png`, { fullPage: true });
    await p.getByRole('button', { name: 'Privacy Settings', exact: true }).click();
    await shoot(p, `${output}/consent-${width}x${height}.png`);
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
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ evidence, errors, note: 'Browser emulation with a stub analytics script; collection requests intercepted, nothing ingested.' }, null, 2));
  console.log(evidence.join('\n'));
} finally { await browser.close(); }
