import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { privacyTestSetup } from './privacy-test-setup.mjs';
import { assertDebugControlsReachable } from './debug-reachability.mjs';
const base = process.env.DEBUG_TEST_URL || 'http://127.0.0.1:5178';
const out = 'artifacts/menu-usability';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, hasTouch: true });
  await privacyTestSetup(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/?mode=challenge&level=county&debug=1&controls=1');
  await page.waitForFunction(() => window.__pd?.ready());
  await page.waitForTimeout(250);
  if (await page.locator('[data-act=begin]').isVisible()) await page.locator('[data-act=begin]').click();
  await page.getByRole('button', { name: 'Pause', exact: true }).filter({ visible: true }).click();
  await page.locator('[data-menu-action=debug]').click();
  await page.waitForFunction(() => window.__pd.inspect().debug.freeze && !document.querySelector('#debug-panel').hidden);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'debug-panel', 'Keyboard focus follows the paused Debug transition');
  const elapsed = await page.evaluate(() => window.__pd.inspect().elapsed);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pd.inspect().elapsed), elapsed, 'Pause-to-Debug must not spend challenge time');
  await page.locator('#debug-step').click();
  assert.ok(Math.abs(await page.evaluate(() => window.__pd.inspect().elapsed) - elapsed - 1/60) < 1e-6);
  await page.locator('#debug-close').click();
  assert.equal(await page.locator('#simulation-frozen').isVisible(), true);
  await page.locator('#resume-simulation').click();
  await page.waitForFunction(value => window.__pd.inspect().elapsed > value + 1/60, elapsed);
  assert.equal(await page.locator('#simulation-frozen').isVisible(), false);
  await page.getByRole('button', { name: 'Debug', exact: true }).filter({ visible: true }).click();
  await page.locator('[data-debug=freeze]').check();
  await page.waitForFunction(() => document.querySelector('[data-assets]')?.options.length > 100);
  const snapshot = () => page.evaluate(() => {
    const s = window.__pd.inspect();
    return { seed: s.seed, elapsed: s.elapsed, request: s.request, upgrades: s.upgrades, dozer: s.dozer, url: location.href };
  });
  const cancel = async selector => {
    const before = await snapshot();
    const dialog = page.waitForEvent('dialog');
    const click = page.locator(selector).click();
    const prompt = await dialog;
    assert.match(prompt.message(), /replaces your current run.*cannot undo/i);
    await prompt.dismiss(); await click;
    assert.deepEqual(await snapshot(), before, 'Cancel must preserve the run');
  };
  await cancel('#debug-open-yard');
  await cancel('[data-test]');
  await page.getByRole('tab', { name: 'Session', exact: true }).click();
  await cancel('[data-session=sandbox]');
  await cancel('[data-level=village]');
  const dialog = page.waitForEvent('dialog');
  const click = page.locator('#debug-open-yard').click();
  await (await dialog).accept(); await click;
  await page.waitForFunction(() => window.__pd.inspect().request?.kind === 'yard');
  assert.equal(await page.locator('#debug-open-yard').innerText(), 'Open All-Assets Test Map');
  for (const size of [{ width: 1440, height: 900 }, { width: 640, height: 360 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.getByRole('tab', { name: 'Assets', exact: true }).click();
    await assertDebugControlsReachable(page, '#debug-panel .debug-toolbar');
    await assertDebugControlsReachable(page, '#debug-assets');
    for (const selector of ['[data-category]', '[data-material]', '[data-profile]', '[data-assets]']) {
      const field = page.locator(selector);
      assert.notEqual(await field.evaluate(el => getComputedStyle(el).backgroundImage), 'none');
      assert.ok(await field.evaluate(el => el.labels.length > 0));
    }
    await page.locator('[data-test]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/assets-${size.width}.png` });
  }
  await page.goto(base + '/?debug=1');
  await page.locator('[data-nav=dispatch]').click();
  assert.equal(await page.locator('#dispatch-mode').evaluate(el => el.parentElement.contains(document.querySelector('#mode-description'))), true);
  assert.equal(await page.locator('#season-note').innerText(), 'Choose a season, or let the game choose.');
  await page.locator('#dispatch-mode').selectOption('challenge');
  assert.match(await page.locator('#mode-description').innerText(), /Seven-level campaign/);
  assert.deepEqual(errors, []);
  console.log('Menu safety, pause/freeze recovery, responsive reachability, dropdown cues, and setup copy passed.');
} finally { await browser.close(); }
