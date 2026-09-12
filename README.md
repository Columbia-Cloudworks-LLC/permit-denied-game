# PERMIT DENIED

The County Said No.

A browser demolition arcade: you drive a bulldozer through a compact isometric town, grind buildings apart, and cash out before the county clock hits zero. Sandbox mode keeps the same lot open with larger optional districts.

## Run

```powershell
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173).

Sandbox and district presets can be opened directly:

```
http://localhost:5173/?sandbox=1&district=d100
http://localhost:5173/?sandbox=1&ranch=1
http://localhost:5173/?perf=1
http://localhost:5173/?sandbox=1&district=d30&nhood=1
```

Ranch benchmark: `?sandbox=1&ranch=1` loads d10 seed `17634759` with the dozer on the ranch south lawn, facing the house. **R** rebuilds the same lot. Drive **W** into the south wall; **Space** for a powered blade. Chip the middle three south cells, then ease off and watch those roof bays sag, hinge, fall, and settle into pushable panels. Leave and drive back — the wreck and rubble stay. A long hold on **W** punches through the whole house.

```powershell
npm test          # destruction harness
npm run build     # typecheck + production bundle
npm run preview   # serve the production build
```

Mobile UI verification: with the Vite dev server running and Playwright Chromium installed (`npx playwright install chromium`), run `npm run test:mobile`. Set `MOBILE_TEST_URL` if using another port. The check covers phone/tablet geometry, multi-touch resets, menus, warnings and permit resubmission; screenshots go to the ignored `docs/visual-verification/mobile-ui/` directory.

## Play

https://permitdenied.app (also https://www.permitdenied.app)

Vercel hosts the Vite static build. GitHub Actions owns deployment to the linked `permit-denied` project on the Columbia Cloudworks LLC team. After Linux and Windows CI pass, internal pull requests get preview deployments and `main` gets production deployments. Deployment links appear in GitHub deployments and the CI job summary. `vercel.json` disables Vercel's automatic Git builds to avoid duplicate deployments. Fork PRs run checks without deployment credentials.

GitHub Actions repository variables are the source of truth for `FACEBOOK_APP_ID`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. `VERCEL_TOKEN` is a repository secret used only by deployment steps. `FACEBOOK_APP_SECRET` remains stored for future server-side integration and is never passed to the build or browser. There is no duplicate App ID setting to maintain in Vercel or source code. The Vite HTML transform injects the public `fb:app_id` from the workflow environment; deployment builds fail if it is missing or malformed. Local builds omit the tag unless `FACEBOOK_APP_ID` is provided.

The pinned Vercel CLI pulls project settings, builds with the repository's configuration, checks the generated metadata, and deploys the prebuilt output. Older commits skip deployment when the branch has advanced. To redeploy after a variable or token update, dispatch the CI workflow on `main` (production) or the relevant internal branch (preview). Changing GitHub configuration alone does not change an already deployed page. The workflow verifies the production metadata after deployment. Test the build helper with `node --test scripts/facebook-metadata.test.mjs`.

IONOS is only the registrar. Nameservers are Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`). No backend, accounts, or API keys. Entirely client-side.

## Automated title screenshot

Internal pull requests automatically capture `public/social/permit-denied-title.jpg` from the production build. The Title Screenshot workflow uses a pinned Playwright Chromium version on Ubuntu 22.04, a fresh browser session, reduced motion, and the existing 1199 × 630 social-image dimensions. It waits for the title, assets, fonts, and consecutive identical frames before saving. The image is also available as a workflow artifact.

When the image changes, CI commits only that file to the PR branch, then explicitly dispatches the normal Linux/Windows CI workflow on the updated branch. Bot commits are excluded from capture to prevent loops; pushes never overwrite newer branch changes. No extra token or direct push to `main` is needed. During the initial installation PR, capture runs but automatic commits wait until CI's dispatch support has reached `main`. Fork PRs do not receive write access or automatic image updates. Release reviewers should wait for Title Screenshot and the checks on the final commit before merging.

For a local preview, run `npx playwright install chromium`, `npm run build`, and `npm run screenshot:title`. The capture script starts and stops its own preview server on port 4173. CI is the canonical renderer; operating-system font differences can change local image pixels. The generated social image is an intentional tracked asset; `dist/` and temporary captures remain untracked. Social networks may cache the image after deployment.

## Controls

On touch devices the world fills the screen, with floating corner controls and compact cash, time, heat and track readouts. Pause opens equipment/objective details, permit resubmission and Debug.

Touch controls appear automatically on coarse-pointer devices; use `?controls=1` to preview them on desktop. The left stick drives forward/reverse and steers relative to the dozer, with a 15% dead zone and proportional speed. Hold the right POWER BLADE button to power the blade while driving. Releasing the stick coasts; releasing the blade lets an already-started powered push finish.

