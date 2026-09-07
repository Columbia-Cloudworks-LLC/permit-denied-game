# Elevated buildings & structural demolition — progress

## Goal

Visibly elevated buildings with ground-level supports, staged location-dependent collapse, and a destruction presentation that reads as structure — not 16×16 cells being deleted from a sprite.

## Acceptance criteria

| ID | Criterion | Status |
|----|-----------|--------|
| A | Untouched ≥60s: all valid buildings intact, $0 | PASS — `TestUntouchedLotSixtySeconds`, `TestUntouchedBuildingsStable` |
| B | Localized breach: opening with upper structure still up | PASS — SW corner sags nearby deck; windows are not load-bearing |
| C | Location-dependent failure origin/propagation | PASS — `TestSouthVsEastCollapseSetsDiffer`, south vs east captures |
| D | Full collapse with warning → falling → rubble; cash once | PASS — sag/vibration, `FallStarts` groan, grouped falling, `TestCollapseCashOnce` |
| E | Drive/blade/collision/occlusion/rubble/restart + normal lot | PASS — sandbox scripts; shed door unit bite |
| F | Grid hidden; irregular openings; distinct bite vs collapse | PASS — merged cavities, façade holes, material spill, collapse FX |

## Decisions

1. **Support model**: Each deck cell still binds to its 3 nearest load-bearing cells (wall/corner/door). Alive-anchor count drives sag (<3) and collapse (<2). Windows are not anchors.
2. **Local clamp**: A deck cell with **no live support in its 8-neighborhood** cannot be held by distant 3-nearest anchors (score clamped to 1). This stops southern bays hovering on far north walls without replacing the bind model.
3. **Load path**: Standing deck must BFS through standing deck to a live adjacent support. Isolated islands fall.
4. **Tear propagation**: Sagging deck adjacent to falling/broken deck joins the same `FallGroup` within a few ticks → contiguous chunks.
5. **Collision**: Standing roof/edge cells are not solid. Only ground supports + rubble/spill collide. Spill AABBs are material-specific irregular piles.
6. **Height**: `Stories` × 12px lift + south façade; remaining-mass shadows; roof contact shadows; roof caps over interior columns.
7. **Stages**: intact → superficial wound → cracked → sagging (warn) → falling (`FallY`, group tear) → broken dust → rubble.
8. **Presentation**: Adjacent cavities merge into one opening. South façade punches irregular holes instead of dropping 16px columns. Collapse FX is heavier than a window bite (hit-stop, dust, large fragments, groan).
9. **Authored lot**: SHED 1-story; STORE/HALL 2-story with northern-bay columns on HALL.

## Verification evidence

- Unit: `go test ./...`
- Capture: `PERMITDENIED_SILENT=1 xvfb-run -a go run ./cmd/capture-elevated --out DIR`
- Harness: `control-permitdenied drive` scripts `elevated-D-collapse`, `sandbox-destruction`
- Frames: `docs/elevated_evidence/` (intact, localized breach, sag, falling, settled, east contrast)

## Remaining limitations

- Height is 2D oblique (lift + façade), not a 3D engine.
- Sandbox drive script targets the hall south face (reliable approach); shed bite covered by unit test.
- Interior is implied (dark floor, beams, posts), not a simulated room.
