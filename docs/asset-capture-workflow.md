# Automated asset visual catalog

The capture workflow discovers the actual game catalog, loads each asset in isolation, and writes an HTML gallery, PNG views and a JSON state manifest. It uses the production Pixi renderer, constructors, prop damage, fixture damage and structural simulation. It does not synthesize substitute artwork.

## Run locally

```sh
npm run build
npx playwright install chromium
npm run capture:assets
```

The script starts and stops its own local Vite preview server. The default output is a new timestamped directory under `artifacts/asset-captures/`. Open its `index.html` in a browser. PNGs and generated manifests are ignored by Git.

To focus on one asset, inspect a whole category, or select a dedicated output directory:

```sh
npm run capture:assets -- --filter=building:roadside-diner --output=artifacts/diner-review
npm run capture:assets -- --filter=fixture: --output=artifacts/fixture-review
npm run capture:assets -- --filter=site: --output=artifacts/site-review
```

`--url=http://127.0.0.1:4173` uses an already-running build instead of starting a preview. `--port=4176` changes the managed preview port. An explicitly reused output directory can contain stale files; manifests identify the files from the current run. Prefer a fresh directory for release evidence.

`--preview-dir=artifacts/review-build` serves a separately built output directory. Build it first with `vite build --outDir artifacts/review-build` and wait for that build to finish. Keep a served build unchanged for the lifetime of a capture run; use a second build directory to verify fixes while an older run completes.

## What is captured

Every building, prop, declared prop variant, building site and interior fixture context discovered by `discoverYardAssets` is included. A fixture context contains an example on both ground and upper floors, so support loss is visible.

```text
index.html
manifest.json
building/roadside-diner/variant-0/
  index.html
  manifest.json
  model.png
  layers/
    cutaway.png
    structure.png
    collision.png
    rooms.png
    without-roofs.png
    only-roofs.png
    ...every visible layer isolated and disabled...
  floors/
    00-cutaway.png
    00-structure.png
    ...every declared floor...
  destruction/
    00-intact.png
    01-damaged.png
    02-breached.png
    03-support-loss.png
    frame-0006.png
    frame-0006-cutaway.png
    frame-0006-no-effects.png
    ...through frame 0900...
    99-cleared-structure.png
```

Floor captures use the game's maximum-visible-floor control: they show that floor and lower floors, not an isolated floating floor. Building surfaces and attachments are contextual building layers, not independently cataloged asset types. The moving road vehicle and both bulldozer blade positions have dedicated production contexts under `vehicle/`. Their `motion/` folders contain frames 15, 30, 60, 120 and 180; their `destruction/README.md` explains that these models have no production damage mechanic. The parked destructible car retains a destruction sequence.

`--exhaustive` adds every on/off combination of the visible layer switches. With the current twelve switches, that means 4,096 extra images per variant. Default CI uses the smaller diagnostic set. Neither set represents every possible camera, damage trajectory or time instant; the capture API makes additional targeted recipes possible without manual driving.

Mounted facade details have their own `details` visibility switch and discovered `detail:<kind>` host contexts. These retain the production host building but filter other detail kinds, then damage the mounting cells explicitly. All ten current kinds are covered, including display glazing, roof ducts and dormers. Roof details use their covering panel's bearing cells; glazing receives pane damage before structural damage. The runner checks that hiding details changes the intact image and that no detail remains after full damage.

## Repeatability and damage

The explicit `?capture=1` route exposes `window.__assetCapture`. Its catalog, `load`, `render`, `damage`, `advance` and `snapshot` methods are the automation seam. Normal game routes retain their usual boot path.

The scene has no running application ticker, player input or audio. Damage advances by integer production simulation steps. The camera stays fixed through destruction sequences. Runtime vehicle motion uses a following camera with fixed zoom; recorded camera and vehicle state identify movement. Intact exterior views, floor cutaways, layer changes and screenshot waits do not advance the simulation. Seeds and particle state reset when loading an asset.

The sequence applies partial damage, frontage breach, ground support failure, then records 6/15/30/60/90/120/180/240/360/600/900 fixed steps. Props and fixtures use their own production damage paths. The final full-damage pass is separately labeled: it proves that the remaining asset can be removed, not that support failure alone necessarily removes every cell.

Every screenshot records its SHA-256 hash and simulation state, including damage states, broken furnishings, pile mass, debug settings and camera. The runner checks that destruction changes the visible image, full damage removes the applicable live structures/props/fixtures, and rebuilding reproduces the original intact screenshot byte-for-byte in that same browser run. Cross-platform pixel identity is not assumed. Visual correctness still requires reviewing the generated images; these checks detect missing work and state failures, not artistic quality.

## CI and coverage

`.github/workflows/asset-captures.yml` runs on PRs to `main`, pushes to `main`, and manual dispatch. Four independent jobs build the game and capture disjoint catalog subsets. Each uploads its gallery even if capture fails. A final job verifies full variant coverage and every PNG hash, then publishes the combined **asset-catalog-complete** artifact. Artifacts are retained for 14 days; screenshots are not committed.

The same sharding and verification can run locally (use separate ports for concurrent processes):

```sh
npm run capture:assets -- --shard=1/4 --port=4181 --output=artifacts/catalog/shard-1
npm run capture:assets -- --shard=2/4 --port=4182 --output=artifacts/catalog/shard-2
npm run capture:assets -- --shard=3/4 --port=4183 --output=artifacts/catalog/shard-3
npm run capture:assets -- --shard=4/4 --port=4184 --output=artifacts/catalog/shard-4
node scripts/verify-asset-captures.mjs artifacts/catalog
```

The verifier rejects missing variants, duplicate variants or screenshot paths, inconsistent shard catalogs, filtered runs, capture errors, missing restoration verification and changed image bytes. It requires every standard layer view, declared floor view, damage stage and intermediate destruction view. Vehicle exemptions require all five motion frames; exhaustive runs require all 4,096 combinations. Its combined `index.html` links every model and detailed gallery. A new catalog asset is automatically part of the next capture run; no screenshot placement list needs updating.

CI configuration has been authored locally. A hosted Actions run requires publishing these changes; no commit or push has been performed.
