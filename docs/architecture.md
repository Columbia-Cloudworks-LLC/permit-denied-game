# PERMIT DENIED — lot architecture

Simulation stays in world coordinates. Isometric drawing is render-only.

The introductory [brick demolition job](brick-job.md) uses the showcase town and a separate contract controller. It owns its one-time reward and earned choice; world simulation retains ownership of the existing building bonus. Camera offsets are scaled screen pixels. Local visibility fades and painter-order corrections never alter structural state.

## Archetypes

Building packages are discovered recursively under `src/world/data/`. Each building owns sibling layouts and explicitly references shared construction presets. `src/world/archetypes.ts` validates and expands sections/repeated floors; `createBuildingFromDefinition` compiles the resolved definition into runtime state. `buildingSites.ts` groups independently destructible buildings and exterior props for campus placement. See [construction authoring](construction-authoring.md) for the complete JSON format and validation rules.

All buildings have perimeter walls/columns, independent slabs, identifiable rooms and furnishings. Lots link to placements through `Building.lotId` and `Prop.lotId`; slab and furnishing state retains room IDs. Street props and yard experiments may be unowned. Districts select definitions through zoning weights; the classic town keeps its fixed placements. Time Challenge uses a separate opt-in `campaign` weight table; see [campaign](campaign.md).

Collision uses occupied cells only. Porch, awning, parapet, and chimney are decorative boxes and must not invent wall collision.

## Structural cells vs facade surfaces

`Building.grid` / `Cell` own wall/column HP, support, collapse, debris material, and collision. Every building has `floorTiles` for slabs; an empty structural cell can contain usable floor space and furnishings. Steel columns carry sacrificial cladding with its own HP. Rendering does not draw one isometric box per intact cell.

`src/render/buildingSurfaces.ts` extracts exterior south/east wall spans from live cells, merges compatible spans, and caches by a render-only signature (never reads or clears `structureDirty`). Slabs and interior walls use the common interior renderer; the old cavity and filled-cell top-cap renderers have been removed.

`Cell.material` is structural. `Cell.facadeMaterial` comes from the construction skin. Structural HP comes from the shared material defaults in `src/structure/materials.ts`. Frame-column cladding has separate health.

`src/render/lighting.ts` applies a fixed upper-west sun to wall and roof ramps. `slopeFacingLight` in `drawIso.ts` now delegates to `roofSlopeLight` so roof brightness follows light direction, not camera facing.

Intact buildings get one merged footprint shadow. Per-cell ground shadows are reserved for falling cells, debris, vehicles, and props.

**Regional walls and procedural trim.** Both are render-time dress; neither touches cell material, HP or collision. `src/render/wallPaint.ts` picks a finish and sunlit tone for each wall material of a building from the palette of its `WallRegion` (`southwest`, `gulf`, `brick-belt`, `mountain`, `pacific`): brick, stucco, adobe, sandstone, limestone, clapboard, CMU, timber, shingle or plain, with civic masonry taking the region's dressed stone. Ribbed steel and industrial tilt-up read the same everywhere, each material rolls independently from the building's regional seed, and glass, yards and maps without a climate keep the stock colours. `src/structure/facadeTrim.ts` derives a `FacadeTrimPlan` per building from its archetype traits, theme, construction and seed: stringcourses, cornice or corbelling, plinth, quoins or pilasters, lintels, sills, shutters, awning style, and mounted gear on single wall cells (meters, conduit, downspouts, louvers, service doors, wall packs, blade signs, window units on older walk-ups). `stampStreetFaces` records which visible face fronts the lot's street; the other is the service face and carries the utility gear. Authored `facadeDetails` always win: trim stays off the cells they cover. See [facade detail authoring](facade-detail-authoring.md#procedural-trim-and-regional-walls).

## Roofs

