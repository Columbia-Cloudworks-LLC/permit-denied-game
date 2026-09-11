# Building packages

Building content lives under `src/world/data/`. Vite discovers `*.building.json`, `*.layout.json`, `*.construction.json`, and `*.site.json` recursively. No registration list or barrel import is required. JSON is imported as raw text so malformed JSON can be reported with its source path. `archetypes.ts` resolves buildings; `buildingSites.ts` resolves sites after the buildings and prop catalog are available.

## Ownership and reuse

```text
src/world/data/
  shared/construction/timber-house.construction.json
  buildings/residential/ranch/
    main.building.json
    main.layout.json
  buildings/commercial/union-tower/
    main.building.json
    podium.layout.json
    office.layout.json
    mechanical.layout.json
  buildings/industrial/logistics-hub/
    main.building.json
    hall.layout.json
    loading.layout.json
    office.layout.json
  sites/datacenter/edge-campus.site.json
```

Folders are for people, not a rigid taxonomy. Put a new package in any sensible subfolder. Each building owns its sibling layouts; a layout reference must be a basename ending in `.layout.json`. Parent-directory paths, cross-package layout references, and two building IDs claiming the same layout file are rejected. All 11 original buildings have been migrated, including private copies of layouts formerly shared by the cottage/colonial/walkup and commercial variations.

`construction` explicitly references the `id` of a discovered shared construction preset. Editing that preset intentionally affects every referencing building. Presets contain physical materials and collapse timings; layouts contain rooms and furnishings. There is no inheritance or override chain. Resolved definitions are copied and deeply frozen; each runtime instance owns fresh health, cells, floors, roofs and fixtures.

## Add a building or variation

1. Copy a nearby building directory, or create a directory with a `*.building.json` file and its sibling layouts.
2. Set a new stable `id` and `label`. Retain the ID when updating an existing building: saved references and named placements use it. For a variation, copy its layouts too, then edit those private copies.
3. Choose an explicit shared `construction` ID. To isolate a construction change, create a new `.construction.json` with a unique ID and reference it.
4. Author either `layout` + `footprint`, or `sections`. Keep the common fields illustrated in the existing packages: `version: 1`, dimensions, kind, roof, theme, features, openings, window stride and zoning weights.
5. Remove the copied `generationOrder`. This optional unique order preserves the old weighted-selection sequence. New definitions sort by stable ID after explicitly ordered buildings, independent of filenames or import enumeration.
6. Start with all zoning weights zero. This makes the building playable in **SANDBOX → TEST YARD** without changing seeded districts or trying to fit a campus into a house lot. Setting a positive weight deliberately changes district selection; large structures need suitable lot-generation support before doing so.
7. Run `npm test` and `npm run build`. Open the yard, search its ID or traits, jump to it, use **View whole example**, destroy it and restore its bay. Driving resumes the close follow camera. Use the existing Debug roof/floor/reveal controls to inspect rooms.

`kind` remains the small existing gameplay category (`house`, `shop`, `industrial`), and `theme` selects an existing facade renderer. Neither is a comprehensive architectural taxonomy. Optional `traits` has independent string arrays for `use`, `form`, `construction`, `style`, `era`, and `scale`. The yard searches these values; they do not secretly change structural behavior. A landmark, apartment building or skyscraper can combine any of these descriptors while choosing an existing gameplay kind and visual theme.

## Flat layouts and sections

Flat packages retain the original normalized room format. `w` and `d` count simulation cells; `floors` counts stories. `footprint` is one array of `#`/`.` rows per story. Room coordinates are fractions of the whole building. Rooms must cover all occupied area without overlap, remain inside the footprint, and use existing room kinds, finishes and content assets. `contents` coordinates are fractions of the room, height is in world units, and rotation is 0/90/180/270. `partitions` creates physical room partitions. `connections` names room IDs and gives a doorway position and width as fractions of the shared wall.

Section packages compile rectangular volumes into that same runtime format. For example, Union Tower has:

