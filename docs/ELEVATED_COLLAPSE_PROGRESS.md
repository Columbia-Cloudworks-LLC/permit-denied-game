# Elevated buildings & support-driven collapse — progress

## Goal

Visibly elevated buildings with ground-level supports, staged location-dependent collapse, rubble/rewards, and reviewable evidence. Normal sandbox startup must demonstrate the feature.

## Acceptance criteria

| ID | Criterion | Status |
|----|-----------|--------|
| A | Untouched ≥60s: all valid buildings intact, $0 | PENDING |
| B | Localized breach: opening with upper structure still up | PENDING |
| C | Location-dependent failure origin/propagation | PENDING |
| D | Full collapse with visible falling → rubble; cash once | PENDING |
| E | Drive/blade/collision/occlusion/rubble/restart + normal lot | PENDING |
| F | Review-ready PR with screenshots/recording | PENDING |

## Decisions

1. **Support model**: Upper deck (roof/edge) is supported via BFS through intact deck cells to a cell adjacent to a load-bearing ground support. Not immediate-neighbor-only; not global HP%.
2. **Load-bearing**: Wall, Corner, Door. Windows (glass) are cosmetic — not supports.
3. **Collision**: Standing roof/edge cells are **not** solid. Only ground supports (+ rubble/spill) collide. Breaches open drive-through under still-elevated roof.
4. **Height**: `Structure.Stories` (1 shed, 2 store/hall). Visual lift = `Stories * StoryLiftPx`. Façade strip on south walls. Ground shadow at footprint.
5. **Stages**: intact → cracked (local) → sagging (weak path) → falling (`FallY`) → broken dust → rubble.
6. **Interiors**: Do not stamp repetitive interior checkerboard under every fallen roof tile; floor only under collapsed deck footprint, then rubble.
7. **Vertical slice first**: two-story rectangular hall behavior, then adapt shed/store.

## Bug verified (main)

`CountSupport` + `minSupport=1` + roofs excluding roofs as supports → central/edge deck tiles with no wall neighbor get `CollapseIn` immediately. Untouched STORE breaks by tick 5.

## Plan (staged)

1. Core cell/structure/collapse rewrite + validation tests
2. Renderer: elevation, façade, shadow, falling, depth sort
3. Assets via `genbuildings` (façade, shadow, sag)
4. Adapt lot footprints (stories); preserve materials
5. Harness scripts + visual evidence A–E
6. PR

## Completed

- Branch `cursor/elevated-buildings-collapse-f9b8`
- Confirmed untouched instability

## Next

Implement support BFS, non-solid roofs, staged fall, elevation draw.
