# Published asset catalog

The gallery is a separate Vite entry at `/catalog/`. The game does not import it. Images, detail manifests, and paged indexes live in Cloudflare R2; Vercel deploys only the gallery shell and a pointer to an immutable catalog release.

The page uses the same permit chrome as the title menu: stamp, **PERMIT DENIED**, “The County Said No.”, Play / Catalog / Designer nav, and the Columbia Cloudworks nameplate. It is a still gallery, not a live editor. Building JSON preview lives at `/designer/` (also a separate Vite entry the game does not import). Designer opens existing `BUILDING_FILES` packages or a new draft from porch-house / a 1-story box, parses a virtual map of the draft plus existing construction files, and previews an isolate lot. Export and copy only — drafts are never written into the town.

## Local work

`npm run build` remains a normal game/gallery-shell build. `npm run catalog:local` builds, captures the entire production catalog, verifies coverage, converts images, and prepares `/catalog/` for `npm run preview`. Install Chromium once with `npx playwright install chromium`. Full capture can take minutes; the local gallery intentionally reports unavailable until generated.

For parallel local capture, build once, then run:

```sh
node scripts/catalog.mjs plan --output=artifacts/catalog-plans
node scripts/catalog.mjs capture-plan --worker=0
node scripts/catalog.mjs capture-plan --worker=1
node scripts/catalog.mjs capture-plan --worker=2
node scripts/catalog.mjs capture-plan --worker=3
node scripts/catalog.mjs generate --local-preview
```

Run the four workers concurrently. They use distinct local ports. Do not change the served build during capture. Keep each run in a fresh capture/output directory; the publishing graph ignores unrelated files but coverage rejects leftover duplicate variants. `--captures=...`, `--output=...`, `--plans=...`, and `--build=...` select isolated directories.

`--cache` on the planner and capture workers enables private R2 evidence reuse. Use `node --env-file=.env.local scripts/catalog.mjs ...` for local credentials; never add `.env.local` to Git or paste credentials in chat. CI passes secrets directly to only the steps that need them.

## Data and playback

The public release contains version, commit, counts, category browse/search tree roots, and an ID lookup tree. Every tree node contains at most 24 records or child references. Search matches normalized prefixes of names, IDs, and word suffixes (for example `tower`, `office tower`, or `building warehouse`). It is not fuzzy search or arbitrary unordered-word matching. Search reads at most 32 index nodes per page; exceptionally sparse sections can offer Next with fewer than 24 results. The browser retains at most 128 metadata files.

Each asset has a detail file grouping variants and ordered series. Only the active frame and its immediate neighbors load. Model/layers/floors, standard destruction, cutaway destruction, effects-hidden destruction, and vehicle motion remain separate series. The final cleared image is labeled as additional full-damage cleanup. URLs encode the asset, variant, series, and frame. Keyboard controls operate inside the dialog; touch gestures preserve vertical scrolling.

Image keys hash converted bytes. Full views use lossless WebP, thumbnails use 360px WebP, and duplicates share keys. Building and site cards use the intact model; `fixture:*` cards use the ground-floor cutaway so the named fixture is visible. Generation rejects a fixture thumbnail sourced from an opaque intact exterior. The public payload excludes snapshots, simulation structures, and private cache records. Objects and release manifests are immutable. The deployment pointer is revalidated; rollback restores the earlier pointer and shell without rewriting R2 data.

## Incremental capture and CI

The Linux build emits `build.json` with the source commit and game version and uploads one `game-build` artifact. The reusable catalog workflow consumes it; Windows still validates independently. Trusted internal builds use private cache credentials. Fork builds receive neither R2 nor Vercel credentials.

The planner creates four worker plans and packs work into batches of at most 12 assets, using recorded capture durations when available. Individual assets are never truncated to meet a batch estimate. Workers restart the browser per batch. CI has a 180-minute worker timeout; successful asset captures are checkpointed, so reruns reuse completed work rather than imposing an asset-count cap. Runtime limits and costs still exist.

Fingerprints include all executable game source conservatively (excluding tests and the independent gallery), resolved asset/site/host definitions, the lockfile, browser version, Node version, OS/architecture, seed, capture recipe, verifier, and conversion settings. JSON building edits invalidate the relevant asset/host/site; shared code or dependency changes invalidate broadly. Windows and Linux capture caches intentionally differ.

Private cache records commit only after their evidence uploads finish. Restores check required views, variant identity, restoration status, and every original PNG checksum. Missing or corrupt evidence becomes a capture miss. Full cross-batch coverage is verified again before conversion/publication.

The publisher verifies the entire immutable reference graph locally, uploads missing objects with bounded concurrency/retries, verifies uploaded metadata, and commits the release manifest last. It then writes the exact release reference into `dist/catalog/release.json`. There is no public mutable `latest` pointer. Vercel deployment refuses a gallery shell without that pointer. New objects from an interrupted publication are harmless and reusable.

The GitHub job summary reports asset count, cache reuse, new objects, and uploaded bytes. Capture records retain measured duration. Public historical objects are not deleted automatically; private evidence also remains until an explicit retention policy is introduced.

## Validation

Run `node --test scripts/*.test.mjs`, `npm test`, `npm run build`, and `node scripts/verify-catalog.mjs`. The browser verifier uses explicit synthetic HTTP fixtures, not production capture evidence. It exercises desktop/mobile controls, deep links, pagination, filtering, focus, viewport layout, and network isolation. Script tests cover 100,000 records, fingerprints, cache corruption, interrupted uploads, provenance, deduplication, and rollback references.

`scripts/verify-production.mjs` checks game metadata and the pinned public catalog, including its version/commit, a thumbnail, frame endpoints, WebP MIME, immutable caching, and CORS. Set `DEPLOY_SHA` to the expected deployment commit. Preview verification can use `scripts/verify-catalog-production.mjs` with `CATALOG_VERIFY_ORIGIN` when preview access permits it.

See [Cloudflare setup](asset-catalog-cloudflare.md) for the remaining account and DNS requirements.
