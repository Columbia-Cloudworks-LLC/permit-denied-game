# Elevated buildings & support-driven collapse — progress

## Goal

Visibly elevated buildings with ground-level supports, staged location-dependent collapse, rubble/rewards, and reviewable evidence. Normal sandbox startup demonstrates the feature.

## Acceptance criteria

| ID | Criterion | Status |
|----|-----------|--------|
| A | Untouched ≥60s: all valid buildings intact, $0 | PASS — `TestUntouchedLotSixtySeconds`, `TestUntouchedBuildingsStable`, capture `A_*` |
| B | Localized breach: opening with upper structure still up | PASS — SW wall rubble with deck intact; `B_localized_breach` |
| C | Location-dependent failure origin/propagation | PASS — `TestSouthVsEastCollapseSetsDiffer`, `C_east_aftermath` vs south sequence |
| D | Full collapse with visible falling → rubble; cash once | PASS — `D_falling`/`D_settled`, `TestCollapseCashOnce`, gameplay collapse script |
| E | Drive/blade/collision/occlusion/rubble/restart + normal lot | PASS — sandbox + collapse harness scripts; shed door unit bite |
| F | Review-ready PR with screenshots/recording | IN PROGRESS |

## Decisions

1. **Support model**: Each deck cell binds to its 3 nearest load-bearing cells (wall/corner/door). Alive-anchor count drives sag (<3) and collapse (<2). Windows are not anchors.
2. **Tear propagation**: Sagging deck adjacent to falling/broken deck joins collapse quickly → contiguous chunks.
3. **Collision**: Standing roof/edge cells are not solid. Only ground supports + rubble/spill collide.
4. **Height**: `Stories` × 12px lift + matching south façade; SE ground shadows; roof contact shadows.
5. **Stages**: intact → cracked → sagging → falling (`FallY`) → broken dust → rubble.
6. **Interiors**: Dark floor slab under fallen deck (no furniture checkerboard).
7. **Authored lot**: SHED 1-story; STORE/HALL 2-story with northern-bay columns on HALL.

## Verification evidence

- Unit: `go test ./...`
- Capture: `PERMITDENIED_SILENT=1 go run ./cmd/capture-elevated --out DIR` (under Xvfb)
- Harness: `control-permitdenied drive` scripts `elevated-D-collapse`, `sandbox-destruction`
- Artifacts: `/opt/cursor/artifacts/elevated_capture/`, `elevated_gameplay/`

## Remaining limitations

- Collapse is section-local (southern deck can fall while northern deck remains) — intentional.
- Height is 2D oblique (lift + façade), not a 3D engine.
- Sandbox drive script targets the hall south face (reliable approach); shed bite covered by unit test.
