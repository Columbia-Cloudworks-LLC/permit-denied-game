# PERMIT DENIED

Browser demolition arcade. Title `PERMIT DENIED`, tagline “The County Said No.” You drive a bulldozer through compact isometric towns from one town generator, grind buildings apart, and cash out before the county clock runs out. A North American overworld (50 US states, 13 Canadian provinces and territories, seven counties each) picks which town: every county is a seeded variant of one of the seven campaign levels. Time Challenge clears counties against the clock; Sandbox plays the same counties without it. Production: https://permitdenied.app.

`README.md` is the source of truth for running, controls, current scope, and hosting.

## Start of task

Run `npm run repo:preflight` before any code-dependent review, diagnosis, or implementation. The `SessionStart` hook (`.claude/hooks/session-start.mjs`) runs the same check; run it again if that context is missing.

- A failed fetch means **freshness unverified**, not that the checkout matches GitHub `main`. A clean `git status` is not proof of freshness.
- If preflight cannot safely update a dirty, diverged, detached, or unique feature branch, keep that state and report it. Never stash, reset, rebase, or merge divergent history to catch up.
- Base a new branch on fetched `origin/main`. In a PR stack only the bottom layer does; see `/stacked-pr`.
- If git reports dubious ownership, pass `-c safe.directory=<resolved worktree path>` per command. Do not change git config.

## Stack lock

TypeScript + Vite + PixiJS v8, entirely client-side. Simulation runs in world coordinates on a fixed 60 Hz step; isometric projection is render-only. No React on the game canvas, no backend, accounts, or API keys.

Stay on the lot: one town generator. In scope: the seven campaign levels; the overworld that maps 63 regions × 7 counties onto those levels as seeded variants with regional building bias (`docs/campaign.md#overworld-and-counties`); the Home Yard, the one hand-built lot, where the dozer shops, tests, and dispatches between runs; and per-browser persistence of two records: county clears (the capitol unlocks after Counties 1–6) and the career profile (`permit_denied_profile_v1`: banked wallet, four core tracks, Skunkworks attachments, liveries, range tiers) fed by run escrow settlement (`docs/campaign.md#career-home-yard-and-the-heavy-shop`). Out of scope: a second town generator or other hand-built maps, any progression beyond the career profile (XP, perks, unlock trees), backend, accounts, or cloud saves, JSON schema or plugin systems, ECS, React wrappers around the canvas.

Buildings are per-cell destructible with a support/collapse model. Visual debris is garnish; rubble collides and matches the wreck. Collapse is inexpensive controlled animation, not a general physics engine (a Three.js + Rapier prototype was tried and discarded as unscalable to city-wide demolition).

Copy: `BLADE UP` / `BLADE DOWN`; deaths `ENGINE COOKED` / `TRACK THROWN` / `COUNTY CLOCK`. Never write Heemeyer, Granby, manifesto, or wanted stars.

## Code map