```json
"sections": [
  { "id": "podium", "role": "podium", "x": 0, "y": 0, "w": 12, "d": 10,
    "floor": 0, "floors": 2, "layout": "podium.layout.json" },
  { "id": "tower", "role": "tower", "x": 2, "y": 2, "w": 8, "d": 6,
    "floor": 2, "floors": 21, "layout": "office.layout.json" },
  { "id": "mechanical", "role": "mechanical", "x": 2, "y": 2, "w": 8, "d": 6,
    "floor": 23, "floors": 1, "layout": "mechanical.layout.json" }
]
```

Section dimensions and offsets are integer cells, with zero-based starting floors. Each local template describes exactly one floor (`floor: 0`) using section-relative room fractions. `floors` repeats it without duplicating authoring data. Resolved room IDs are `section-id/absolute-floor/room-id`; each repeated room and content array is separately copied. Templates referenced by several sections of the **same** building are deliberate local reuse.

Volumes may touch but cannot overlap, extend outside the declared dimensions, or overhang unoccupied lower floors. The union produces one building with one damage state. Setback roofs remain exposed on lower floors. Flat roofs are split into rectangles so they do not bridge a tower cutout. Insets transfer support through the lower slab's existing bearing lines, using the same inexpensive collapse model. This is approximate structural behavior, not engineering analysis.

Set building-level `partitions` and `connections` for section packages. Connections between sections use the fully qualified room IDs above; the logistics hub demonstrates storage → loading → office connections. Template-local connections are repeated and qualified automatically. `role` describes the section; geometry and the referenced layout determine behavior. Section construction, roof style and facade theme are currently uniform across the building.

Openings retain normalized `at` along occupied south frontage. An optional `cell: { "x": 4, "y": 7 }` selects a recessed south-facing cell; it must actually be exposed. `kind` is `door` or `loading`. Openings remain destructible wall panels, not automatically open passages. Other entrance orientations, stairs and pedestrian circulation are not implemented.

## Sites

`edge-campus.site.json` demonstrates a site with two `data-hall` placements, a `campus-office`, transformers and HVAC equipment. Its `buildings` entries have a unique site-local member `id`, a building ID reference and world-space `x`/`y` offsets. `equipment` entries similarly reference existing destructible prop assets. Site dimensions and offsets are world units, not cells. Bounds, overlaps, duplicate member IDs, missing references and content budgets are validated before placement.

A site is a placement group, not one enormous structural grid. `instantiateBuildingSite` returns separate runtime buildings and props, which use normal collision, damage, collapse and debris paths. Damaging a hall does not mutate its sibling's state. Ordinary nearby explosions and falling debris can still damage neighbors. Member order and relative placements are deterministic. There are no nested sites or site-level construction overrides.

Reusing `data-hall` twice explicitly shares its immutable definition. To change only one hall's layout, copy that building package under a new ID and update only that site's reference. **Restore bay** restores the entire placement group and removes its owned debris and collapsed-site records; it is not an undo system for damage caused outside the bay. Sites are currently available in the yard and through the placement function, not in district generation. Equipment uses existing prop behaviors; utility networks and datacenter operations are not simulated.

## Scale and costs

The examples are intentionally coarse, playable slices:

| Example | World footprint | Stories | Grid slots / occupied floor tiles | Structural cells | Fixtures | Roof panels |
| --- | --- | --- | --- | --- | --- | --- |
| Union Tower | 13.8 × 11.5 | 24 | 2880 / 1296 | 608 | 45 | 18 |
| Interstate Logistics Hub | 80 × 50 | Hall 1, office 2 | 1280 / 672 | 120 | 20 | 32 |
| Data hall (each) | 24 × 16 | 1 | 96 / 96 | 36 | 9 | 6 |
| Edge campus | 66 × 42 | Three separate buildings | 216 / 216 total | 88 total | 19 total | 15 total |

The engine allocates a dense bounding grid, including empty placeholders, and occupied slab tiles. It does **not** allocate a Pixi object for each grid cell: exterior wall spans, roof panels and drawing caches reduce intact geometry. The constructor now shares precomputed bearing lines within an instance; roof exposure uses indexed occupancy, and fixture/floor checks use tile references indexed by floor and column. Runtime tile state remains mutable; indexes do not cache health.

