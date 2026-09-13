# Vehicle verification

Verified locally on Windows with Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz, 64 GB RAM and Chromium 153.0.8010.12.

- Twelve vehicle configurations, two paint variants each.
- Desktop 1440×1000, touch portrait 390×844 and touch landscape 844×390: vehicle selection, run/stop, impacts, overhead load, restore, fleet run, camera following and overflow checks passed.
- Existing mobile verification passed all eight viewport sizes, menus and touch interactions.
- Browser errors: 0.
- Stress scene: 120 sleeping wrecks and 12 active vehicles. Simulation p95 4.4 ms; render submission p95 23.5 ms.
- Final active detached assemblies: 1, within the shared 72-body budget.
- Heap after four batches of 24 load/damage/restore cycles: 14.24 MB, 14.40 MB, 14.59 MB, 14.62 MB. Post-warmup growth: 0.22 MB; no unbounded accumulation observed in this run.

Render submission measures the CPU-side call, not completed GPU work. These browser results do not establish physical-phone performance. The stress scene intentionally puts hundreds of cached assemblies in view; its render cost exceeds a 60 Hz frame budget on this test configuration.

All 536 game test cases passed across the full suite and targeted reruns. The full final run passed 535 and hit the 180-second limit on the accelerated twenty-minute benchmark while captures were running; that benchmark passed alone in 176 seconds. After the trailer support-height correction, all 29 vehicle tests passed again. Logs: `artifacts/vehicle-tests-final.log`, `artifacts/vehicle-benchmark-final.log`, and `artifacts/vehicle-final-focused.log`. TypeScript checking and the production build passed. All ten catalog unit checks and desktop/mobile gallery verification passed.

Final images and manifests: `artifacts/vehicle-catalog-final/index.html`. The coverage verifier checked 14 assets / 27 variants / 2,190 images with zero errors: 12 new modular vehicles plus the existing bulldozer and road demo. The catalog contains four headings and staged impacts, travel, settling and wreck pushing for every new vehicle and paint variant. The legacy bulldozer and road-demo captures are included separately. Every capture run verifies image/state evidence and deterministic restoration.

Generated evidence is ignored by Git. This verification predates release; use Git history and deployed build metadata for the current release status.
