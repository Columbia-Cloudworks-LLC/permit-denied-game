# Asset capture route

The published asset catalog (`/catalog/`, R2 publishing, and the bulk `capture:assets` gallery pipeline) has been removed. Use the debug binder's asset tab (`?debug=1`, see [debug-binder.md](debug-binder.md)) to spawn and test individual assets.

## Automation seam

The explicit `?capture=1` route exposes `window.__assetCapture`. Its catalog, `load`, `render`, `damage`, `advance`, `vehicleScenario` and `snapshot` methods let Playwright scripts load one production asset in isolation. `scripts/verify-vehicles.mjs` uses it. Normal game routes retain their usual boot path, and analytics never runs on this route.

The scene has no running application ticker, player input or audio. Damage advances by integer production simulation steps. The camera stays fixed through destruction sequences. Runtime vehicle motion uses a following camera with fixed zoom. Intact exterior views, floor cutaways, layer changes and screenshot waits do not advance the simulation. Seeds and particle state reset when loading an asset.

Floor views use the game's maximum-visible-floor control: they show that floor and lower floors, not an isolated floating floor. Mounted facade details have their own `details` visibility switch and `detail:<kind>` host contexts that keep the production host building but filter other detail kinds.
