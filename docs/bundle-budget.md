# Production JavaScript budget

The game HTML's module graph (entry script plus `modulepreload` links) is the initial payload a player downloads before demolition starts.

| Limit | Value | Why |
| --- | --- | --- |
| Initial game JS | 1,880,000 bytes uncompressed | Ordinary startup path: Pixi, authored buildings, town/sim, HUD, traffic, career stat curves. Raised from 1,850,000 when traffic joined the sim, and to 1,880,000 when the career loadout replaced the in-run blade/engine/push upgrades (net about +2 KB over 1,875,000): both run from the first fixed step, so lazy loading would desync recorded replays. The career's shop, yard, attachments, and HUD strip load lazily (below) |
| Per chunk | 650 KiB | Vite `chunkSizeWarningLimit`; Pixi and building JSON sit just under it |
| Test-yard / debug binder | lazy `import("./yardBindings")` | Not in the ordinary player graph |
| Overworld map and region data | lazy `loadOverworld()` → `src/game/overworld.ts` | Loads when setup opens or a link names a region. Never import it statically from the startup graph. Generation-time bias lives in the small `src/world/regionalPlacement.ts`. The atlas DOM and pan/zoom (`src/render/atlasView.ts`, `atlasPanZoom.ts`) live in this chunk too |
| Skunkworks attachments | lazy `import("./attachmentKit")` → `src/vehicle/attachments.ts`, `src/sim/attachmentEffects.ts` | Loads at boot only when an attachment is equipped, or when one is first bought; replays of attachment runs wait for it |
| Career HUD strip | lazy `import("../render/careerStrip")` | Presentation only; requested at boot without blocking it |
| Home Yard and Heavy Shop | lazy `import("./homeBase")` → `src/world/homeYard.ts`, `src/game/homeController.ts`, `src/render/heavyShop.ts`, `src/game/careerShop.ts` | Loads when the player rolls into the yard |
| Third-party licence notices | lazy `import("./thirdPartyNotices.txt?raw")` in `src/render/operatorMenu.ts` | About 16 kB of text behind the About page's collapsed disclosure. It loads when that page opens; the service worker precaches the chunk with the other `assets/*.js`, so it still reads offline |
| Road atlas geometry | `public/atlas/north-america-atlas.json`, fetched by `loadAtlas()` | Static JSON, not JavaScript, so it never counts toward either JS limit. About 245 KB, precached by the service worker; `src/world/atlas.test.ts` caps it at 400 KB |

`npm run build` runs `scripts/analyze-bundle.mjs`, which fails CI when those limits are exceeded. `vite.config.ts` splits `pixi`, `analytics`, and `src/world/data/` (`buildings`) through `manualChunks` so Rollup no longer emits an oversized-chunk warning.

## Analysis

```powershell
npm run build
npm run analyze:bundle
```

The analyzer prints each initial chunk and its uncompressed size. Designer, privacy, and terms remain separate Vite entries and are not counted in the game initial budget.

Mobile startup on a production build: `npm run preview`, then `MOBILE_TEST_URL=http://127.0.0.1:4173 npm run test:mobile`. The script skips the Vite-source HUD fixture when `/src/render/hud.ts` is not served as a module.

`.gitattributes` forces LF so Windows checkouts do not turn building JSON into CRLF and push `buildings-*.js` over the per-chunk budget.