`src/structure/roof.ts` builds locally supported roof bays over exposed floor footprints, including lower extensions. Each roof records its bearing floor. Wall spans stop at story height (`floors * FLOOR_Z`) unless that face carries a gable: then the top-floor span is one house-shaped polygon (rectangle plus peak) so there is no triangle seam on the story top. Flat roofs sit on that same story top with a small overhang. Shed roofs keep their slope: the top-floor south/east spans rise as trapezoids to the live shed plane so the lot does not show through under the high eave. Roof planes paint after those walls and own the eave. Do not draw a separate gable triangle or a post-roof fascia.

- Rectangular gable: paired sloped bays with local ridge segments, ridge along the chosen axis.
- Shed and flat: the roof plane is divided into local structural bays.
- Irregular top floors: deterministic strips over occupied cells only.

Authored construction determines which perimeter cells or columns support each roof bay. Floor coverage and bearing cells are separate. Lost local support sags, then drops that section. If most top-floor support is gone, remaining sections fail together. Roof debris is wood beams and panels (or metal panels) and follows the same mass budget as wall debris. Roof fall does not pay a second building bonus.

Intact districts do not scan every roof every frame. Roof stepping runs only on dirty or unsettled buildings.

**Flat decks.** The renderer merges contiguous intact, level flat-roof cells of one floor into rectangular decks (`flatRoofDecks` / `mergeFlatRoofDecks` in `buildingSurfaces.ts`, cached on the render signature), so a flat roof draws no seams between cells. A section that is sagging, falling or beside an open cell stays loose and draws as its own panel, so seams appear only at breaches and sags. A deck never wraps around a taller wing or rooftop equipment. Open canopies draw panel by panel.

**Membranes, parapets and regional forms.** `roofFinishFor` (`src/render/roofFinish.ts`) fixes one membrane per building: bright TPO (cold-chain and retail kits, metal industrial, non-civic concrete), dark EPDM (towers and office kits, other industrial), tar-and-gravel BUR (brick and timber walls, low civic) or troweled adobe. Each has its own surface wear: weld seams, aggregate and mastic patches, service pavers to heavy plant, or sun-bleached washes. Buildings with `features.parapet`, and adobe roofs, get parapets with coping. The north and west runs paint with the deck; the south and east runs paint after the gear behind them, with scuppers at the quarter points where the facade's downspouts hang (adobe roofs show viga ends and one spout instead). Snow caps the deck and coping. `src/structure/regionalExterior.ts` swaps the roofs of a few host archetypes (`ranch`, `cottage`, `porch-house`, `community-hall`; flat `motel-room-block`, `neighborhood-clinic`) for a regional `RoofForm` by weighted roll per `RoofRegion`: barrel-tile gable, adobe flat, hip metal, hip tile or cool flat. Temperate zones, retired buildings, core-collapse towers and roofs with roof-mounted facade details keep what was built. Roofs are regenerated; footprints, cells and collision do not change. It runs once on the finished layout, before brand stamping, and stamps `Building.region` for the wall and trim code.

**Rooftop equipment.** `src/structure/rooftop.ts` generates `RooftopFixture`s for each building at construction, deterministically from `rooftopSeed`. `rooftopKit` picks an equipment family by occupancy (`food`, `cold`, `retail`, `office`, `walkup`, `service`; canopies, open decks and tank frames get none), `ROOFTOP_KINDS` defines each unit's footprint, height, dead-load mass, debris material and break effect, and southwest houses and low civic roofs add swamp coolers and tilted solar. A fixture stands on one or two roof-covered cells and is anchored to those roof sections (`rooftopSupports`). Heavy plant takes the highest deck on towers and the largest deck elsewhere. Placement is generated, not authored; see [construction authoring](construction-authoring.md#generated-roof-equipment).

