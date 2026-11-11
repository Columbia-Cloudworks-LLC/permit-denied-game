import { privacyTestSetup } from './privacy-test-setup.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import {

  assertWebAppManifest,
  htmlHasAppleTouchIcon,
  htmlHasManifestLink,
  htmlHasPngFavicon,
  htmlKeepsIcoFavicon,
} from './pwa.mjs';
/**
 * Play → tap a state → its seven county badges → Go → tap a county → Go: the menu
 * path that starts a game, checked against the full-viewport road atlas on a phone.
 */
async function deployFirstCounty(page) {
  await page.locator('.atlas-macro').waitFor();
  // The atlas arrives folded and its flap swings open; wait for it to land.
  await page.waitForFunction(() => !document.querySelector('.atlas-flap'));
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.map-open .console-panel').getBoundingClientRect();
    return { panel: [panel.width, panel.height], overflow: document.documentElement.scrollWidth > innerWidth, size: [innerWidth, innerHeight] };
  });
  assert.deepEqual(layout.panel, layout.size, 'The atlas fills the viewport edge to edge');
  assert.equal(layout.overflow, false);
  assert.equal(await page.locator('#region-search').count(), 0, 'No search sidebar');
  await assertTouchPan(page);
  await page.locator('[data-region-id="US-IL"]').tap();
  const go = page.locator('.atlas-go').last();
  assert.equal(await go.innerText(), 'Go to Illinois');
  assert.equal(await page.locator('[data-atlas-bar=macro] [data-county-slot]').count(), 7);
  await page.screenshot({ path: `${output}/atlas-macro.png` });
  await go.tap();
  await page.locator('.atlas-sheet').waitFor();
  // The sheet unfolds in from the right; measure label positions only once it has settled.
  await page.waitForFunction(() => !document.querySelector('.atlas-flap') && document.querySelector('.atlas-sheet').getAnimations({ subtree: true }).every(a => a.playState === 'finished'));
  assert.equal(await go.isDisabled(), true);
  assert.equal(await go.innerText(), 'Select a County');
  // Time Challenge is the default; the rest of this check plays Sandbox, switched on the sheet itself.
  assert.equal(await page.locator('.atlas-sheet [data-pick=mode][aria-pressed=true]').getAttribute('data-value'), 'challenge');
  await page.locator('.atlas-sheet [data-pick=mode][data-value=sandbox]').tap();
  assert.equal(await page.locator('.atlas-sheet [data-pick=mode][aria-pressed=true]').getAttribute('data-value'), 'sandbox');
  assert.equal(await page.locator('.atlas-sheet .atlas-flap').count(), 0, 'A mode change redraws the sheet without refolding it');
  // Labels let taps through to the county cell underneath, as on a real phone.
  const label = await page.locator('[data-county-label="1"] .num').boundingBox();
  await page.touchscreen.tap(label.x + label.width / 2, label.y + label.height / 2);
  assert.equal(await page.locator('.atlas-sheet [data-county-index="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await go.innerText(), 'Go to Farmstead County');
  await page.screenshot({ path: `${output}/atlas-sheet.png` });
  await go.tap();
}

/**
 * A one-finger drag that starts on a state must pan the whole distance. Touch pointers are
 * implicitly captured by the path under the finger; a regression here pans one step and stops.
 */
async function assertTouchPan(page) {
  await page.locator('.atlas-macro [data-zoom=in]').tap();
  await page.locator('.atlas-macro [data-zoom=in]').tap();
  const svg = page.locator('.overworld-map');
  const view = async () => (await svg.getAttribute('viewBox')).split(' ').map(Number);
  const box = await page.locator('.atlas-macro .atlas-viewport').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  assert.ok(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('[data-region-id]'), [x, y]), 'Drag starts on a state');
  const before = await view();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] });
  for (let step = 1; step <= 12; step++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + step * 10, y, id: 7 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await view();
  const rect = await svg.boundingBox();
  const pxPerUnit = Math.min(rect.width / before[2], rect.height / before[3]);
  const moved = (before[0] - after[0]) * pxPerUnit;
  assert.ok(moved > 100, `Touch drag of 120px panned only ${moved.toFixed(1)}px`);
  assert.equal(await page.locator('[data-region-id][aria-pressed=true]').count(), 0, 'A touch pan never selects');
  // Put the whole map back in view: zoomed 2.56× and dragged right, the eastern states are off screen.
  await page.locator('.atlas-macro [data-zoom=reset]').tap();
  await page.locator('.atlas-macro [data-zoom=reset]').tap();
}