The operator console includes engine-heat and track-stress gauges, installed Blade / Engine / Push multipliers, a hydraulic blade indicator, and touch controls at the lower corners. The top bar shows rolling cash wheels and an amber digital clock. Pause (or Escape) opens the game menu with Resume, Restart Site, New Game, Controls, Sound, About, and Main Menu. New Game selects Timed Challenge or Sandbox, site size, and a standard or randomized layout. Debug is available only on the gameplay HUD. Its Inspector, Test Scenarios, and Assets tabs contain scene diagnostics, development scenarios, Sandbox upgrades, and the test yard. Freeze Simulation and Step One Frame remain above the tabs. Opening Debug releases held input without pausing the simulation; Escape closes it first. Menus, results, and earned upgrades dismiss Debug. Rotation, backgrounding, menus, and gameplay overlays release held controls.

| Key | Action |
| --- | --- |
| W / ↑ | Forward |
| S / ↓ | Reverse |
| A / ← | Steer left |
| D / → | Steer right |
| Space | Powered blade (short cooldown) |
| R | Restart the same layout and seed |
| N | New seed (new lot, same district size) |
| 1 / 2 / 3 | Optional blade / engine / push upgrade (no pause in sandbox) |
| Esc | Pause |
| M | Mute |
| V | Spawn a lighter test road vehicle on a generated route |
| G | Toggle neighborhood graph overlay (also `?nhood=1`) |
| ` | Toggle technical timing overlay |

HUD shows **BLADE UP** / **BLADE DOWN**. Deaths: **ENGINE COOKED** (heat from grinding), **TRACK THROWN** (high-speed pole/impact stress), **COUNTY CLOCK** (time).

## How it plays

Clock mode is three minutes. Cash target is on the top bar. Chip walls, breach rooms, collapse floors. The ranch house is the demolition benchmark — open `?sandbox=1&ranch=1` and see **Run** above. Full building bonuses pay more. Cash milestones pause the clock run for one upgrade: stronger blade, more engine, or a faster powered push.

Sandbox mode has no county clock and does not end from heat or thrown tracks. Restart (R) rebuilds the same layout and seed. New Lot / N rolls a new seed. Play / Change Site selects County Clock or Sandbox and district size (classic 7, 10, 30, or 100 buildings). Optional BLADE+ / ENGINE+ / PUSH+ never force a pause in sandbox. Technical timings stay off the normal HUD; add `?perf=1` or press ` to inspect frame, sim, and debris budgets.

Same seed plus the same inputs reproduce a run within ordinary floating-point drift (tests allow about 5–8% mass tolerance through crush/aggregation).

Buildings are cell stacks with load-bearing ground supports and explicit sloped roofs. Damage stays on the wall you hit. Take out supports and the floors above sag, crack, and fall; roof sections sag and drop with the bays that hold them. A falling bay can lean into a neighbor and start a second collapse. Live rubble stays on the lot and can be pushed or crushed. Compacted mass stays in the pile field. A demolished building also leaves a permanent collapsed site on its footprint. Press **V** to spawn a lighter test car that follows a generated road route (or call `window.__pd.spawnRoadVehicle()`). `window.__pd.obstructionAt(x, y)` reports live heap height and resistance.

District lots pick from a small set of archetypes (ranch, cottage, colonial, walk-up, porch house, storefront, corner shop, civic, warehouse) and sit on a road-first rural network (county road, crossroads, T-junction, curve, loop, or frontage). Same district and seed always rebuilds the same roads, driveways, lot dressing, ground covers, silhouettes, roofs, and facades. Yards and worksites get catalog props (mailboxes, hay, pumps, trees, and the rest) that break according to a shared destruction profile. See `docs/architecture.md` for the asset catalog, road graph, roofs, debris layers, and cleanup.

## Operator interface

Normal visits open the title screen without advancing the simulation. Play chooses a mode and site; explicit scenario and diagnostic query links still launch directly. Mouse, keyboard, and touch share one menu, with keyboard focus contained while it is open and restored to the game on resume. Active-play restart/new-lot shortcuts cannot replace a run while browsing menus. Switch clicks respect the sound toggle; instrument transitions respect reduced-motion preferences.

About & Credits includes the package version, publisher website, email contact, and bundled runtime software notices. Copyright © 2026 Columbia Cloudworks LLC. All rights reserved. Publisher: [Columbia Cloudworks LLC](https://columbiacloudworks.com). Contact: [nicholas.king@columbiacloudworks.com](mailto:nicholas.king@columbiacloudworks.com). The machine-inspired visual design uses no equipment manufacturer branding.

## Stack

TypeScript + Vite + PixiJS v8. Simulation is world-space; isometric projection is render-only. Fixed 60 Hz step.
