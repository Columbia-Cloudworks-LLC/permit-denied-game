# Test tiers and CI

`npm test` is the local presubmit: deterministic unit tests with a 30-second case budget. Heavyweight work is split so Linux and Windows no longer duplicate multi-minute generation and soak loops.

| Command | Project | What it covers | Where it runs |
| --- | --- | --- | --- |
| `npm test` | `unit` | Fast correctness, including classic/d10 generation smoke | Linux + Windows |
| `npm run test:integration` | `integration` | d30/d100 and campaign generation matrices, renderer draw cache | Linux |
| `npm run test:soak` | `soak` | Accelerated 20-minute sandbox wreckage | Linux |
| `npm run test:bench` | `bench` | District sim timings and dense-city render samples | Manual / dispatch, not a merge gate |
| `node --test scripts/*.test.mjs` | — | Operational script tests (paths, deploy helpers, capture harness) | Linux + Windows |
| `npm run check` | — | `tsc` for `src` and `checkJs` for operational scripts | Linux + Windows |
| `npm run build` | — | Typecheck, production bundle, initial-JS budget | Linux + Windows |

Windows keeps the required check name `windows`. It is a representative smoke: unit tests, script tests, production build, PWA verification. That still catches numerical drift on the classic/d10 lots, path separators in Node scripts, and filesystem layout of `dist/`. It does not rerun d100 campaign matrices or the soak.

Linux `build` runs unit + integration + soak, then packaging. Catalog capture remains Linux-only after that job. Benchmarks print timing lines and are excluded from ordinary correctness jobs; run `npm run test:bench` when investigating frame or debris cost.

The previous Vitest worker-source rewrite (`scripts/vitest-rpc-timeout*.mjs`) is gone. Integration, soak, and bench run a single worker so birpc ACKs stay under 60s; soak and the long campaign-generation matrices also yield with `pumpVitestRpc()`.

Expected local budgets: unit cases finish in seconds; integration can take a few minutes; soak is the long simulation; bench is measurement-only.
