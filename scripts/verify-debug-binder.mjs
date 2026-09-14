import { privacyTestSetup } from './privacy-test-setup.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.DEBUG_TEST_URL || 'http://127.0.0.1:5178';
const output = process.argv[2] || 'artifacts/debug-binder';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], results = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await privacyTestSetup(page);
page.on('pageerror', e => errors.push(e.message));
const button = name => page.getByRole('button', { name, exact: true });
const tab = name => page.getByRole('tab', { name, exact: true });
const snapshot = () => page.evaluate(() => {
  const g = window.__pd, b = g.town.yard?.bays[0];
  return { mode: g.mode, seed: g.rules.seed, request: g.rules.testMap, upgrades: { ...g.upgrades },
    binder: structuredClone(g.hud.binder), debug: { ...g.renderer.debug }, dozer: { x: g.dozer.x, y: g.dozer.y },
    spawn: { x: g.town.spawnX, y: g.town.spawnY }, elapsed: g.elapsed, bays: g.town.yard?.bays.length, vehicles: g.town.vehicles.length,
    following: !!g.town.roadCar && g.town.vehicles.includes(g.town.roadCar), status: b?.vehicle?.status,
    damage: b?.vehicle?.parts.reduce((sum, p) => sum + p.damage, 0), rubble: g.town.rubble.length,
    scroll: document.querySelector('.debug-pages').scrollTop };
});
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const selectAsset = async (id, variant = 0) => {
  await tab('Assets').click();
  await page.locator('[data-search]').fill('');
  for (const name of ['category', 'material', 'profile']) await page.locator('[data-' + name + ']').selectOption('');
  await page.locator('[data-assets]').selectOption(id);
  await page.locator('[data-variant]').fill(String(variant));
  await button('Test This Asset').click(); await settle();
};
try {
  await page.goto(base + '/?sandbox=1&seed=81'); await page.waitForFunction(() => window.__pd);
  await button('Debug').click();
  assert.equal(await tab('Assets').getAttribute('aria-selected'), 'true');
  assert.equal((await snapshot()).mode, 'play');
  const count = await page.locator('[data-assets] option').count(); assert.ok(count > 190);
  await page.locator('[data-category]').selectOption('vehicle');
  await page.locator('[data-search]').fill('bus');
  await page.locator('[data-variant]').fill('1');
  await button('Test This Asset').click(); await settle();
  assert.deepEqual((await snapshot()).request, { kind: 'asset', assetId: 'vehicle:bus', variant: 1 });
  assert.equal((await snapshot()).bays, 1);
  await tab('Session').click(); await page.locator('[data-up=blade]').click(); await page.locator('[data-up=engine]').click();
  await tab('Inspector').click();
  await page.getByRole('checkbox', { name: 'Freeze Simulation', exact: true }).check();
  await page.locator('[data-debug=roofs]').uncheck();
  await page.locator('#debug-floor').selectOption('0');
  await page.locator('.debug-pages').evaluate(el => { el.scrollTop = 210; }); await settle();
  const before = await snapshot();
  await button('Reset Test').click(); await settle();
  const after = await snapshot();
  assert.deepEqual(after.upgrades, before.upgrades); assert.deepEqual(after.debug, before.debug);
  assert.equal(after.binder.tab, 'inspector'); assert.equal(after.binder.search, 'bus');
  assert.equal(after.binder.category, 'vehicle'); assert.equal(after.binder.variant, 1);
  assert.equal(after.scroll, before.scroll); assert.equal(after.elapsed, 0);
  await button('Step One Frame').click(); await settle();
  assert.ok(Math.abs((await snapshot()).elapsed - 1 / 60) < 1e-6);
  results.push('Focused launch, filters, upgrades, Inspector scroll, freeze and single-step persist.');

  await tab('Assets').click();
  for (let cycle = 0; cycle < 10; cycle++) {
    await page.locator('[data-side]').click(); assert.ok((await snapshot()).damage > 0);
    const scroll = (await snapshot()).scroll;
    await button('Reset Test').click(); await settle();
    const clean = await snapshot();
    assert.equal(clean.status, 'operational'); assert.equal(clean.damage, 0); assert.equal(clean.rubble, 0);
    assert.equal(clean.vehicles, 1); assert.equal(clean.bays, 1); assert.deepEqual(clean.dozer, clean.spawn);
    assert.equal(clean.scroll, scroll); assert.deepEqual(clean.upgrades, before.upgrades);
  }
  await page.locator('[data-follow]').click(); await button('Reset Test').click(); await settle();
  assert.equal((await snapshot()).following, true);
  await page.locator('[data-run]').click();
  assert.equal(await page.evaluate(() => window.__pd.town.vehicles[0].autonomous), true);
  await page.locator('[data-stop]').click();
  await page.locator('[data-section=vehicle]').evaluate(el => { el.open = false; }); await settle();
  await button('Reset Test').click(); await settle();
  assert.equal(await page.locator('[data-section=vehicle]').evaluate(el => el.open), false);
  await button('Close Debug').click(); await button('Debug').click();
  assert.equal((await snapshot()).binder.assetId, 'vehicle:bus'); assert.equal((await snapshot()).binder.tab, 'assets');
  await page.evaluate(() => { window.__pd.dozer.x += 1; });
  const typingPosition = (await snapshot()).dozer;
  await page.locator('[data-search]').fill('r');
  assert.deepEqual((await snapshot()).dozer, typingPosition);
  assert.equal((await snapshot()).binder.search, 'r'); // text input is not a restart shortcut
  const held = await snapshot(); await page.keyboard.press('w'); await settle();
  assert.deepEqual((await snapshot()).dozer, held.dozer);
  await page.locator('[data-search]').fill('bus');
  await page.locator('[data-assets]').selectOption('vehicle:bus');
  await page.locator('[data-variant]').fill('1');
  await page.locator('[data-section=vehicle]').evaluate(el => { el.open = true; });
  await page.locator('[data-front]').click();
  await page.locator('#game-root canvas').focus(); await page.keyboard.press('r'); await settle();
  assert.equal((await snapshot()).damage, 0); assert.deepEqual((await snapshot()).dozer, (await snapshot()).spawn);
  await tab('Assets').focus(); await page.keyboard.press('ArrowRight');
  assert.equal((await snapshot()).binder.tab, 'inspector');
  await page.keyboard.press('End'); assert.equal((await snapshot()).binder.tab, 'session');
  await page.keyboard.press('Home'); assert.equal((await snapshot()).binder.tab, 'assets');
  await page.keyboard.press('Escape'); assert.equal((await snapshot()).binder.open, false);
  await button('Debug').click();
  await page.locator('[data-frame]').click();
  await page.screenshot({ path: output + '/desktop-focused.png' });
  results.push('Ten damage/reset cycles, stable camera following, expanded sections, and input isolation.');

  await button('All Assets Sandbox').click(); await settle();
  assert.equal((await snapshot()).request.kind, 'yard'); assert.equal((await snapshot()).bays, count);
  assert.equal((await snapshot()).binder.search, 'bus'); assert.equal((await snapshot()).binder.variant, 1);
  assert.equal(await button('All Assets Sandbox').isVisible(), true);
  await button('Reset Entire Yard').click(); await settle();
  assert.equal((await snapshot()).binder.search, 'bus'); assert.deepEqual((await snapshot()).upgrades, before.upgrades);
  await tab('Session').click();
  assert.equal(await page.locator('[data-demo], [data-tower]').count(), 0);
  await page.locator('[data-session=challenge]').click(); await settle();
  assert.equal((await snapshot()).request, undefined);
  assert.deepEqual((await snapshot()).upgrades, { blade: 0, engine: 0, push: 0 });
  assert.equal((await snapshot()).binder.tab, 'session');
  await page.locator('[data-act=job]').click(); await settle();
  assert.equal(await page.evaluate(() => !!window.__pd.job), true);
  results.push('Full sandbox entry and reset, normal restart semantics, and Brick challenge retained.');

  await tab('Inspector').click(); await page.locator('[data-debug=roofs]').check(); await page.locator('#debug-floor').selectOption('99');
  for (const id of ['vehicle:bus', 'vehicle:combine', 'vehicle:tractor-trailer', 'building:union-tower', 'site:farmstead', 'fixture:interior-sofa', 'prop:barricade']) {
    await selectAsset(id, id.startsWith('vehicle:') ? 1 : 0);
    assert.equal((await snapshot()).bays, 1);
    assert.equal(await page.evaluate(() => window.__pd.town.yard.issues.length), 0);
    await page.locator('[data-frame]').click();
    await page.screenshot({ path: output + '/' + id.replace(':', '-') + '.png' });
    await page.locator('[data-destroy]').click();
    await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__pd.step(1 / 60); });
    await page.screenshot({ path: output + '/' + id.replace(':', '-') + '-damaged.png' });
    await button('Reset Test').click();
  }
  await page.goto(base + '/?testAsset=missing'); await page.waitForFunction(() => window.__pd);
  assert.match(await page.locator('[data-status]').innerText(), /Unknown asset.*catalog/);
  assert.equal((await snapshot()).bays, 0);
  await selectAsset('vehicle:bus'); assert.equal((await snapshot()).bays, 1);
  results.push('Large vehicles, tower, composite site, fixture and prop destruction; invalid-link recovery.');

  for (const [width, height] of [[390, 844], [844, 390], [360, 640], [640, 360]]) {
    const mobile = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', e => errors.push(e.message));
    await privacyTestSetup(mobile);
    await mobile.goto(base + '/?testAsset=vehicle:bus&controls=1'); await mobile.waitForFunction(() => window.__pd);
    const geometry = await mobile.evaluate(() => {
      const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
      return { panel: rect('#debug-panel'), stick: rect('.touch-stick'), blade: rect('.touch-blade'), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.panel.bottom < geometry.stick.y, JSON.stringify(geometry));
    assert.ok(geometry.panel.bottom < geometry.blade.y, JSON.stringify(geometry));
    await mobile.locator('[data-category]').selectOption('vehicle');
    await mobile.locator('[data-assets]').selectOption('vehicle:tractor-trailer');
    await mobile.locator('[data-test]').click();
    assert.equal(await mobile.evaluate(() => window.__pd.mode), 'play');
    await mobile.locator('[data-run]').click();
    await mobile.locator('[data-stop]').click();
    await mobile.screenshot({ path: output + '/mobile-' + width + 'x' + height + '.png' });
    const savedScroll = await mobile.evaluate(() => window.__pd.hud.binder.scroll.assets);
    await mobile.locator('#debug-collapse').click();
    const stick = await mobile.locator('.touch-stick').boundingBox();
    const client = await mobile.context().newCDPSession(mobile);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2, y: stick.y + 10, id: 1 }] });
    assert.ok(await mobile.evaluate(() => window.__pd.input.axis().throttle > 0));
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.screenshot({ path: output + '/mobile-' + width + 'x' + height + '-collapsed.png' });
    await mobile.locator('#debug-collapse').click();
    assert.equal(await mobile.evaluate(() => window.__pd.hud.binder.scroll.assets), savedScroll);
    await mobile.locator('#debug-reset-test').click();
    assert.equal(await mobile.locator('[data-assets]').inputValue(), 'vehicle:tractor-trailer');
    await mobile.locator('#debug-close').click(); await mobile.locator('#mobile-debug').click();
    assert.equal(await mobile.locator('[data-assets]').inputValue(), 'vehicle:tractor-trailer');
    await mobile.locator('#mobile-pause').click();
    await mobile.locator('[data-menu-action=debug]').click();
    await mobile.waitForFunction(() => window.__pd.mode === 'play' && !document.querySelector('#debug-panel').hidden);
    await mobile.close();
    results.push('Mobile ' + width + 'x' + height + ': reachable controls, reset, drawer, touch driving, pause-to-live Debug.');
  }
  assert.deepEqual(errors, []);
  await writeFile(output + '/browser-report.json', JSON.stringify({ browser: browser.version(), errors, results }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  await page.screenshot({ path: output + '/failure.png' }).catch(() => {});
  console.error('Browser errors:', errors); throw error;
} finally { await browser.close(); }
