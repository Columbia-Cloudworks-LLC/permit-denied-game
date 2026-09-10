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
http://localhost:5173/?perf=1
```

```powershell
npm test          # destruction harness
npm run build     # typecheck + production bundle
npm run preview   # serve the production build
```

## Play

https://permitdenied.app (also https://www.permitdenied.app)

Vercel hosts the Vite static build. The GitHub repo `Columbia-Cloudworks-LLC/permit-denied-game` is linked to the `permit-denied` project on the Columbia Cloudworks LLC team. Merges to `main` deploy production. Pull requests get preview URLs.

IONOS is only the registrar. Nameservers are Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`). No backend, accounts, or API keys. Entirely client-side.

## Controls

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
| ` | Toggle technical timing overlay |

HUD shows **BLADE UP** / **BLADE DOWN**. Deaths: **ENGINE COOKED** (heat from grinding), **TRACK THROWN** (high-speed pole/impact stress), **COUNTY CLOCK** (time).

## How it plays

Clock mode is three minutes. Cash target is on the top bar. Chip walls, breach rooms, collapse floors. Full building bonuses pay more. Cash milestones pause the clock run for one upgrade: stronger blade, more engine, or a faster powered push.

Sandbox mode has no county clock and does not end from heat or thrown tracks. Restart (R) rebuilds the same layout and seed. New Lot / N rolls a new seed. HUD buttons pick Clock or Sandbox and district size (classic 7, 10, 30, or 100 buildings). Optional BLADE+ / ENGINE+ / PUSH+ never force a pause in sandbox. Technical timings stay off the normal HUD; add `?perf=1` or press ` to inspect frame, sim, and debris budgets.

Same seed plus the same inputs reproduce a run within ordinary floating-point drift (tests allow about 5–8% mass tolerance through crush/aggregation).

Buildings are cell stacks with load-bearing ground supports and explicit sloped roofs. Damage stays on the wall you hit. Take out supports and the floors above sag, crack, and fall; roof sections sag and drop with the bays that hold them. A falling bay can lean into a neighbor and start a second collapse. Live rubble stays on the lot and can be pushed or crushed. Compacted mass stays in the pile field. A demolished building also leaves a permanent collapsed site on its footprint. Press **V** to spawn a lighter test car that follows a generated road route (or call `window.__pd.spawnRoadVehicle()`). `window.__pd.obstructionAt(x, y)` reports live heap height and resistance.

District lots pick from a small set of archetypes (ranch, cottage, colonial, walk-up, porch house, storefront, corner shop, civic, warehouse) and sit on a road-first rural network (county road, crossroads, T-junction, curve, loop, or frontage). Same district and seed always rebuilds the same roads, driveways, lot dressing, ground covers, silhouettes, roofs, and facades. Yards and worksites get catalog props (mailboxes, hay, pumps, trees, and the rest) that break according to a shared destruction profile. See `docs/architecture.md` for the asset catalog, road graph, roofs, debris layers, and cleanup.

## Stack

TypeScript + Vite + PixiJS v8. Simulation is world-space; isometric projection is render-only. Fixed 60 Hz step.
