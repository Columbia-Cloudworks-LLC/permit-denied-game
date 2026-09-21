# Debug binder and focused asset tests

Open **Debug** from the desktop HUD or the mobile status bar. The paper binder has **Assets**, **Inspector**, and **Session** pages. It stays beside live gameplay; **Freeze Simulation** is an explicit choice. On short landscape screens the binder scrolls as one surface, with its heading pinned. Collapse it to expose more of the play area.

## Testing an asset

1. Search or filter the catalog on Assets and choose a variant.
2. Choose **Test This Asset** to load one catalog entry on a plain test pad. Buildings retain authored contents; site entries retain their composition. An interior fixture gets one instance in an open-front support structure.
3. Drive the dozer into the subject, or use its contextual destruction controls. Vehicles can run, park, and be followed by the camera. Routes stay anchored to their bay when restarted.
4. **Reset Test** (or R while the canvas has keyboard focus) restores the subject, dozer, and run state. It retains the seed, variant, upgrades, debug options, selected page, filters, section expansion, and scroll position.

**Restore Selected Asset** restores only the selected owned objects and leaves the dozer in place. **All Assets Sandbox** is always in the binder header. It loads every registered catalog entry; its batch placement and cleanup tools are under Assets. **Reset Entire Yard** resets that entire map. Local restoration leaves neighboring experiments intact and removes owned debris even after it has traveled outside its bay.

Session retains normal game setup and the Brick Demolition Challenge. Ordinary game restart still clears gameplay upgrades and progress. All binder state is in memory; a browser reload starts with fresh UI defaults. Opening Debug from the pause menu resumes live play, subject to the Freeze setting. Typing and keyboard tab navigation inside the binder never drive or restart the game.

## Implementation and links

- `DebugBinderState` belongs to the HUD, independently of `Town`. The picker stores stable catalog IDs and instance keys and resolves replacement objects after a reset. It never retains discarded simulation objects.
- `TestMapRequest` explicitly selects `{ kind: 'yard' }` or `{ kind: 'asset', assetId, variant }` in `SessionRules` and `TownOptions`. Test maps start from an empty town and use the production constructors. The legacy `TownOptions.yard` and tower fixtures remain available to regression tests.
- The full yard uses `?yard=1`. Focused links use `?testAsset=vehicle%3Abus&variant=1`; both accept `seed`. Invalid IDs or variants produce an empty pad and an actionable catalog error.
- Capture and verification scripts talk to `window.__pd` as a versioned debug bridge (`version: 1`), not the live `Game` instance. Ordinary production boots do not install it; local `npm run dev` and `?debug=1` / yard / test-map links do.
- `ranch=1`, `demo=ranch`, `demo=rivertown`, `demo=steel-warehouse`, and `tower=1` open the corresponding generic building test. `job=brick` retains the objective-based challenge. In-app map changes update the link without reloading the UI.
- Focused vehicles start parked, with a clear dozer approach and room for their complete attachment and route envelopes. The old road-car spawn hotkey is excluded from test maps; the vehicle controls own those experiments.

## Verification — 2026-09-13

- Catalog-wide construction: all **204 entries and every declared variant**, including single-instance fixture supports and composite sites. All 12 vehicle route envelopes remain within their focused maps.
- Release 1.0.14 validation: the full Vitest suite passed **547 tests across 64 files**, including the 20-minute simulated sandbox benchmark (157.4 seconds wall time). All **30 script tests** passed, including capture coverage and deployment packaging.
- TypeScript check and Vite production build passed. Vite retains its large-chunk advisory.
- Ten browser damage/reset cycles verified upgrades, filters, variant, page scroll, dozer spawn, clean damage state, and camera rebinding. Keyboard R, Escape, tab navigation, text-input isolation, freeze/step, old-session exit, invalid-link recovery, and the Brick challenge were exercised.
- Inspected intact and production-damaged captures of the bus, combine, articulated tractor, Union Tower, farmstead site, supported sofa, and barricade.
- Desktop and mobile binder checks passed at 1440×1000, 390×844, 844×390, 360×640, and 640×360. The existing mobile HUD suite passed all eight viewport layouts and multi-touch checks. Vehicle controls and Run All 12 passed desktop/portrait/landscape checks. Catalog unit checks (10) and built catalog desktop/mobile browser checks passed.
- Browser evidence uses Chromium on Windows (Intel Core i7-8700K, 64 GB RAM). Mobile checks are browser emulation, not physical-device performance measurements.

Reproduce with local Node commands:

```powershell
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/verify-debug-binder.mjs
$env:MOBILE_TEST_URL='http://127.0.0.1:5178'
node scripts/verify-mobile.mjs artifacts/debug-binder/mobile-hud
node scripts/verify-vehicles.mjs --controls-only
node --test scripts/catalog.test.mjs
node scripts/verify-catalog.mjs
```

The binder script defaults to the local server on port 5178; set `DEBUG_TEST_URL` for another origin. Generated screenshots and `browser-report.json` are under `artifacts/debug-binder/` and remain untracked. Generated evidence stays out of Git; releases follow the protected main-branch CI workflow.