- `src/main.ts` – game entry. `src/game/` – `Game`, fixed step, input, camera, HUD bindings, campaign runs.
- `src/sim/` – world simulation: impacts, debris, pile field, cleanup, dozer cues, benchmarks.
- `src/structure/` – buildings, construction, cells, support and collapse, roofs, materials. `rooftop.ts` (generated roof equipment, salvage, dead-load drop), `regionalExterior.ts` (regional roof forms and the per-building regional dress), `facadeTrim.ts` (procedural trim and street/service faces).
- `src/world/` – town generation: terrain, roads, parcels, biomes, archetypes, campaign layout. `climate.ts` (climate zones, hazards, soils; startup-safe), `groundCondition.ts`, `season.ts`, `landforms.ts` (mesas, boulders, desert flora, arid land use), `serviceYards.ts` + `serviceYardAssets.ts` (occupancy service props). Building definitions are JSON packages under `src/world/data/`. Overworld data: `regions.ts` (63-region manifest), `counties.ts`, `regionalCatalog.ts` (flavor bias, brand skins, landmark overrides), `regionalBrands.ts` (brand stamping), `landmarkPack.ts` + `landmarkData/` (regional landmark packages, lazy, never under `data/`); `regionClimate.ts` (county geography to climate zone, lazy overworld chunk only); `regionalPlacement.ts` is the startup-bundle slice generation uses.
- `src/game/overworld.ts` – lazy overworld chunk, loaded via `overworldLoader.ts`; never import it statically from the startup graph. `countyProgress.ts` – the per-browser county clears.
- `src/game/weatherRisk.ts` – Time Challenge weather stakes and Hazard Pay.
- `src/game/career.ts` – career profile, prices, stat curves, escrow settlement. `src/vehicle/attachments.ts` + `src/sim/attachmentEffects.ts` – Skunkworks state machines and world effects. `src/game/homeBase.ts` – lazy Home Yard chunk (`src/world/homeYard.ts` generator, `src/render/heavyShop.ts` overlay); never import it statically.
- `src/render/` – Pixi rendering, isometric drawing, building surfaces, lighting, LOD. Roofs: `roofFinish.ts` (flat-roof membranes, parapets), `rooftopDraw.ts` (equipment); `wallPaint.ts` regional walls, `facadeTrimDraw.ts`, `landformDraw.ts`, `weatherBadge.ts`. Never mutates simulation state.
- `src/vehicle/` – dozer and road vehicles. `src/fx/` – particles, camera shake, season weather. `src/audio/` – synth.
- `src/debug/` – debug binder, `window.__pd` bridge, perf overlay, asset capture.
- Separate Vite entries not imported by the game: `src/designer/` (`/designer/`), `src/privacy/`, `src/site/`. `src/pwa/` – service worker registration and update prompts.
- `scripts/` – operational Node scripts (deploy, captures, preflight) with `*.test.mjs` tests.

Deeper docs in `docs/`: `architecture.md` (structure, roofs, debris layers), `testing.md`, `campaign.md`, `city-map-fabric.md`, `construction-authoring.md`, `vehicle-system.md`, `traffic.md`, `bundle-budget.md`, and the `*-authoring.md` guides.

## Commands

```sh
npm run dev               # Vite dev server, http://localhost:5173
npm test                  # unit tests: the local presubmit
npm run check             # tsc for src and scripts
npm run build             # typecheck + production bundle + JS budget
npm run test:integration  # d30/d100 and campaign generation matrices (Linux CI)
node --test scripts/*.test.mjs  # operational script tests
```

Linux CI runs unit, integration, soak, script tests, build, PWA, and privacy. Windows CI (required check `windows`) runs unit, script tests, build, and PWA. `npm run test:bench` is measurement only. Match checks to the diff: `npm test` for behavior, `npm run check` when types change, `npm run build` when packaging or entries change, and play a run when the change is visible.

## Working rules

- Make reasonable implementation decisions and deliver a playable slice; do not stop at a plan.
- Do not commit unless asked. Never commit `dist/`, `*.exe`, `.env*`, `.vercel/`, or other secrets/artifacts; CI builds packages. The `PreToolUse` hook denies staging `dist/` or `*.exe` and asks before force-pushes.
- When asked to put changes on GitHub: include all remaining intentional work (minus secrets, binaries, artifacts), branch, push, open a PR with `.github/PULL_REQUEST_TEMPLATE.md`, babysit CI with `gh pr checks` until merge-ready, merge, then check out `main` and fast-forward to `origin/main`.
- `main` is ruleset-protected: no direct pushes.
- `/release` (`.claude/skills/release/SKILL.md`) ships one pull request and is the only version bump: `package.json` / `package-lock.json` to the next `1.0.N`, PR title `Release 1.0.N: <short what shipped>`. Docs or tooling PRs outside `/release` do not bump.
- A PR stack is several branches and several PRs, each based on the one below (`/stacked-pr`). Several commits on one branch, or one PR fixing many issues, is not a stack. Never call `/release` a stacked PR.

## Infrastructure

- GitHub: `Columbia-Cloudworks-LLC/permit-denied-game`, default branch `main`. Use the `gh` CLI. `github.permitdenied.app` 308s to the repository.
- Hosting: Vercel project `permit-denied` (Columbia Cloudworks LLC). GitHub Actions deploys prebuilt output after Linux/Windows checks: `main` to production, internal PRs to previews. Vercel Git builds are disabled in `vercel.json`. `.vercel/` stays gitignored.
- Repository variables: `FACEBOOK_APP_ID`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; secret `VERCEL_TOKEN`. Never pass `FACEBOOK_APP_SECRET` to a browser build.
- DNS: IONOS is registrar only; nameservers are Cloudflare.
