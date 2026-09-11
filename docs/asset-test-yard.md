# Asset Test Yard

Open **SANDBOX → TEST YARD** (or `?sandbox=1`). The entry preset enumerates `ASSET_CATALOG`, `ARCHETYPES`, `BUILDING_SITES`, and `CONTENT_ASSETS`; no sandbox placement list is maintained. Challenges, named demos, the brick job, and 10/30/100 districts retain their generators.

Expand **ASSET TEST YARD** at the left. Search a name or stable ID, optionally filter category/material/destruction, and jump to its baseline. Choose a zero-based variant and quantity (1–100). **Experiment area** supplies empty-area coordinates. **Preview selected** or **Preview all filtered** shows reserved demolition-clearance bays; **Place preview** confirms them. Expand variants to generate each declared variant for each requested copy. Change X/Y to reposition the batch. The yard extends south as necessary, preserving pile state; a placement is limited to 500 instances and Y=2000 to bound memory. Overlap, bounds, debris and dozer conflicts are reported before placement.

The instance selector distinguishes the baseline from user-added copies. Jump to an instance, destroy it using the production damage path, restore its bay, remove an added copy, or clear debris physically inside the selected test area. Restore complete baseline leaves added copies in place. Driving remains W/S, A/D and Space once focus leaves the panel. Panel typing and button presses do not drive the dozer. Coordinates describe the corner of a reserved bay, not the asset footprint.

## Registering content

- **Prop:** add an `AssetDef` to `src/world/catalog.ts`'s `ASSET_CATALOG`, including dimensions, material, health, destruction recipe, clearance, explosion radius and variant count. Add any required production rendering. It appears automatically under `prop:<id>`, including interior-content props. Search its ID and try quantity 10, then expand its variants.
- **Building:** add a `*.building.json` package under `src/world/data/`, with sibling layouts and an explicit shared construction reference. See [construction authoring](construction-authoring.md). The validated registry and archetype IDs derive from discovered files. It appears automatically under `building:<id>`. Test demolition and local restoration, then its normal district/lot context separately.
- **Site:** add a `*.site.json` with building ID and prop asset references. It appears under `site:<id>`, with independent building damage and group restoration. Use **View whole example** for campuses, tall towers and large warehouses; driving or jumping returns to the follow camera. Search also includes independent building traits such as `high-rise` or `logistics`. Large batches are bounded by grid-slot budgets as well as instance counts.
- **Fixture:** extend `FixtureKind` and the content specs in `src/world/contents.ts`. The resulting `CONTENT_ASSETS` registration creates both the ordinary prop example and a separate `fixture:interior-<kind>` context. Add room slots in building-owned JSON layouts where the fixture should occur in real buildings. Yard fixtures use `makeFixture`, building-owned support, production interior drawing and `applyFixtureDamage`; they are not outdoor props disguised as coverage.

Fixture hosts have an open front, retained independent floor tiles and one fixture on each of two floors. Ground fixtures block the dozer; elevated fixtures use the normal upper-floor support and fragment-elevation paths. Use Debug floor/roof visibility to inspect floors; visibility controls do not change collision. Destroy example breaks the selected fixture pair. Demolish the host with the dozer to test support loss.

## Contexts and limits

The current baseline has 50 prop definitions, 15 building archetypes, one campus site and 13 fixture contexts (79 bays). Counts derive from definitions; invalid health, dimensions, variants or constructor failures appear in the panel. Structural walls, roofs, floor treatments and collapse effects are contextual building examples, not separately spawnable props. Gravel pads and the paved road are labeled/contextual ground coverage; arbitrary terrain/effect permutations are not a catalog.

The road vehicle is a separate singleton runtime with road-following, not catalog health/destruction. **Context coverage → Run road vehicle** starts it on the generated paved lane. Only one road vehicle is supported; vehicle batch spawning and prop-like destruction are unavailable. The catalog's parked car remains a separate destructible prop.

Bay restoration removes the old prop/building, owned rubble (including moved bodies), owned particle/ground marks, owned pile contributions, and collapsed-site records. Sparse pile provenance follows extraction/pushing and growth; collision broad phases and render revisions are invalidated. Active runtime IDs are never rewound by edits. Pile compaction and dominant-material mixing still follow the inexpensive production pile simulation; restoring a bay is not an undo of damage inflicted on another bay. Keep experiments in their reserved clearances if independent reset is required.

## Verification

Run `npm test` and `npm run build`. `src/world/testYard.test.ts` covers registry discovery (including supplied new definitions), layout clearance, fixtures, batches, variants, runtime IDs, repeated destruction/restoration, moved debris, mixed pile ownership, world growth, collision invalidation and existing preset behavior.

Verified locally: the full 214-test regression suite passed, followed by 43 targeted tests after final editor hardening. TypeScript and the production Vite build passed. Browser verification covered search, ten-copy preview/placement, destruction, independent restoration, fixture destruction/restoration, and resumed dozer demolition. With the baseline plus ten copies, a 1,067-frame sample measured 17.7 ms median frame interval, 0.6 ms median simulation CPU and no dropped simulation time (GPU timing not measured).


## Dedicated skyscraper map

Open `/?tower=1` or click **SKYSCRAPER** in the session bar. The isolated sandbox has one 24-floor Union Tower, a clear concrete test area, and a dozer south of the entrance. It does not populate the asset yard or surrounding district. **Reset tower** / R rebuilds it; other session buttons leave the test map.

- **Tower / dozer view** switches overview and close driving camera.
- **Inspect ground floor** reveals the central supports; hidden upper floors still simulate.
- **Breach facade** removes the south ground facade using ordinary damage. Upper floors should remain intact and capacity stay at 100%.
- **Fail core** destroys all six supports through ordinary damage, shows the warning, and frames the coordinated collapse. These are repeatable test shortcuts, not required to play: drive with W/S, steer A/D, hold SPACE, and attack the columns yourself.
- Approach the falling tower to test the outward shove; clear the finished mound with the blade. **Reset tower** removes the old damage, particles, pile, and test rewards.

Optional `&controls=1` adds clickable driving buttons; `&perf=1` displays live performance counters.

The settled tower now has a dense core: driving toward the center progressively slows the dozer and stops it where the remaining pile is too dense. Track strain rises while pushing against it. Reverse to back out; work the blade along the edge and clear a chassis-wide path before crossing. The restriction follows remaining rubble, so a cleared corridor has no invisible barrier.
