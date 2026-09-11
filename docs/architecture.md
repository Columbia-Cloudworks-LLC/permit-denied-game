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

`src/structure/roof.ts` builds roof sections from the occupied top-floor footprint. Wall spans stop at story height (`floors * FLOOR_Z`) unless that face carries a gable: then the top-floor span is one house-shaped polygon (rectangle plus peak) so there is no triangle seam on the story top. Flat roofs sit on that same story top with a small overhang. Shed roofs keep their slope: the top-floor south/east spans rise as trapezoids to the live shed plane so the lot does not show through under the high eave. Roof planes paint after those walls and own the eave. Do not draw a separate gable triangle or a post-roof fascia.

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

## Destructible asset catalog

`src/world/catalog.ts` is the immutable data table. Each `AssetDef` carries id, family, tags, footprint, collision, material, HP, mass, resistance, blade multiplier, track hazard, cash, destruction profile, debris recipe, render boxes, placement zones, and optional spark / bird / explosion fields.

Runtime `Prop` instances store only identity, variant, transform, HP, pose, and velocities. Generation, simulation, scoring, and rendering look up the definition by `assetId`. Do not add kind-specific switches in those systems.

### Adding a future asset

Add one `AssetDef` to `ASSET_CATALOG` with a unique id, a destruction profile that already exists, a box recipe, debris numbers, and compatible lot zones. Lot templates in `src/world/dressing.ts` can reference the new id. No generation, collision, or scoring code needs a new branch.

### Destruction profiles

Shared handlers in `src/sim/assets.ts`:

| Profile | Use |
| --- | --- |
| `brittle` | Fast shatter into fragments (trash cans, crates) |
| `bend-snap` | Lean, then snap (mailboxes, poles, signs) |
| `crush` | Compact under the blade; leftover mass can enter the pile field |
| `topple` | Fall away from impact; leave a pushable remnant (trees) |
| `roll` | Become a movable remnant (round hay, barrels) |
| `panel-collapse` | Drop large panels (billboards, sheds, grain bins) |
| `explosive` | One arcade blast that pushes debris and damages neighbors; chain depth is capped (`EXPLODE.maxGeneration`) |

Traffic cameras still use the bird-escape gag (`birdGag`). Light poles and power poles keep track hazard.

### Lot dressing and ground

`src/world/dressing.ts` templates (rural residence, family yard, farmstead, roadside service, contractor yard, utility lot, small commercial) place assets relative to lot + building, test occupancy, and keep a driveway corridor. Same seed reproduces selection, variants, headings, and ground patches.

Ground covers (`grass`, `dirt`, `gravel`, `tracks`, `concrete`, `parking`, `driveway`, `planted`) are deterministic and cached with static ground rendering. A tiled grass/scrub field covers the town extent first so the canvas does not show through between lots; lot patches and the road mesh paint on top. Covers are render-only unless a driveway corridor is also used for access checks. Yard slots are placed in heading-aligned lot space (depth along the lot heading, frontage across) so front-yard assets stay on the lot instead of on pavement.

Density budgets live in `DRESSING`: per-lot caps and per-district maxima (`classic` / `d10` / `d30` / `d100`). New debris uses the existing distance-prioritized cleanup; broken props leave the collision hash.

## Road graph (foundation)

`src/world/roads.ts` is the source of truth. Districts are generated road-first (`src/world/rural.ts`): topology family from seed, then frontage parcels, then buildings and driveway segments. `town.roads` AABB boxes are a derived compatibility view.

Types: `RoadNode`, `RoadSegment` (polyline + class + width + layer + elevation), `Lane`, `RoadAccess`, `TerrainField`. Queries: `roadSurfaceAt`, `terrainHeightAt`, `nearestRoadAccess`, `projectPointToRoad`, `connectedLanes`, `canTransitionBetweenSurfaces`, `findRoadRoute`, `publicStreetsReachable`. A spatial hash indexes segments so vehicles do not scan the whole graph each step. `invalidateNetworkIndex` clears that cache after a finished network is mutated.

`RoadBuilder.joinAt` / `splitSegment` / `normalizeJunctions` make same-layer T-junctions and crossings share real nodes. Connecting to a segment interior splits it and remaps lanes and accesses. Different layers do not join just because X/Y overlap. Graph mutations finish before `finish()` builds lane wiring and `network.mesh`.

This branch generates and renders `rural`, `residential`, `service`, and `driveway`. `commercial`, `arterial`, `highway`, and `ramp` exist as classes; full highway / bridge / police behavior is not implemented. Elevation is a controlled surface height (not 3D physics). Terrain is a base height field; roads can occupy additional layers at the same X/Y. `makeRaisedRoadFixture` proves a ground road and a raised deck that do not connect without a ramp.

Road mesh is tessellated once into `network.mesh` and cached with static ground. Do not rebuild the whole network every frame.

### Neighborhood parcels

`src/world/parcels.ts` allocates lots from distance along public street polylines. Each developed lot stores `frontage` (segment, side, t interval), a world-space `boundary`, a buildable envelope after setbacks, and a driveway arrival. Intersection clearance and road/shoulder width are reserved before slots are cut. Parcel interiors may not overlap or occupy public corridors.

For D10 and larger, the capacity skeleton is an orthogonal connected block grid (`buildBlockGrid`) so public streets share real nodes. Topology families (`county`, `crossroads`, `tjunction`, `curve-farm`, `loop`, `frontage`) add flavor on that grid: a loop with a chord (two routes), a curved spur, a T / dead-end, or a service stub. If estimated frontage is still short, bounded `expandStreets` adds local streets and normalizes junctions before any lots are cut. Distant unserved rows are not used. After lots exist, generation does not add new public streets (that would cut parcels). Driveway splits remap remaining lot `frontage.segmentId` values. `finish({ normalize: false })` then builds lane wiring and the mesh without a second junction pass that would stale those IDs.

Failed candidates are recorded on `town.nhood.rejected` with reasons; their access records are dropped. If the target still cannot be met, `town.diagnostic` reports `capacity` instead of keeping invalid lots.

Buildings stay axis-aligned in world space (no structural rotation). The full footprint and decorative boxes must sit in the buildable envelope. A continuous driveway segment then joins the frontage street at a real node and runs to an explicit arrival point. Dressing treats that corridor polygon as reserved occupancy; yard props whose centers fall in the lot boundary and outside the corridor are kept.

`validateTown` checks lane reachability from the road spawn, full parcel/building/corridor geometry, and that every access belongs to a retained lot. Legacy AABB road-box connectivity is not an escape hatch for generated districts.

Developer overlay: `?nhood=1` or press `G` to draw nodes, segment IDs, parcel rings, frontage edges, buildable envelopes, driveway corridors, and rejected candidates. While the overlay is on, the camera frames the whole town so junctions and parcels stay readable.

### Traffic and police contracts

Civilian traffic must stay on road or driveway. The V-key test car follows lane connectivity on a generated route (curve + intersection), not a hard-coded east-west path. Full civilian traffic sim is out of scope.

Police navigation is a **contract only** (`src/world/routing.ts`). Ordinary pursuit prefers roads. Police may leave the road only when the dozer is nearby, a valid off-road approach exists, and pursuit rules allow it. Off-road is slower (`offRoadCostMul`). Routing distinguishes a blocked road from an inaccessible destination. There is no police AI in this branch.
