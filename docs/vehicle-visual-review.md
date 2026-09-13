# Vehicle artifact review

Reviewed all twelve configurations at eight headings, both paints in the catalog, and staged side-impact, compression, settling and pushing sequences.

## Corrections

- Windshields are thin panes fitted to the front cab face, inside painted borders. They no longer form a glass block over the bus roof. Glass and roof mounts follow their parent's compressed dimensions and shear.
- Bus and van body lengths, widths and roof seams agree; the rear shell is closed.
- Faces are culled against the actual isometric viewing direction. Headlights and hubs sit on their physical surfaces, so hidden faces no longer show through. Window dividers and damage marks follow their panels.
- A small surface painter partitions intersecting faces instead of sorting entire parts by their centers. Large body planes partition first to avoid excessive tire-driven fragments and fine raster seams.
- Overlapping detached assemblies share painter order with their wreck; separated pieces retain independent culling. Settling an overflow assembly invalidates cached geometry immediately.
- Passenger engines fit beneath their front bodywork. Tractor fenders sit outside the cab. Combine feeder/auger connections, skid-steer arm slope and trailer drawbar close visibly disconnected equipment joints.
- Capture framing keeps the main vehicle legible after small debris travels away, and explicitly hides the off-scene player helper. All parts remain in capture state records.

## Evidence

- `artifacts/vehicle-artifact-review/index.html`: before/after angle sheets and ten-frame production-contact sequences for every model.
- `artifacts/vehicle-artifact-review/bus-comparison.png`: bus windshield and body-seam comparison.
- `artifacts/vehicle-artifact-review/paint-review.png`: all twenty-four paint/model combinations.
- `artifacts/vehicle-artifact-review/catalog/index.html`: complete standard vehicle sweep; verifier passed 14 catalog entries, 27 variants and 2,190 screenshots with zero errors (includes the existing bulldozer and road demo).
- 97 tests across render, vehicle and yard modules passed, plus ten catalog tests. The final overflow-cache guard was subsequently checked by all 35 focused vehicle/render tests and the final browser run; the capture renderer already invalidates its cache before every screenshot.
- TypeScript check, production Vite build and whitespace check passed. This review did not repeat the unrelated full-game endurance benchmark.
- Desktop 1440×1000, emulated touch portrait 390×844 and landscape 844×390 passed vehicle controls and restoration checks with no browser errors.

## Performance

Final local run: Intel Core i7-8700K, 12 logical CPUs, 64 GB RAM, Windows, headless Chromium 153.0.8010.12. The scene contained 120 sleeping wrecks and twelve active vehicles. Simulation p95 was 7.7 ms and render submission p95 was 30.6 ms; 111 of 133 render groups were visible, with five rebuilt in the final frame. One detached assembly was active, within the shared budget.

Heap after four batches of load/damage/restore cycles: 14,563,700; 14,674,824; 14,865,428; 14,888,428 bytes. Post-warmup growth was approximately 0.20 MiB. No continuing growth was observed in this bounded run.

The dense wreck scene remains above a 60 Hz render budget. Submission timing measures CPU-side rendering calls rather than completed GPU work; touch emulation is not evidence of physical-phone performance. Raw results: `artifacts/vehicle-verification/report.json`.

All changes remain uncommitted and undeployed.
