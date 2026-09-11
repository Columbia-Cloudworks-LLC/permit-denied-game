# PERMIT DENIED — lot architecture

Simulation stays in world coordinates. Isometric drawing is render-only.

The introductory [brick demolition job](brick-job.md) uses the showcase town and a separate contract controller. It owns its one-time reward and earned choice; world simulation retains ownership of the existing building bonus. Camera offsets are scaled screen pixels. Local visibility fades and painter-order corrections never alter structural state.

## Archetypes

Every registered building is authored in `src/world/data/buildings.json`. Construction assemblies and room layouts are separate reusable definitions. `src/world/archetypes.ts` validates and resolves the catalog; `createBuildingFromDefinition` compiles it into runtime state. See [construction authoring](construction-authoring.md) for the complete JSON format and validation rules.

All buildings have perimeter walls/columns, independent slabs, identifiable rooms and furnishings. Lots link to placements through `Building.lotId` and `Prop.lotId`; slab and furnishing state retains room IDs. Street props and yard experiments may be unowned. Districts select definitions through zoning weights; the classic town keeps its fixed placements.

Collision uses occupied cells only. Porch, awning, parapet, and chimney are decorative boxes and must not invent wall collision.

## Structural cells vs facade surfaces

`Building.grid` / `Cell` own wall/column HP, support, collapse, debris material, and collision. Every building has `floorTiles` for slabs; an empty structural cell can contain usable floor space and furnishings. Steel columns carry sacrificial cladding with its own HP. Rendering does not draw one isometric box per intact cell.

`src/render/buildingSurfaces.ts` extracts exterior south/east wall spans from live cells, merges compatible spans, and caches by a render-only signature (never reads or clears `structureDirty`). Slabs and interior walls use the common interior renderer; the old cavity and filled-cell top-cap renderers have been removed.

`Cell.material` is structural. `Cell.facadeMaterial` comes from the construction skin. Structural HP comes from the shared material defaults in `src/structure/materials.ts`. Frame-column cladding has separate health.

`src/render/lighting.ts` applies a fixed upper-west sun to wall and roof ramps. `slopeFacingLight` in `drawIso.ts` now delegates to `roofSlopeLight` so roof brightness follows light direction, not camera facing.

Intact buildings get one merged footprint shadow. Per-cell ground shadows are reserved for falling cells, debris, vehicles, and props.

## Roofs

`src/structure/roof.ts` builds locally supported roof bays over exposed floor footprints, including lower extensions. Each roof records its bearing floor. Wall spans stop at story height (`floors * FLOOR_Z`) unless that face carries a gable: then the top-floor span is one house-shaped polygon (rectangle plus peak) so there is no triangle seam on the story top. Flat roofs sit on that same story top with a small overhang. Shed roofs keep their slope: the top-floor south/east spans rise as trapezoids to the live shed plane so the lot does not show through under the high eave. Roof planes paint after those walls and own the eave. Do not draw a separate gable triangle or a post-roof fascia.

- Rectangular gable: paired sloped bays with local ridge segments, ridge along the chosen axis.
- Shed and flat: the roof plane is divided into local structural bays.
- Irregular top floors: deterministic strips over occupied cells only.

Authored construction determines which perimeter cells or columns support each roof bay. Floor coverage and bearing cells are separate. Lost local support sags, then drops that section. If most top-floor support is gone, remaining sections fail together. Roof debris is wood beams and panels (or metal panels) and follows the same mass budget as wall debris. Roof fall does not pay a second building bonus.

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

Shared damage response and fragment recipes live in `src/sim/objectBehavior.ts`; `src/sim/assets.ts` handles outdoor world effects such as explosions and bird events:

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

Road mesh is tessellated once into `network.mesh` and cached with static ground. Do not rebuild the whole network every frame. Mesh quads use center coordinates (`drawOrientedGround` convention). Driveway graph edges still meet the street centerline; visible driveway pavement stops at the public pavement edge and cuts a shoulder entrance. Junction pavement is a centered cap; shoulders run only on exterior sides and stop at driveway gaps.

### Neighborhood parcels

`src/world/parcels.ts` allocates lots from distance along public street polylines. Each developed lot stores `frontage` (segment, side, t interval), a world-space `boundary`, a buildable envelope after setbacks, and a driveway arrival. Intersection clearance and road/shoulder width are reserved before slots are cut. Parcel interiors may not overlap or occupy public corridors.

