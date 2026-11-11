# Test tiers and CI

`npm test` is the local presubmit: deterministic unit tests with a 30-second case budget. Heavyweight work is split so Linux and Windows no longer duplicate multi-minute generation and soak loops.

| Command | Project | What it covers | Where it runs |
| --- | --- | --- | --- |
| `npm test` | `unit` | Fast correctness, including classic/d10 generation smoke | Linux + Windows |
| `npm run test:integration` | `integration` | d30/d100 and campaign generation matrices, renderer draw cache | Linux |
| `npm run test:soak` | `soak` | Accelerated 20-minute sandbox wreckage | Linux |
| `npm run test:bench` | `bench` | District sim timings and dense-city render samples | Manual / dispatch, not a merge gate |
| `node --test scripts/*.test.mjs` | — | Operational script tests (paths, deploy helpers, capture harness, and a regeneration of every authored building package into a temp directory) | Linux + Windows |
| `npm run check` | — | `tsc` for `src` and `checkJs` for operational scripts | Linux + Windows |
| `npm run build` | — | Typecheck, production bundle, initial-JS budget (`npm run build:dist` skips the typecheck when `check` already ran) | Linux + Windows |
| `npx fallow dead-code` / `npx fallow dupes` | — | Unused files/exports, import cycles, copy-paste clones (should report none) | Manual |
| `npm run health` | `unit` + `integration`, script tests | Function complexity and CRAP scored against real coverage (should report none) | Manual |

CI and the title-screenshot workflow run on every pull request, not only pull requests into `main`. A stack layer whose base is the previous feature branch still gets Linux and Windows checks and, for an internal PR, its own preview. Fork PRs are not deployed.

Windows keeps the required check name `windows`. It is a representative smoke: unit tests, script tests, production build, PWA verification. That still catches numerical drift on the classic/d10 lots, path separators in Node scripts, and filesystem layout of `dist/`. It does not rerun d100 campaign matrices or the soak.

Linux CI is five parallel jobs so the wall time is the slowest job, not their sum. `build` typechecks, packages, verifies the PWA, and uploads `game-build`. `test` (unit, soak, script tests) and `integration` (generation matrices) need no artifact and start at once. `privacy` (privacy verifier) and `interface` (player-facing menus and HUD) start from the artifact. Deployment waits for all of them and `windows`. A newer push to a pull request cancels that PR's running CI; pushes to `main` always finish.

`scripts/verify-release.mjs` takes comma lists so one runner shares a single preview: `RELEASE_TEST_SUITE=binder,menus,hud` runs suites in order. CI runs only `menus,hud`; run `binder`, `coverage`, `seasons`, `ice` and `performance` locally when touching the debug binder, seasons, or frame cost (season, ice and crop rules are also covered by `src/world/season.test.ts`). The per-width layout suite (`verify-open-issues.mjs`) was removed: it took 7–20 minutes per runner, mostly redrawing the frozen game on a software GPU, to check debug-binder reachability. Playwright Chromium comes from the Actions cache through `.github/actions/setup-playwright`, keyed on the installed Playwright version. Benchmarks print timing lines and are excluded from ordinary correctness jobs; run `npm run test:bench` when investigating frame or debris cost.

The previous Vitest worker-source rewrite (`scripts/vitest-rpc-timeout*.mjs`) is gone. Unit and integration files run in parallel across the runner's cores, in CI as well as locally. Soak and bench keep a single worker so their timings are not starved by sibling files. Any case that computes for most of a minute must yield with `pumpVitestRpc()`, as soak and the long campaign-generation matrices do, so birpc ACKs stay under 60s.

Expected local budgets: unit cases finish in seconds; integration can take a few minutes; soak is the long simulation; bench is measurement-only.

`npm run health` collects V8 coverage (Vitest for `src/`, c8 for `scripts/` and `.claude/hooks/`), merges it into `coverage/coverage-final.json`, and runs `fallow health --coverage` on it. Without coverage, fallow estimates it and flags any untested function at cyclomatic 5 or more. A full run takes about 15 minutes; `-- --quick` collects unit coverage only, and `-- --reuse` rescores the last coverage after an edit. A few timing-bounded generation tests time out under instrumentation; that does not affect the scores, and `npm test` stays the correctness gate.

DOM code (HUD, menus, binder panels, privacy dialogs, and the game shell) is tested in happy-dom: start the test file with `// @vitest-environment happy-dom` and import `src/render/domTestShims.ts` for the browser APIs happy-dom lacks. The game shell test stands in for the Pixi `Application` and the ticker, then drives `frame()` by hand.

`.fallowrc.jsonc` tells fallow which files run directly (`scripts/*.mjs`, `.claude/hooks/*.mjs`) so their exports count as used. When a new operational script is only invoked by path, it is covered by that glob; a script in a subdirectory needs its own entry.

## Recorded playthroughs

The Debug binder's **Record Playthrough** closes the binder, restarts the current site (a Time Challenge level restarts like Restart Site, but skips the briefing), and captures every fixed step from the first frame. A blinking **REC** badge stays on screen; **Stop** on the badge, **Stop Recording** in the binder, or any restart, new layout or site change finishes the capture. The payload (`src/debug/playthrough.ts`, format `permit-denied-playthrough` v1) holds:

- the setup that rebuilds the site: session rules (mode, level, seed, season, biome, effects, test map), the campaign run, and the career loadout (stats and attachments) the run used;
- the drive control applied on each step (`[step, throttle, steer, blade]`, change entries only), so keyboard and touch record the same way;
- discrete actions with the step they happened before: attachment presses (**Q** / **Shift**), Home Yard range resets (**T**), the resubmission fee that was charged, and **V** road cars;
- an end-state digest: cash, elapsed, dozer pose, heat and track, rubble count and mass, cell states and total cell HP.

The last capture is kept in `localStorage` (`pd.playthrough.last`); **Save File** downloads it as JSON and **Load Replay…** opens one. **Replay Last** rebuilds the site and feeds the recorded steps. Live keyboard, touch, attachment, resubmission and road-car input are ignored during a replay. Recordings are format version 2; version 1 files (which carried in-run upgrade picks) no longer load. The badge shows progress with **Pause**/**Play**, **Restart**, **Perf** (the timing overlay) and **Exit**. Replay runs at real 60 Hz pacing, so the perf overlay reads like live play. Freeze Simulation and Step One Frame step it one recorded frame at a time. When every step has run, the simulation holds and the badge reports **MATCH** or **DRIFT** with the fields that differ.

Replay is exact on the same build: same seed, same steps, same floating-point results. A recording made on another build may drift once simulation code changes; the payload names its build. Debug-bridge pose edits (`setDozerPose`, `lookAtWorld`) and test-yard edits are not recorded.

Automation drives the same flow through the debug bridge:

```js
__pd.startRecording();               // restart the site and capture
const run = __pd.stopRecording();    // payload, also kept as the last playthrough
__pd.replayPlaythrough(run);         // object or JSON text; omit to replay the last one
__pd.playthroughStatus();            // { state, step, steps, paused, done, drift, ... }
__pd.playthroughControl('pause');    // 'play' | 'pause' | 'restart' | 'exit'
```

`drift: []` once `done` is a match. `src/game/Game.test.ts` records a ranch demolition from the binder and checks that its replay matches.