const base = process.env.MOBILE_TEST_URL || 'http://localhost:5173';
const output = process.argv[2] || 'docs/visual-verification/mobile-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await privacyTestSetup(page);
page.on('dialog', dialog => dialog.accept());
page.on('pageerror', error => errors.push(error.message));

async function assertPwaDiscovery(target) {
  const html = await target.content();
  assert.equal(htmlHasManifestLink(html), true);
  assert.equal(htmlKeepsIcoFavicon(html), true);
  assert.equal(htmlHasPngFavicon(html), true);
  assert.equal(htmlHasAppleTouchIcon(html), true);
  const manifestResponse = await target.request.get(new URL('/manifest.webmanifest', base).href);
  assert.equal(manifestResponse.ok(), true, 'web app manifest must be available');
  const manifest = await manifestResponse.json();
  assertWebAppManifest(manifest);
  for (const icon of manifest.icons) {
    const iconResponse = await target.request.get(new URL(icon.src, base).href);
    assert.equal(iconResponse.ok(), true, `${icon.src} must be available`);
  }
  await assertServedServiceWorker(target);
}

/** Where the origin serves a worker it must precache the shell; dev origins may serve none. */
async function assertServedServiceWorker(target) {
  const sw = await target.request.get(new URL('/sw.js', base).href);
  const swType = sw.headers()['content-type'] || '';
  const swBody = await sw.text();
  if (sw.ok() && swType.includes('javascript')) {
    assert.match(swBody, /precacheAndRoute|createHandlerBoundToURL/);
  } else {
    console.log('Service worker is not served on this origin; production builds are checked by verify-pwa.');
  }
}

