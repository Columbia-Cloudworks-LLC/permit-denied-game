import assert from 'node:assert/strict';

/** Check actual scroll reachability and hit targets, including native form controls. */
export async function assertDebugControlsReachable(page, selector) {
  const controls = page.locator(selector).locator('button, input, select, summary');
  let count = 0;
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i);
    if (!await control.isVisible()) continue;
    assertReachable(await controlState(control));
    count++;
  }
  assert.ok(count > 0, 'Expected reachable debug controls');
  return count;
}

/** Scroll the control into view, then report its box and whether a click at its center reaches it. */
function controlState(control) {
  return control.evaluate(el => {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { name: el.getAttribute('aria-label') || el.textContent || el.outerHTML,
      rect: r.toJSON(), hit: hit === el || el.contains(hit), covering: hit?.outerHTML.slice(0, 200), width: innerWidth, height: innerHeight };
  });
}

/** Fully inside the viewport and not covered by another element. */
function assertReachable(state) {
  const { rect, width, height } = state;
  assert.ok(rect.x >= 0 && rect.right <= width + 1 && rect.y >= 0 && rect.bottom <= height + 1, JSON.stringify(state));
  assert.ok(state.hit, `Control is covered: ${JSON.stringify(state)}`);
}

/**
 * Map reachability in a live town: every place a rock formation or fixed boulder touches a lot or
 * its one-unit setback, read from the debug bridge. Empty when no landform crowds a job site.
 */
export function landformBlockage(page) {
  return page.evaluate(() => {
    const town = window.__pd.townSnapshot();
    const solids = [
      ...town.features.filter((f) => f.kind === "mesa").map((f) => ({ name: "mesa", x: f.x, y: f.y, w: f.w, d: f.d })),
      ...town.props.filter((p) => !p.broken && p.assetId.endsWith("-boulder")).map((p) => ({ name: p.assetId, x: p.x, y: p.y, w: p.w, d: p.d })),
    ];
    const setback = 1;
    const out = [];
    for (const solid of solids) {
      for (const lot of town.lots) {
        const clear = solid.x >= lot.x + lot.w + setback || lot.x >= solid.x + solid.w + setback || solid.y >= lot.y + lot.d + setback || lot.y >= solid.y + solid.d + setback;
        if (!clear) out.push(`${solid.name} at ${solid.x.toFixed(1)},${solid.y.toFixed(1)} crowds lot ${lot.id}`);
      }
    }
    return out;
  });
}