Rooftop equipment follows its roof. While any roof section under a fixture is standing it rides that panel's hinge and sag. When one starts to fall or is gone, light gear (hoods, vents, masts, split condensers, panels) tears off as sheet metal and glass through the roof debris path. Heavy plant (RTUs, chillers, condenser banks, cooling towers, bulkheads) falls as a dead load: 0.34 s for the first storey, 0.2 s for each later one. On each storey it crushes the furnishings and weak walls beneath it, punches through a slab whose resistance (material HP / 12) is less than its mass times storeys fallen, and otherwise bursts into scrap at rest. Units with a salvage class pay a one-time scrap value, `salvageCash`: copper coils 20 + 24 per unit of scrap, mixed mechanical 18 + 14, rounded to $5. The popup is labelled `COPPER` or `SCRAP` (`cashPopups.ts`) and merges only with the same kind. A core tower (`coreCollapse`) takes its roof plant down inside the falling stack: `collapseRooftop` adds the units' mass to the aggregate and pays their salvage there, never again through the roof path. Roof fall still pays no second building bonus.

Fine fittings (vents, hatches, split condensers, skylight curbs) draw only at street zoom with the details layer on; plant, hoods, ducts, masts and arrays keep their silhouette in overview. The Debug **Rooftop equipment** (`gear`) layer hides the lot. Culling boxes include `rooftopClearance`. Rendering reads fixture state and never mutates it.

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

Caps live in `DEBRIS`: remnant/fragment soft caps, `hardOverflow`, `protectRadius`, `interactGrace`, `retireDelay`, `roadLinger`.

`addDebrisBody` does not absorb. Collapse can overflow for a moment. `stepDebris` then ranks eligible bodies by squared distance from the dozer (farther first, higher id on ties), prefers sleeping bodies, skips anything near the dozer or recently moved/spawned/awake, and never absorbs a body touching the dozer or blade. If the hard cap is still exceeded, the farthest unprotected bodies go regardless of sleep.

