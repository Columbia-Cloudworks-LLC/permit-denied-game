# Production JavaScript budget

The game HTML's module graph (entry script plus `modulepreload` links) is the initial payload a player downloads before demolition starts.

| Limit | Value | Why |
| --- | --- | --- |
| Initial game JS | 1,850,000 bytes uncompressed | Ordinary startup path: Pixi, authored buildings, town/sim, HUD |
| Per chunk | 650 KiB | Vite `chunkSizeWarningLimit`; Pixi and building JSON sit just under it |
| Test-yard / debug binder | lazy `import("./yardBindings")` | Not in the ordinary player graph |

`npm run build` runs `scripts/analyze-bundle.mjs`, which fails CI when those limits are exceeded. `vite.config.ts` splits `pixi`, `analytics`, and `src/world/data/` (`buildings`) through `manualChunks` so Rollup no longer emits an oversized-chunk warning.

## Analysis

```powershell
npm run build
npm run analyze:bundle
```

The analyzer prints each initial chunk and its uncompressed size. Catalog, designer, privacy, and terms remain separate Vite entries and are not counted in the game initial budget.

Mobile startup on a production build: `npm run preview`, then `MOBILE_TEST_URL=http://127.0.0.1:4173 npm run test:mobile`. The script skips the Vite-source HUD fixture when `/src/render/hud.ts` is not served as a module.
