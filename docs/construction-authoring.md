# Building authoring

Every registered building uses one construction system: perimeter walls or frame columns, independent floor slabs, furnished rooms, and locally supported roof sections. There is no filled-cell building mode.

## Author a building with JSON

Edit `src/world/data/buildings.json`. The versioned catalog has three sections:

- `constructions`: shared structural assemblies, materials and collapse timing.
- `layouts`: rooms, finishes, object placements and room connections.
- `buildings`: dimensions, footprint, construction/layout references, openings, roof, appearance and zoning weights.

A building using existing materials, objects and construction behaviors needs no simulation or renderer changes. It appears automatically in the asset yard. Positive zoning weights make it eligible for district generation.

For example, this is a complete building entry using existing catalog references:

```json
{
  "id": "garden-house",
  "kind": "house",
  "label": "GARDEN HOUSE",
  "w": 5,
  "d": 3,
  "floors": 1,
  "construction": "timber-house",
  "layout": "ranch",
  "footprint": [["#####", "#####", "#####"]],
  "openings": [{"floor": 0, "side": "south", "at": 0.5, "kind": "door"}],
  "roof": "gable",
  "roofAxis": "x",
  "theme": "ranch",
  "windowStride": 2,
  "features": {"porch": false, "awning": false, "parapet": false, "chimney": true, "garage": false},
  "zones": {"residential": 4, "commercial": 0, "industrial": 0}
}
```

Footprints are arrays of floors, each containing north-to-south row strings. `#` means occupied floor space; `.` means absent floor space. Row length is `w`; rows per floor are `d`. The compiler derives perimeter walls from this footprint. Empty structural grid cells inside a room are usable space, not missing floors.

Room bounds (`x, y, w, d`) are fractions of the entire building footprint. Every occupied area must belong to exactly one room. A room has a stable `id`, a purpose such as `bedroom`, a floor number and a floor finish. Multiple bedrooms use different IDs.

Object slots have their own stable IDs. Their bounds are fractions of their room; height is in world units. Rotation is 0, 90, 180 or 270 degrees. The slot dimensions describe the final rotated footprint. Use the existing content kinds from `src/world/contents.ts`.

```json
{
  "id": "bed-west",
  "kind": "bed",
  "x": 0.14, "y": 0.12, "w": 0.58, "d": 0.66, "h": 0.48,
  "rotation": 90
}
```

When `partitions` is true, adjacent rooms receive destructible partition walls. Specify door gaps through `connections`; there is no automatic centered-door fallback:

```json
{"a": "1-bedroom-west", "b": "1-bedroom-east", "at": 0.5, "width": 0.4}
```

Both door position and width are fractions of the shared wall. Rooms must share an actual edge on the same floor. Every room on a partitioned floor must be connected through doorways. Open industrial plans can use `partitions: false`.

## Compilation and ownership

`parseBuildingCatalog` is the JSON validation seam. It rejects malformed shapes, unknown fields, unsupported versions, missing references, duplicate identities, unknown materials/objects, invalid dimensions, overlapping rooms/objects, incomplete room coverage, rooms crossing footprint holes, invalid entrances and disconnected partitioned rooms. Loaded definitions are copied and frozen.

`createBuildingFromDefinition` is the production constructor used by both district generation and the test yard. It creates mutable state from the definition: walls, slabs, roof coverage/bearings, furnishings and collision state. Invalid definitions throw before insertion into a town. The lower-level `createBuilding` also requires construction, layout and openings; it is used for explicit test hosts, not an alternate building model.

The runtime uses flat arrays for efficient iteration, with explicit ownership:

- `Building.lotId` and `Prop.lotId` link developed placements to lots. Street props and standalone yard experiments have null lot ownership.
- `Building.layout.rooms` contains immutable room definitions.
- Slabs retain `roomId`; furnishings retain `roomId`, `placementId` and their floor.
- Roof sections retain their bearing floor, including roofs over lower extensions.
- Materials are shared definitions referenced by construction assemblies and objects, not children of rooms.

## Physical behavior

`src/structure/materials.ts` owns material HP, beam span, density, crushability and friction defaults. Appearance finishes remain separate: ceramic-looking fixtures can use a concrete gameplay material. Object definitions may explicitly override health and mass.

All buildings use independent slabs. Ground slabs persist after demolition; upper slabs fall when their local bearing cells are lost. Roof coverage is separate from support. Frame columns can shed sacrificial cladding before the column fails. Roofs over lower extensions use that extension's bearings.

`src/sim/objectBehavior.ts` owns shared object damage response and debris recipes. Interior fixtures and outdoor props use it. Room placement adds floor support and exposure; upstairs fixtures never enter ground vehicle collision. Broken objects stop blocking vehicles. Debris and loose mass remain in the bounded world debris system.

Collapse remains controlled animation suitable for districts, not a general physics engine.

## Verify

Run `npm test` and `npm run build`. Building-definition tests exercise new JSON entries, invalid authoring, immutable definitions and ownership. Construction tests demolish every registered archetype and check that structures and contents settle without duplicate rewards or fragments.

Open **SANDBOX → TEST YARD**. Every building uses the production constructor. The same content definition also appears in standalone and interior contexts so its shared behavior can be compared. Use **DEBUG** to hide roofs, choose floors, reveal contents or inspect support. **Destroy example** and **Restore bay** exercise complete collapse and local restoration.

The ranch, brick mixed-use and steel presets remain available. **BRICK JOB** retains its contract controller; see [brick-job.md](brick-job.md). Yard controls are documented in [asset-test-yard.md](asset-test-yard.md).

## Supported scope

The current renderer and simulation use axis-aligned footprints on a cell grid, rectangular rooms, south-frontage entrance panels, procedural windows and gable/flat/shed roofs. Entrance panels are destructible; an authored door is not an automatically open vehicle passage. Connection validation establishes room topology, not a pedestrian navigation or circulation solver. Floor finish rendering follows the cell grid.

Stairs, arbitrary rotated buildings, other entrance orientations, utility networks, multilayer wall stacks and new physical material categories need explicit engine support. Room objects currently support brittle, crush and panel-collapse profiles; other profiles are rejected for room placement rather than silently ignored. Outdoor explosive, roll and topple behaviors retain their world handlers.

Do not reintroduce compatibility flags or special cases for a building ID. Extend a shared behavior deliberately, migrate affected definitions, and delete the superseded path.