For D10 and larger, the capacity skeleton is an orthogonal connected block grid (`buildBlockGrid`) so public streets share real nodes. Grid size tracks district targets instead of overbuilding unused streets. Topology families (`county`, `crossroads`, `tjunction`, `curve-farm`, `loop`, `frontage`) add flavor on that grid: a loop with a chord (two routes), a curved spur, a T / dead-end, or a service stub. A seed-picked connected street cluster is developed; remaining streets stay as open space. If estimated frontage is still short, bounded `expandStreets` adds local streets and normalizes junctions before any lots are cut. After lots exist, generation does not add new public streets (that would cut parcels). Driveway splits remap remaining lot `frontage.segmentId` values. `finish({ normalize: false })` then builds lane wiring and the mesh without a second junction pass that would stale those IDs.

Failed candidates are recorded on `town.nhood.rejected` with reasons on every placement pass; their access records are dropped. If the target still cannot be met, `town.diagnostic` reports `capacity` instead of keeping invalid lots. `validateTown` checks full containment and corridor intersection independently of placement.

Buildings stay axis-aligned in world space (no structural rotation). The full footprint and decorative boxes must sit in the buildable envelope, and that envelope must sit in the parcel. Parcel interiors may not overlap actual street/shoulder corridor polygons. A continuous driveway segment then joins the frontage street at a real node and runs to an explicit arrival point. Dressing treats that corridor polygon as reserved occupancy; yard props whose centers fall in the lot boundary and outside the corridor are kept.

`validateTown` checks lane reachability from the road spawn, full parcel/building/corridor geometry, and that every access belongs to a retained lot. Legacy AABB road-box connectivity is not an escape hatch for generated districts.

Developer overlay: `?nhood=1` or press `G` to draw nodes, segment IDs, parcel rings, frontage edges, buildable envelopes, driveway corridors, and rejected candidates. While the overlay is on, the camera frames the whole town so junctions and parcels stay readable.

### Traffic and police contracts

Civilian traffic must stay on road or driveway. The V-key test car follows lane connectivity on a generated route (curve + intersection), not a hard-coded east-west path. Full civilian traffic sim is out of scope.

Police navigation is a **contract only** (`src/world/routing.ts`). Ordinary pursuit prefers roads. Police may leave the road only when the dozer is nearby, a valid off-road approach exists, and pursuit rules allow it. Off-road is slower (`offRoadCostMul`). Routing distinguishes a blocked road from an inaccessible destination. There is no police AI in this branch.

## Wreckage lifecycle and performance

Broken furnishings transfer into the same debris stream as outdoor objects. Their old fixture visuals are not retained beside the emitted debris. Each world step removes their inactive fixture records.

Debris continuously more than 28 world units from the dozer retires after eight unattended seconds and interaction grace, even below the normal caps. This deadline also retires numerical contact jitter that would otherwise keep a remote pile awake indefinitely. Nearby road vehicles protect their surroundings. Retirement preserves material mass and test-yard ownership in the editable pile. Normal budget and emergency cleanup still apply independently.

Fully demolished buildings retain their identity and one-time reward status. After eight seconds more than 28 units from their footprint, their cells, structural grid, floors, roofs, fixtures and decoration arrays are released. A persistent site and editable pile represent the aftermath. Returning does not respawn the building; restoration constructs a fresh instance.

Building geometry and floor-coverage caches use `visualRevision`. Code that changes visual or structural state must advance that revision; direct state mutation is not an authoring API. The renderer reuses submitted graphics by identity and visual state, preserves painter order, and destroys cached graphics when they leave the submitted view. Interior floor and wall caches are released when a building retires. Sleeping debris reuses its spatial index and support checks until positions, elevations, membership or pile state change.

Enable the performance overlay with `?perf=1` or DEBUG. It reports simulation CPU time, drawing preparation time, live runtime-record counts, retired buildings, retained drawing objects and geometry rebuilds. Browser heap usage is shown only when available; it is a sampled JavaScript heap estimate, not GPU memory. Compare object counts after repeated demolition/restoration and heap trends across garbage-collection cycles, rather than treating a single heap reading as a leak.
