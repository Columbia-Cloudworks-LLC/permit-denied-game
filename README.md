# PERMIT DENIED

The County Said No.

A browser demolition arcade: you drive a bulldozer through a compact isometric town, grind buildings apart, and cash out before the county clock hits zero.

## Run

```powershell
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173).

```powershell
npm test          # destruction harness
npm run build     # typecheck + production bundle
npm run preview   # serve the production build
```

No backend, accounts, or API keys. Entirely client-side.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Forward |
| S / ↓ | Reverse |
| A / ← | Steer left |
| D / → | Steer right |
| Space | Powered blade (short cooldown) |
| R | Restart |
| Esc | Pause |
| M | Mute |
| V | Spawn a lighter test road vehicle on the east-west road |

HUD shows **BLADE UP** / **BLADE DOWN**. Deaths: **ENGINE COOKED** (heat from grinding), **TRACK THROWN** (high-speed pole/impact stress), **COUNTY CLOCK** (time).

## How it plays

Three minutes. Cash target is on the top bar. Chip walls, breach rooms, collapse floors. Full building bonuses pay more. Cash milestones pause the run for one upgrade: stronger blade, more engine, or a faster powered push.

Buildings are cell stacks with load-bearing ground supports. Damage stays on the wall you hit. Take out supports and the floors above sag, crack, and fall. A falling bay can lean into a neighbor and start a second collapse. Rubble stays on the lot and can be pushed or crushed. Press **V** to spawn a lighter test car on the east-west road (or call `window.__pd.spawnRoadVehicle()`). `window.__pd.obstructionAt(x, y)` reports live heap height and resistance.

## Stack

TypeScript + Vite + PixiJS v8. Simulation is world-space; isometric projection is render-only. Fixed 60 Hz step.
