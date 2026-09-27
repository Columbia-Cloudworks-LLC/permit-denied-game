import assert from 'node:assert/strict';

/** Check actual scroll reachability and hit targets, including native form controls. */
export async function assertDebugControlsReachable(page, selector) {
  const controls = page.locator(selector).locator('button, input, select, summary');
  let count = 0;
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i);
    if (!await control.isVisible()) continue;
    await control.scrollIntoViewIfNeeded();
    const state = await control.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { name: el.getAttribute('aria-label') || el.textContent || el.outerHTML,
        rect: r.toJSON(), hit: hit === el || el.contains(hit), width: innerWidth, height: innerHeight };
    });
    assert.ok(state.rect.x >= 0 && state.rect.right <= state.width + 1 && state.rect.y >= 0 && state.rect.bottom <= state.height + 1, JSON.stringify(state));
    assert.ok(state.hit, `Control is covered: ${JSON.stringify(state)}`);
    count++;
  }
  assert.ok(count > 0, 'Expected reachable debug controls');
  return count;
}