Package limits are 64 cells per axis, 64 stories, 8192 bounding grid slots, 256 expanded rooms and 512 content placements. `cellSize` defaults to the original 1.15 and supports 0.5–4 world units. The warehouse uses 2.5 to represent a large footprint with only 640 ground tiles; higher cell size makes damage and doors coarser. Sites allow up to 16 buildings, 64 equipment items, 256 × 256 world units and 16384 total grid slots. Yard batches are capped at 32768 building grid slots, with 65536 for the live yard. These are allocation safeguards, not a promise that every maximum-size combination runs at 60 FPS.

Large structural bursts (over 32 debris/fixture emissions in one simulation step) limit new dynamic debris near the existing 72-body budget. Once full, additional mass goes straight into the owned editable pile, instead of first allocating thousands of bodies. One structural debris recipe may cross the threshold slightly. Existing particles, controlled falling walls, support timing and ordinary smaller debris events retain their paths. This bounds the demonstrated tower-demolition allocation spike while preserving debris mass and local restoration.

See [verification results](visual-verification/building-packages/verification.md) for measurements and screenshots. Full-building demolition still costs more than intact rendering, and dense debris contact can lower frame rate. This is not a city-wide skyscraper stress guarantee. Arbitrary rotations, per-section materials/heights, detailed structural bay analysis, full warehouse inventories, utility simulation and general-purpose collapse physics are future engine work, not supported package features.


## Core-supported tall buildings

Union Tower opts into `coreCollapse` in its own building definition. Existing buildings keep their existing bearing-wall/frame behavior. Copy the tower package under a new ID to make a variation; author dimensions, sections, private layouts, and supports together. Runtime resizing of core-collapse buildings is rejected.

`coreCollapse.supports` lists ground-floor grid coordinates `{ x, y, weight }`. These create actual central columns with collision and destructible HP. The six Union Tower columns occupy (4,4), (6,4), (8,4), (4,6), (6,6), (8,6); the middle pair has weight 2, the others weight 1. Keep furnishings clear of the columns. Coordinates must be unique and inside the ground footprint, not on its facade. Validation includes the source package and building ID.

Remaining capacity is the weight of intact/cracked columns divided by the original total. Facade panels carry no capacity. Below `capacityThreshold` (Union Tower: 0.45), a one-way warning begins for `warningDuration` (1.1 seconds), followed by `duration` (5 seconds) of coordinated sinking. Thresholds are authored gameplay values, not structural engineering predictions. Damaged but unbreached supports currently retain their full weight.

Supported behavior: ground-core failure, one coherent building-wide vertical collapse, repeated compression pulses, outward dust, nearby dozer impulse/track stress, editable rubble with material/yard ownership, and one completion reward. All sections of this building participate. Independently failing wings/cores, upper-floor initiation, torsion, lateral toppling, and load redistribution are not simulated. Use separate site buildings for independent damage states.

Collapse shells use precomputed merged floor rectangles. Pulses deposit mass directly into the existing pile (256 samples per material per floor) and use the fixed particle pool, creating no dynamic debris bodies. Local panel damage uses the existing debris budget before allocation. The pile renderer samples a coarse continuous surface, visually capped at 3.5 world units; simulation retains the complete mass/height and blade interaction. This does not introduce rigid-body physics. Many simultaneously collapsing towers and very large persistent pile fields remain unbenchmarked.

Settled core-collapse piles also constrain dozer movement. Their influence radius is 0.85 times the larger footprint dimension in world units. Resistance combines radial depth with local pile mass and height sampled across the chassis; it increases gradually and rejects movement into the dense center. It does not allocate colliders or debris. Blade excavation lowers resistance locally. The check uses the movement origin recorded by stepDozer, before world collision and excavation, so engine acceleration cannot produce frame-by-frame creep through a blocked area. A dozer caught inside can move toward equal or lower resistance to escape. Ordinary building rubble and road-vehicle behavior are unchanged.
