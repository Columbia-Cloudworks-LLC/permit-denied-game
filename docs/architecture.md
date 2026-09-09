# PERMIT DENIED — lot architecture

Simulation stays in world coordinates. Isometric drawing is render-only.

## Archetypes

`src/world/archetypes.ts` is the data table. Each archetype sets kind, footprint, floors, materials, roof style/axis, facade theme, window stride, door/loading rules, and optional porch, awning, parapet, chimney, or garage. District lots pick one with lightweight zoning weights. Classic town uses fixed placements.

Collision uses occupied cells only. Porch, awning, parapet, and chimney are decorative boxes and must not invent wall collision.

## Structural cells vs facade surfaces

`Building.grid` / `Cell` remain the simulation source of truth for HP, support, collapse, debris material, and collision. Rendering does not draw one isometric box per intact cell.

`src/render/buildingSurfaces.ts` extracts exposed south/east walls and optional top caps from live cells, merges compatible spans, and caches by a render-only signature (never reads or clears `structureDirty`). Breached cells merge into cavity groups; falling cells still draw as displaced chunks.

`Cell.material` is structural. `Cell.facadeMaterial` is render-only skin for ground-floor south facades (brick veneer on wood houses, etc.) and does not change HP on house/shop archetypes. Industrial ground-floor metal stays structural.

`src/render/lighting.ts` applies a fixed upper-west sun to wall and roof ramps. `slopeFacingLight` in `drawIso.ts` now delegates to `roofSlopeLight` so roof brightness follows light direction, not camera facing.

Intact buildings get one merged footprint shadow. Per-cell ground shadows are reserved for falling cells, debris, vehicles, and props.

## Roofs

`src/structure/roof.ts` builds roof sections from the occupied top-floor footprint.

- Rectangular gable: two sloped planes and a shared ridge, ridge along the longer axis unless the archetype overrides it.
- Shed and flat: one explicit section so they share the same support/collapse life.
- Irregular top floors: deterministic strips over occupied cells only.

An intact top-floor cell supports its section. Lost local support sags, then drops that section. If most top-floor support is gone, remaining sections fail together. Roof debris is wood beams and panels (or metal panels) and follows the same mass budget as wall debris. Roof fall does not pay a second building bonus.

Intact districts do not scan every roof every frame. Roof stepping runs only on dirty or unsettled buildings.

## Debris layers

Four different leftovers, on purpose:

| Layer | Owner | Role |
| --- | --- | --- |
| `Rubble[]` | Town | Pushable rigid bodies. Soft-capped. |
| `PileField` | Town | Compacted loose mass and the real heap height. |
| `GroundMark[]` | Town | Temporary chips, scrapes, dust. Cosmetic. |
| `CollapsedSite` | Town | Permanent foundation scar for one demolished building. |

Cleanup never deletes a collapsed site. Absorbing a body moves its mass into the pile field.

## Debris cleanup

Caps live in `DEBRIS`: remnant/fragment soft caps, `hardOverflow`, `protectRadius`, `interactGrace`.

`addDebrisBody` does not absorb. Collapse can overflow for a moment. `stepDebris` then ranks eligible bodies by squared distance from the dozer (farther first, higher id on ties), prefers sleeping bodies, skips anything near the dozer or recently moved/spawned/awake, and never absorbs a body touching the dozer or blade. If the hard cap is still exceeded, the farthest unprotected bodies go regardless of sleep.

The technical overlay (`?perf=1` or `` ` ``) splits `far` (distance cleanup) from `emerg` (hard-cap cleanup).