try {
  await page.goto(`${base}/?controls=1`);
  await assertPwaDiscovery(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/installed-landscape.png` });
  console.log('installed landscape 844x390: PWA manifest and icons available');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await deployFirstCounty(page);
  await page.locator('.mobile-hud').waitFor({ state: 'visible' });
  for (const [width, height] of [[360,640],[640,360],[390,844],[844,390],[430,932],[932,430],[768,1024],[1024,768]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const geometry = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom }; };
      return { mode:document.querySelector('#hud-root').dataset.hudMode, actions:rect('.hud-actions'), cashStat:rect('.cash-stat'), clockStat:rect('.clock-stat'), game:rect('#game-root'), hud:rect('.mobile-hud'), stick:rect('.touch-stick'), blade:rect('.touch-blade'), pause:rect(document.querySelector('#hud-root').dataset.hudMode === 'text' ? '#mobile-pause' : '#hud-menu'), overflow:document.documentElement.scrollWidth > innerWidth, center:document.elementFromPoint(innerWidth/2,innerHeight/2)?.tagName };
    });
    assert.equal(geometry.game.h, height);
    assert.equal(geometry.game.w, width);
    assert.ok(geometry.hud.h <= (height > width ? 80 : 64));
    assert.equal(geometry.stick.w, height > width ? 112 : 96);
    assert.equal(geometry.blade.w,80);
    assert.ok(geometry.pause.h>=44);
    assert.equal(geometry.overflow,false);
    assert.equal(geometry.center,'CANVAS');
    for (const box of [geometry.hud,geometry.stick,geometry.blade]) assert.ok(box.x >= 0 && box.right <= width && box.y >= 0 && box.bottom <= height);
    assert.ok(geometry.stick.right < geometry.blade.x);
    if (width > height && height <= 500 && geometry.mode !== 'text') {
      // Landscape phones split the dash: controls rail left, readouts rail right, meters under the readouts.
      assert.ok(geometry.actions.right < width / 2 && geometry.actions.right < geometry.cashStat.x, JSON.stringify(geometry));
      assert.ok(geometry.clockStat.right >= width - 24 && geometry.clockStat.right <= width, JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.hud.x - geometry.cashStat.x) <= 1 && geometry.hud.y >= geometry.cashStat.bottom, JSON.stringify(geometry));
    }
    await page.screenshot({ path:`${output}/${width}x${height}.png` });
    console.log(`${width}x${height}: canvas ${geometry.game.h}px, HUD ${geometry.hud.h}px`);
  }
  await page.setViewportSize({ width:390,height:844 });
  await page.getByRole('button',{name:'Pause',exact:true}).filter({visible:true}).click();
  await page.getByRole('button',{name:'Equipment & Objective',exact:true}).click();
  await page.locator('.equipment-details').waitFor();
  // The page states the run's objective; dozer stats moved to the Home Yard's Heavy Shop.
  assert.match(await page.locator('.equipment-details').innerText(),/Sandbox · demolish freely/);
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.locator('.operator-menu').getByRole('button',{name:'Debug',exact:true}).click();
  await page.getByRole('checkbox',{name:'Freeze Simulation',exact:true}).check();
  await page.getByRole('button',{name:'Step One Frame',exact:true}).click();
  await page.getByRole('checkbox',{name:'Freeze Simulation',exact:true}).uncheck();
  await page.getByRole('tab',{name:'Session',exact:true}).click();
  await page.getByRole('tab',{name:'Assets',exact:true}).click();
  await page.screenshot({path:`${output}/debug-menu.png`});
  await page.getByRole('button',{name:'Close Debug',exact:true}).click();
  await page.locator('.mobile-hud').waitFor({state:'visible'});

  await page.getByRole('button',{name:'Pause',exact:true}).filter({visible:true}).click();
  await page.locator('.operator-menu').getByRole('button',{name:'Debug',exact:true}).click();
  await page.getByRole('tab',{name:'Session',exact:true}).click();
  await page.getByRole('button',{name:'Brick Building Demolition',exact:true}).click();
  await page.locator('#mobile-job').waitFor({state:'visible'});

  const desktop = await browser.newPage({viewport:{width:1440,height:900}});
  desktop.on('pageerror',error=>errors.push(error.message));
  await desktop.goto(`${base}/?sandbox=1`);
  await desktop.locator('.top').waitFor({state:'visible'});
  assert.equal(await desktop.locator('#hud-cash').isVisible(),true);
  assert.equal(await desktop.locator('#hud-time').isVisible(),true);
  await desktop.screenshot({path:`${output}/desktop.png`});
  await desktop.close();

  const sourceHud = await page.request.get(new URL('/src/render/hud.ts', base).href);
  const sourceType = sourceHud.headers()['content-type'] || '';
  const sourceBody = await sourceHud.text();
  const hasViteHud = sourceHud.ok() && !sourceType.includes('html') && /export\s+(class|async function|function|const)\s+Hud/.test(sourceBody);
  if (!hasViteHud) {
    assert.deepEqual(errors,[]);
    console.log('Production mobile startup, HUD, job, and desktop checks passed (Vite-source HUD fixture skipped).');
  } else {
  // Isolated real HUD/controls with deterministic state for warnings and pointer ownership.
  await page.route('**/__mobile-fixture', route => route.fulfill({ contentType:'text/html', body:'<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/src/style.css"><div id="game-root"><canvas></canvas></div><div id="hud-root"></div>' }));
  await page.goto(`${base}/__mobile-fixture`);
  await page.evaluate(async () => {
    const { Hud } = await import('/src/render/hud.ts');
    const { TouchControls } = await import('/src/render/touchControls.ts');
    const { Resubmission } = await import('/src/game/resubmission.ts');
    const state = { hasYard:false,cash:123456789,timeLeft:120,elapsed:3661,session:'sandbox',district:'d10',bladeDown:false,muted:true,heat:66,track:88,overlay:'none',death:null,won:false,resubmitted:false,job:{progress:.8,remaining:10,instruction:'Clear the remaining walls.',paid:false,payout:250} };
    const hud = new Hud(document.querySelector('#hud-root'));
    const fixture = window.mobileFixture = {state,hud,input:null,releases:0};
    const touch = fixture.touch = new TouchControls(hud.root,{change:value=>fixture.input=value,release:()=>fixture.releases++,interact:()=>{},resize:()=>{}});
    const render = fixture.render = () => {hud.render(state);touch.setBlocked(state.overlay !== 'none');};
    hud.onMenu = () => {state.overlay='pause';render();};
    hud.onResume = () => {state.overlay='none';render();};
    const permit = new Resubmission();
    hud.onResubmit = () => {const fee=permit.charge(state.cash,()=>0);if(fee!==null){state.cash-=fee;state.resubmitted=permit.used;}return fee;};
    render();
  });
  assert.equal(await page.locator('#mobile-clock').innerText(),'1:01:01');
  assert.equal(await page.locator('#mobile-cash').innerText(),'$123,456,789');
  assert.match(await page.locator('#mobile-warning').innerText(),/HIGH HEAT/);
  assert.equal(await page.locator('#mobile-track').getAttribute('aria-valuenow'),'88');
  await page.screenshot({path:`${output}/warnings-job.png`});
  const client = await page.context().newCDPSession(page);
  const stick = await page.locator('.touch-stick').boundingBox();
  const blade = await page.locator('.touch-blade').boundingBox();
  const points = [{x:stick.x+stick.width/2,y:stick.y+12,id:1},{x:blade.x+40,y:blade.y+40,id:2}];
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
  let input = await page.evaluate(()=>window.mobileFixture.input);
  assert.ok(input.throttle > 0); assert.equal(input.blade,true);
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  input = await page.evaluate(()=>window.mobileFixture.input);
  assert.equal(input.throttle,0); assert.equal(input.blade,false);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
  await page.setViewportSize({width:844,height:390});
  await page.waitForTimeout(100);
  input = await page.evaluate(()=>window.mobileFixture.input);
  assert.equal(input.throttle,0); assert.equal(input.blade,false);
  await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  const rotatedStick = await page.locator('.touch-stick').boundingBox();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rotatedStick.x+48,y:rotatedStick.y+10,id:3}]});
  await page.evaluate(()=>window.mobileFixture.hud.onMenu());
  assert.equal(await page.evaluate(()=>window.mobileFixture.input.throttle),0);
  await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await page.getByRole('button',{name:'Equipment & Objective',exact:true}).click();
  await page.evaluate(()=>window.mobileFixture.render());
  assert.match(await page.locator('.equipment-details').innerText(),/Clear the remaining walls/);
  await page.getByRole('button',{name:'Resubmit Application — spends cash',exact:true}).click();
  await page.evaluate(()=>window.mobileFixture.render());
  assert.equal(await page.evaluate(()=>window.mobileFixture.state.cash),111111111);
  assert.equal(await page.locator('.menu-permit-host .resubmitting').count(),1);
  await page.waitForTimeout(800);
  await page.screenshot({path:`${output}/permit-menu.png`});
  assert.equal(await page.getByRole('button',{name:'Re-apply In 6 Months',exact:true}).getAttribute('aria-disabled'),'true');
  await page.getByRole('button',{name:'Re-apply In 6 Months',exact:true}).dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.mobileFixture.state.cash),111111111);
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  assert.equal(await page.locator('.resubmitting').count(),0);
  for (const overlay of ['briefing','results']) {
    await page.evaluate(overlay=>{window.mobileFixture.state.overlay=overlay;window.mobileFixture.render();},overlay);
    assert.equal(await page.locator('#hud-overlay').isVisible(),true);
    assert.equal(await page.locator('.touch-stick').isVisible(),false);
  }
  assert.deepEqual(errors,[]);
  console.log('Mobile layout, menu, permit, warnings, overlays and multi-touch checks passed.');
  }
} finally { await browser.close(); }