The technical overlay (`?perf=1` or `` ` ``) splits `far` (distance cleanup) from `emerg` (hard-cap cleanup).

## Debris motion and contact

A collapse spawn drops its bodies from the storey they broke off, capped at 1.6 units above the heap (`MAX_AIR` in `src/sim/debris.ts`); fragments are also kicked upward. In the air a body keeps its throw. On touchdown the ground grips it by its material's friction and it bounces by its restitution (`BOUNCE`): steel hops and slides on, masonry thuds and stops. On the ground, drag scales with friction, static friction stops a piece that is nearly at rest, and fragments hold on pile slopes below the angle of repose. Lighter material is thrown further (`throwScale`), and fragments take their material's proportions (`FRAGMENT_SIZE`). Unsupported cells let go at 0.85 to 1.3 of the construction's `failureDelay`, fixed per cell by `failureStagger`, so a span sheds as a ragged run.

Body contacts exchange an equal and opposite impulse with friction; the normal points from the first body to the second, and only a closing pair is resolved. The broad phase runs once per step from the awake bodies, and the solver passes relax that pair list. A sleeping body is a fixed obstacle until something strikes it above `DEBRIS.wakeImpulse`; resting overlap does not wake it, so a settled heap leaves the solver. Vehicle and blade contact always wake what they touch.

When the blade cuts a pile, about half the lifted mass is pushed ahead as a berm and the rest becomes live debris moving with the blade. Once the berm stands above `SPILL_HEIGHT`, a growing share rolls off the blade ends into windrows and the berm adds to the push load.

## Debris appearance

`drawDebris` in `src/render/effectsDraw.ts` draws a body as the material it broke from: bonded brick courses on a mortar bed, concrete with a paler broken face and rebar, steel beams bent at a kink and ribbed sheets (some rusted), timber planks with pale splintered ends, flat glass shards. Shape and tone come from the body's seed, so a piece keeps its look while it moves. Pile hint cells and tower mounds take the mass-weighted colour of the materials in the cell (`pileTint`), and dust takes the colour of what broke. All of it is render-only.

## Climate

A county's geography decides what its weather, ground and buildings may be. `src/world/climate.ts` takes a `ClimateGeography` (latitude, elevation, aridity, maritime influence, bedrock), derives the coldest-month mean (`winterMeanC`), and `classifyClimate` maps it by thresholds to one of 17 zones (Sonoran, Mojave and Chihuahuan deserts, Canyonlands, Great Basin, Mediterranean coast, Gulf subtropical, Tropical, Humid South, Upland South, Southern Plains, Temperate, Great Plains, Alpine, Pacific maritime, Boreal, Subarctic). Nothing there names a place. The zone's `ClimateEnvelope` then says: whether snow falls and lies (`allowsSnow`) and whether ponds freeze (`allowsFreeze`; dry air needs a colder winter before anything sticks), the `landscape`, default biome, `soil`, the `winterLook` a snowless winter borrows, the roof and wall regions, a `sun` profile, and per-season odds for each sky (`clear`, `overcast`, `precip`, `storm`, `fog`, `dust`, `heat`; zero means the zone never rolls it).

`src/world/regionClimate.ts` holds the geography table: one row per region plus overrides for individual counties (a plateau county in a low-desert state, a desert county in a coastal one). `countyClimate` classifies it, `countyBiome` lets desert, canyon, coast, alpine and boreal zones override a region's flavor biome, and `countyEnvironment` in `counties.ts` returns the county's biome and climate id. A map without a county takes its biome's home climate (`climateForBiome`), and `?climate=<id>` names a zone directly. **Bundle rule:** `climate.ts` is plain data and pure functions in the startup bundle and must not import the region manifest; `regionClimate.ts` lives in the lazy overworld chunk with the region data.

`townSeasonState` (`groundCondition.ts`) is the only place the four season fields of a `Town` are set, so they cannot disagree:

| Field | Meaning | Read by |
| --- | --- | --- |
| `Town.season` | Calendar season | Weather odds, field states, briefings, `weatherRisk` |
| `Town.look` | Season to paint in; a snowless winter shows the zone's `winterLook` | Palettes, terrain chunks, forest garnish, `sunlightFor` |
| `Town.frozen` | Ponds and rivers are ice the dozer can cross | Traversal (`movementBlocked`), spawn checks, ground tone |
| `Town.groundCondition` | `clear` or `snow` cover | Terrain and cover tints, snow-capped roofs, backdrop, footing |

**Skies and hazards.** `rollWeatherCondition` rolls a county's sky from the zone's odds, seeded, so it is always legal for the season and zone; the state sheet's Weather select lists only `legalConditions`. `climateHazard` turns a rolled sky into a named hazard: `dust` is a haboob in arid country and blowing dust elsewhere, `heat` is extreme heat, a `storm` is a blizzard in a snowy winter, and otherwise a monsoon in arid country (not in spring) or a squall on subtropical coasts. Any other storm is ordinary weather. `weatherPresetFor` builds the light, haze and particle kind (dust sheets, downpour, heat shimmer). `groundState` turns the sky and cover into footing (`dry`, `wet`, `mud-wash`, `snow`) and the one traction number, lateral `slip`, which `weatherRisk` carries into the fixed step; stakes and pay are in [campaign](campaign.md#overworld-and-counties). `src/render/weatherBadge.ts` is the single source for a sky's label, icon and HUD advisory, so a snowless county never shows a snowflake in one place and rain in another.

**Ground, sun and sky.** `SOILS` gives each zone's dust, compacted track, mud and verge colours; they tint tread marks, dust plumes, bare lots and road verges, and `groundTone` (`coverPalette.ts`) keys the ground cache on ice, arid and soil. `sunlightFor` (`lighting.ts`) is a pure function of climate, sky and paint season: it warms or cools the light, widens the lit/shaded face spread in desert sun and narrows it in the north, and diffuses it under cloud, dust and fog. `backdropColor` colours the space past the map edge: a snowfield under snow, the zone's darkened verge soil in arid country, meadow green elsewhere.

## Destructible asset catalog

`src/world/catalog.ts` is the immutable data table. Each `AssetDef` carries id, family, tags, footprint, collision, material, HP, mass, resistance, blade multiplier, track hazard, cash, destruction profile, debris recipe, render boxes, placement zones, and optional spark / bird / explosion fields. `salvage` (`copper` or `mechanical`) makes a destroyed asset's cash pay as a labelled scrap popup; `breakFx` (`refrigerant`, `soot`, `arc`) names the burst and sound it makes. `immovable` marks fixed scenery such as house-sized boulders: hits never wear it down. The HVAC unit and transformer use `salvage` and `breakFx`.

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

**Machine breaks.** A wrecked rooftop unit or `breakFx` prop calls `machineBreak` (`src/structure/rooftop.ts`): a refrigerant puff, soot plume or arc sparks in `ParticlePool`, plus a `machine-break` world event that the game turns into a hiss, duct crunch or electric snap. `CueGate` in `src/audio/synth.ts` keeps a collapsing plant room from clipping: each cue has its own cooldown and at most `MACHINE_VOICES` (3) ring at once.

### Lot dressing and ground

`src/world/dressing.ts` templates (rural residence, family yard, farmstead, roadside service, contractor yard, utility lot, small commercial) place assets relative to lot + building, test occupancy, and keep a driveway corridor. Campaign eligibility is applied before chance rolls, prop budget, and occupancy, so disallowed props never consume a slot or block a neighbor. After a building is placed, `src/world/lotUse.ts` assigns the lot profile from building traits: fuel equipment needs a service use, crop fields need an agricultural use, houses stay residential, civic/commercial buildings take the shop profile, and industrial yards take contractor or utility. Same seed reproduces selection, variants, headings, and ground patches.

Natural ground is a versioned surface grid (`src/world/terrain.ts`, `TERRAIN_GEN_VERSION = 1`) generated **before** roads. `TerrainField.height` stays a separate 2.4-unit height field and does not drive vehicles. Gameplay queries `surfaceAt` / `roadCostAt` / `lotCostAt` / `traversalAt`; it never switches on sprite names. `CoverKind` is leftover polygon garnish (lot pads, driveways, parking, field crop tints). Map-level `GroundCondition` (`clear` | `snow`) comes from biome (`northern-conifer` → snow) and tints both atlas solids and lot covers; CoverKind identities and collision stay the same. Ground cache keys include that condition. Forest-core is impassable; forest-floor is slow but open. `enforceOpenCorridors` clears wooded cells from lots, roads, buildings, and a 1.6-unit setback so woods do not swallow yards. Water stays unless it sits on a retained street or a building footprint plus a short authored setback; parcels that would put a buildable envelope on water or forest-core shrink or are rejected instead of filling the shoreline. Rendered forest garnish (layered oak/pine masses, edge trees, understory) sits on those cells so the visual footprint matches collision.

Overlay precedence, later wins:

1. Base classified cell (`grass` / `scrub` / `dirt` / `prairie` / `duff` / `leaf-litter` / `gravel`)
2. `field` blob overlay
3. `wet-edge`
4. `water`
5. Lot dressing pads
6. Driveway / parking patches
7. Road mesh

Autotiles load `/terrain/ground.json` (atlas PNG + TexturePacker hash frames) into chunked Pixi meshes (`SURFACE_CHUNK = 16`). Camera pan does not rebuild tiles. The old 6.2-unit world-fill checker is gone.

Density budgets live in `DRESSING`: per-lot caps and per-district maxima (`classic` / `d10` / `d30` / `d100`). New debris uses the existing distance-prioritized cleanup; broken props leave the collision hash.

**Service yards.** `SERVICE_YARDS` (`src/world/serviceYards.ts`) is data: each rule names the occupancies it serves (archetype ids or `traits.use` tags) and slots for props placed behind the building, beside it, or at its loading bays: food service (dumpster corral, grease trap), convenience (ice merchandiser, propane exchange cage), critical power (backup generator, transformer pad), loading dock (bumpers, bollards, pallets). A slot can supersede a generic template prop (`replaces`). Props come from `serviceYardAssets.ts`. Yards use their own per-lot seed so adding one never reshuffles a town, take at most `SERVICE_YARD_MAX` (5) from the lot's budget, and go through `dressing.ts` occupancy, corridor and campaign-eligibility tests.

**Arid dressing.** In desert and canyon zones, lot covers turn to `xeriscape`, `gravel` and `caliche` (`lotCover`), driveway patches for residence, farm, contractor and utility lots take gravel or caliche covers (`drivewayStyle`; widths and collision unchanged), and `dressAridRoads` (`edgeRoads.ts`) bleaches asphalt, tints soft shoulders in the zone's soil, cracks the roads out to the map edge and pours concrete low-water crossings where a road fords a wash. These are colour and garnish only.

### Landforms

`placeLandforms` (`src/world/landforms.ts`) runs once after roads, lots and buildings exist, so ground features never decide where development goes. It does nothing for forest and boreal landscapes. Each landscape has a plan: buttes (desert), mesas (canyonlands) and outcrops (prairie, alpine), sized by map area and clamped; subtropical coasts get flora only.

- **Formations.** A lobed blob of solid `rock` cells ringed by drivable `talus`, terraced by distance from the cliff edge. `traversalAt` reports `rock` as impassable; talus and dry `wash` ground stay open. They keep a setback of open ground from anything developed, wet, wooded, farmed or already rock, and from both spawns. A formation is kept only if the dozer can still reach every cell it could before. The renderer (`landformDraw.ts`) draws stepped cliffs in banded strata under a caprock, tinted by bedrock, as cached slices.
- **Boulders.** Clusters (one fixed boulder with loose rock around it) and loners, granite or sandstone by bedrock. Large boulders are `immovable`: a solid the dozer and traffic deflect off. Smaller rocks are ordinary remnants.
- **Washes and water.** Dry washes are surface cells, not blockers. Mesquite pockets and the occasional palm stand along washes and real shorelines; they are the only desert trees.
- **Flora.** Tables per zone (saguaro only in the Sonoran, Joshua trees only in the Mojave, sagebrush in the high deserts, sabal palm and palmetto on the coast), placed in groups after rock and boulders. `biome.accents` lets a biome admit these species.
- **Land use.** Field blocks in desert zones never plant row crops. Each becomes scrub rangeland with a windpump and stock tank, an irrigated citrus orchard with furrows, or a ground-mount solar array, weighted by zone (`aridLandUse`).

`validateTown` calls `landformIssues`: every formation must be solid on the grid, and rock may not cut off a lot, the road spawn or developed ground that the same map without its rock could reach. The terrain atlas builder (`scripts/build-terrain-atlas.mjs`) appends `rock`, `talus`, `wash` and `sand` solids, with snow variants, after the legacy frames so existing frames keep their atlas cells.

## Road graph (foundation)

`src/world/roads.ts` is the source of truth for the graph. Districts are generated **terrain-first** (`src/world/rural.ts`): bounds, biome, and surface grid, then an orthogonal block-grid skeleton scored by `roadCostAt`, then frontage parcels that consult `lotCostAt` / `lotEnvelopeRejected` before mutating the grid, then buildings. Wooded cells under retained streets, lots, and a short setback convert to grass (`enforceOpenCorridors`) before the developed stamp; water is cleared only under streets and building footprints. Features are derived from the stamped grid. `town.roads` AABB boxes are a derived compatibility view. Classic Rivertown and the Governor's estate keep authored building and road positions and stamp developed cells afterward.

Types: `RoadNode`, `RoadSegment` (polyline + class + width + layer + elevation), `Lane`, `RoadAccess`, `TerrainField`. Queries: `roadSurfaceAt`, `terrainHeightAt`, `projectPointToRoad`, `canTransitionBetweenSurfaces`, `findRoadRoute`, `publicStreetsReachable`. A spatial hash indexes segments so vehicles do not scan the whole graph each step.

`RoadBuilder.joinAt` / `splitSegment` / `normalizeJunctions` make same-layer T-junctions and crossings share real nodes. Connecting to a segment interior splits it and remaps lanes and accesses. Different layers do not join just because X/Y overlap. Graph mutations finish before `finish()` builds lane wiring and `network.mesh`.

This branch generates and renders `rural`, `residential`, `service`, and `driveway`. `commercial`, `arterial`, `highway`, and `ramp` exist as classes; full highway / bridge / police behavior is not implemented. Elevation is a controlled surface height (not 3D physics). Terrain is a base height field; roads can occupy additional layers at the same X/Y. `makeRaisedRoadFixture` proves a ground road and a raised deck that do not connect without a ramp.

Road mesh is tessellated once into `network.mesh` and cached with static ground. Do not rebuild the whole network every frame. Mesh quads use center coordinates (`drawOrientedGround` convention). Driveway graph edges still meet the street centerline; visible driveway pavement stops at the public pavement edge and cuts a shoulder entrance. Junction pavement is a centered cap; shoulders run only on exterior sides and stop at driveway gaps.

### Neighborhood parcels

`src/world/parcels.ts` allocates lots from distance along public street polylines. Each developed lot stores `frontage` (segment, side, t interval), a world-space `boundary`, a buildable envelope after setbacks, and a driveway arrival. Intersection clearance and road/shoulder width are reserved before slots are cut. Parcel interiors may not overlap or occupy public corridors. When a surface grid is present, candidates that put water or forest-core in the buildable envelope shrink along depth or are recorded as `terrain` rejects instead of filling those cells. Primary lot covers store the parcel `boundary` polygon; developed stamping and cover speckles use that ring so rotated or tapered lots do not paint their axis-aligned box onto the neighbor or shoreline.

For D10 and larger, the capacity skeleton is an orthogonal connected block grid (`buildBlockGrid`) so public streets share real nodes. Grid size tracks district targets instead of overbuilding unused streets. Topology families (`county`, `crossroads`, `tjunction`, `curve-farm`, `loop`, `frontage`) add flavor on that grid: a loop with a chord (two routes), a curved spur, a T / dead-end, or a service stub. A seed-picked connected street cluster is developed; remaining streets stay as open space. If estimated frontage is still short, bounded `expandStreets` adds local streets and normalizes junctions before any lots are cut. After lots exist, generation does not add new public streets (that would cut parcels). Driveway splits remap remaining lot `frontage.segmentId` values. `finish({ normalize: false })` then builds lane wiring and the mesh without a second junction pass that would stale those IDs.

Failed candidates are recorded on `town.nhood.rejected` with reasons on every placement pass; their access records are dropped. If the target still cannot be met, `town.diagnostic` reports `capacity` instead of keeping invalid lots. `validateTown` checks full containment and corridor intersection independently of placement.

Buildings stay axis-aligned in world space (no structural rotation). The full footprint and decorative boxes must sit in the buildable envelope, and that envelope must sit in the parcel. Parcel interiors may not overlap actual street/shoulder corridor polygons. A continuous driveway segment then joins the frontage street at a real node and runs to an explicit arrival point. Dressing treats that corridor polygon as reserved occupancy; yard props whose centers fall in the lot boundary and outside the corridor are kept.

`validateTown` checks lane reachability from the road spawn, full parcel/building/corridor geometry, and that every access belongs to a retained lot. Legacy AABB road-box connectivity is not an escape hatch for generated districts.

Developer overlay: `?nhood=1` or press `G` to draw nodes, segment IDs, parcel rings, frontage edges, buildable envelopes, driveway corridors, and rejected candidates. While the overlay is on, the camera frames the whole town so junctions and parcels stay readable.

### Traffic and police contracts

Civilian traffic must stay on road or driveway. The V-key test car follows lane connectivity on a generated route (curve + intersection), not a hard-coded east-west path. Full civilian traffic sim is out of scope.

`src/world/routing.ts` holds the police navigation contract. Ordinary pursuit prefers roads. Police may leave the road only when the dozer is nearby, a valid off-road approach exists, and pursuit rules allow it. Routes report their `RouteMode` (`road`, `offroad-pursuit`, `blocked`, `inaccessible`); no off-road travel cost is modelled yet. Routing distinguishes a blocked road from an inaccessible destination. The Code Enforcement cruisers in `src/vehicle/traffic.ts` use `policeMayLeaveRoad` for their ram decision and are dispatched by campaign events, not a timer; see [traffic.md](traffic.md).

### Regional data and the startup bundle

Regional content reaches town generation only through `RegionalPlacement` (`src/world/regionalPlacement.ts`, startup): boosts, signatures, an optional landmark override, the county's brand list, and a `finish` callback that runs once on the finished layout. The data and the code behind them (`regionalCatalog.ts`, `regionalBrands.ts`, `landmarkPack.ts` and the packages in `src/world/landmarkData/`) sit in a lazy chunk shared by the overworld and the Home Yard. `landmarkPack.ts` registers its archetypes with `registerArchetypes`, so `archetypeById` finds them while `ARCHETYPES` stays the eager roster. County towns are only built after the overworld has loaded. Nothing in the startup graph may import those modules.

Brand stamping is post-creation visual state: it replaces `building.facadeDetails`, sets `fasciaColor` and bumps `visualRevision`; rendering stays read-only. Weather stakes (`src/game/weatherRisk.ts`) enter the fixed step as a grip input to `stepDozer` and as scaling of that step's heat and track gain, so they are recorded-replay safe.

## Wreckage lifecycle and performance

Broken furnishings transfer into the same debris stream as outdoor objects. Their old fixture visuals are not retained beside the emitted debris. Each world step removes their inactive fixture records.

Debris continuously more than 28 world units from the dozer retires after eight unattended seconds and interaction grace, even below the normal caps. Chunks lying on road pavement wait `DEBRIS.roadLinger` times as long, so a rampage leaves visible evidence on the streets. This deadline also retires numerical contact jitter that would otherwise keep a remote pile awake indefinitely. Nearby road vehicles protect their surroundings. Retirement preserves material mass and test-yard ownership in the editable pile. Normal budget and emergency cleanup still apply independently.

Fully demolished buildings retain their identity and one-time reward status. After eight seconds more than 28 units from their footprint, their cells, structural grid, floors, roofs, fixtures and decoration arrays are released. A persistent site and editable pile represent the aftermath. Returning does not respawn the building; restoration constructs a fresh instance.

Building geometry and floor-coverage caches use `visualRevision`. Code that changes visual or structural state must advance that revision; direct state mutation is not an authoring API. The renderer reuses submitted graphics by identity and visual state, preserves painter order, and destroys cached graphics when they leave the submitted view. Interior floor and wall caches are released when a building retires. The body hash rebuilds only when a pose or membership changes. A sleeping fragment keeps its support height until the pile tile under it or the set of remnants changes; fragments churning nearby do not disturb it.

Ground marks are drawn in 24-mark buckets by age (`src/render/markLayer.ts`), so a new chip repaints one bucket. Pile hints are one Graphics per 8-cell pile tile; a tile repaints only when its revision moved and it is on screen, and at most eight repaint per frame, which spreads a tower pulse over a few frames.

A frame runs at most `SIM_MAX_STEPS` fixed steps, and after the first step starts no further one once `SIM_STEP_BUDGET_MS` has gone to simulation; time still owed is dropped and shows as `drop` in the overlay.

Enable the performance overlay with `?perf=1` or DEBUG. It reports simulation CPU time, drawing preparation time, live runtime-record counts, retired buildings, retained drawing objects and geometry rebuilds. Browser heap usage is shown only when available; it is a sampled JavaScript heap estimate, not GPU memory. Compare object counts after repeated demolition/restoration and heap trends across garbage-collection cycles, rather than treating a single heap reading as a leak.
