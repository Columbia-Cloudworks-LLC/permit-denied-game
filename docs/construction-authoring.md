# Building construction and interiors

Try the three demonstration buildings using the **RANCH**, **BRICK**, and **STEEL** buttons. Each starts a fresh sandbox with the dozer facing the selected building. Direct links are `?demo=ranch`, `?demo=rivertown`, and `?demo=steel-warehouse`. The brick and steel archetypes also participate in commercial and industrial district generation.

These developer presets appear in **SANDBOX**. **BRICK JOB** (or `?job=brick`) launches the introductory contract with an earned upgrade and one-time payout; see [job and verification notes](brick-job.md).

## Definition path

`src/structure/construction.ts` defines reusable construction and room recipes. An entry in `src/world/archetypes.ts` selects a `ConstructionDef`; simulation and rendering do not dispatch on its archetype ID.

| Field | Meaning |
| --- | --- |
| `walls` | Filled-cell house, masonry perimeter, or steel frame with sacrificial cladding |
| `structure`, `skin`, `floor`, `roof` | Materials for distinct parts of the assembly |
| `bays` | Independently animated roof sections, including exposed framing |
| `floorSupport` | Existing cell-supported house floors or independent slabs |
| `failureDelay`, `fallDuration` | Controlled wall failure timing |
| `rooms` | Floor number, normalized room bounds, floor finish, and contents |
| `partitions` | Generate destructible partitions between adjoining rooms, with door gaps |

Room coordinates are fractions of the building footprint. Content slots are fractions of their room; height is in world units. Kitchen, living-room, and bathroom contents are reusable sets. Keep slots clear of entrances and circulation paths. `validateConstruction` rejects out-of-bounds rooms/slots, overlaps, and invalid timing. Creation rejects invalid definitions before district generation can place them.

The initial constructions are `TIMBER_HOUSE` (ranch), `BRICK_MIXED_USE` (retail/storage below an apartment), and `STEEL_HALL` (storage racks, loading space, and equipment). They intentionally cover different structural and interior needs.

## Runtime behavior

- Perimeter buildings leave their interior structural grid cells empty. Collision follows thin exterior walls and surviving columns, allowing a dozer into the open hall.
- Frame columns have their own HP. Their metal cladding can shed once without removing the supporting column. Metal infill panels between columns are not roof supports.
- Roof sections distinguish their covered floor tiles from their bearing walls/columns. Flat and shed roofs split into two-cell bays without changing their overall plane; gable bays support either ridge axis.
- Ground slabs persist. Upper slabs record bearing cells in a nearby column band on the floor below; when all those bearings are gone, the slab falls, releases its furnishings, and becomes rubble.
- Interior furnishings become visible through wall/roof openings. Upper-floor furnishings never enter the ground vehicle collision hash.
- A landed roof bay or upper slab breaks contents under its coverage. Damage and loss of floor support also break fixtures. All fragments enter the existing bounded debris system, with elevation and mass.
- The original filled-cell ranch keeps its established floor-support behavior while using the common room recipes, content catalog, roof rendering, and interior renderer.

## Adding contents

`src/world/contents.ts` contributes definitions to the existing `ASSET_CATALOG`. A content definition provides material/HP, a destruction profile, debris recipe, and normalized `RenderBox` geometry. Both intact fixture drawing and debris spawning read this catalog. The interior renderer has no fixture-kind drawing switch.

To add a new fixture, add its kind to `FixtureKind`, author its catalog definition, and place it in a room recipe. Boxes use the same format as outdoor assets; normalized boxes are scaled to the room slot. Current content profiles use brittle breakage, crushing, and panel remnants. Exterior prop behaviors such as explosions and rolling are not yet attached to interior fixtures.

## Verification and limits

`src/structure/construction.test.ts` tests definition reuse, scaled placement, cladding/core independence, local roof failures, upper-floor support loss, fixture collision elevation, roof animation continuity, and complete demolition. Existing ranch rendering and simulation tests remain applicable.

This is a controlled demolition model, not engineering simulation. Upper slab bearings use grid bands, not arbitrary beam graphs. Wall skins on the steel columns are separately destructible; arbitrary multilayer masonry, stone/marble materials, utility networks, stairs, and plant-specific machinery are not implemented. Those should extend the assembly/content definitions with actual new behaviors, rather than introduce building-ID branches. Keep city-scale debris and simulation budgets when adding them.
