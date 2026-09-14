# Building asset implementation progress

The full authorized objective remains **60 new buildings, 12 sites, 24 supporting assets, and automated capture coverage for every game asset**. The local implementation and capture deliverables are complete; the final accepted evidence is recorded at the end of this ledger and in [the completion audit](building-assets-completion-audit.md). Earlier checkpoints are historical.

## Current authored content

| Scope | Present in source | Remaining |
| --- | --- | --- |
| Building packages | All 60 B-series packages, the D11 canopy package, plus the original 15 | Implemented and verified; see final acceptance below. |
| Site packages | All 12 proposed arrangements, plus the existing edge campus | Site capture coverage and playable-yard checks passed. |
| Supporting assets | D13–D24 fixtures; D01–D08, D10, D12 mounted details; D09 dock bumper prop; D11 supported canopy | All 24 have registered implementations and verified capture contexts. |
| Capture tooling | Isolated scene, catalog/variant discovery, layers, floor views, fixed-step destruction, HTML galleries, state manifests, hashes, restoration checks, sharding and CI artifact coverage verification | Corrected 205-context coverage passed locally. Hosted CI remains unrun. |

All new buildings have zero zoning weights and are available through the test yard. Existing district selection is preserved. Generated packages are ordinary owned JSON layouts, not a runtime name/shape substitution mechanism. Authoring helpers in `scripts/author-*.mjs` are explicit opt-in utilities; builds do not run them, and existing packages are not overwritten by default.

An additional **urban variety** pass adds eighteen mid-rise and skyscraper variants for Time Challenge City Borough / City Downtown. They keep zero Sandbox zone weights. See [urban-variant-roster](urban-variant-roster.md) and [campaign](campaign.md).

## Remaining building and detail work

- **Multi-unit access:** storage, retail, duplex, motel, fourplex, garden/courtyard apartments, tower, hotel, rowhouse and boarding-house layouts now have deliberate entrances and circulation. Each revised residential package has targeted production captures and access checks; see the checkpoints below.
- Visual review checkpoints below cover silhouettes, interiors, furnishings, detail ownership and destruction. The final corrected gallery supplies the complete review artifact; the audit records the accepted evidence and practical limits.

The farmhouse rear wing was corrected from an early reused bakery recipe to a domestic kitchen. Future edits should update the authored package and, if retained as a reproducible helper, its blueprint together.

## Capture coverage and limits

The capture route uses the production renderer and simulation. It captures intact, layer-subtracted, layer-isolated, cutaway, support/collision/room overlays, every maximum-floor setting and damage frames through 900 fixed steps. An optional exhaustive mode covers all 4,096 combinations of the current twelve visibility layers. The final full-damage state is distinguished from the support-failure sequence. Rebuilding is checked against the original image hash within each run.

The initial complete run at `artifacts/catalog-verification/` covered **121 catalog contexts, 154 variants and 9,972 screenshots**, with no capture errors and complete hash/variant verification. That run includes the first 12 new buildings, all twelve new fixtures, and six new sites. It predates the remaining 43 conventional building packages and the last six sites.

The expanded run at `artifacts/catalog-expanded/` completed all four shards and passed `node scripts/verify-asset-captures.mjs artifacts/catalog-expanded`: **170 asset contexts, 203 variants, 13,331 screenshots, zero errors**. Every recorded PNG hash matched and every variant passed destruction and intact-image restoration checks. Open its combined `index.html` to review the expanded roster.

Still to extend or verify:

- All ten implemented mounted-detail kinds, including roof ducts and dormers, have discovered host contexts covered by the 205-context run.
- Floor images are cumulative up to a selected floor. Add isolated floor slices if needed for inspection of furnishings obscured by other floors.
- The screenshot workflow is authored for GitHub Actions but has only been exercised locally. No commit, push, or hosted CI execution has been performed.

## Verification

- Production TypeScript/Vite build passed for the expanded source.
- The initial 12-building checkpoint passed all 346 existing regression tests.
- Targeted construction, site, fixture, rendering and test-yard tests passed after the later batches.
- New expansion tests verify that all new buildings remain intact through 180 unattended structural steps and that the full baseline leaves an experiment-area allocation budget and stays within yard placement bounds.
- Four new capture-verifier tests cover successful catalog assembly, missing variants, tampered images and incomplete/filtered runs; all nine Node script tests passed.
- The expanded full regression run passed 431 of 432 tests; the long sandbox benchmark timed out while four screenshot jobs were running. Both benchmark tests passed when rerun after capture completed, without changing their timeout or assertions (the long test completed in 98.4 seconds). The two expansion tests were added afterward and both passed separately. That covers all 434 current regression cases across these runs.
- A normal browser session loaded all 170 yard contexts with no registry or browser errors; keyboard driving moved the bulldozer. Evidence: `artifacts/expanded-yard-playable.png` and the local smoke script alongside it.

No built output or screenshots are intended for Git. Runtime changes and source JSON remain uncommitted, as requested by repository policy.

## Specialized roofs and runtime vehicle checkpoint

- B30 now has repeating sawtooth roof planes, glass clerestories, end closures and support-linked panel collapse. Tests cover both orientations, stable intact supports and closure movement/removal during failure. Reviewed 65 images in `artifacts/sawtooth-factory/`.
- B39 now has a transparent glass gable roof, metal framing, translucent side panels and nursery benches. Glass panels have lower health than bearing columns; breaking a pane leaves the frame supported. Tests cover both roof orientations, panel damage and column-loss collapse. Reviewed 65 images in `artifacts/greenhouse/`.
- Added capture-only runtime contexts for both bulldozer blade positions and the moving road car. These use production driving simulation and a following camera. The new vehicles visibility layer controls both models. Their destruction folders explicitly document the absent damage mechanic; their motion folders contain five fixed-step frames.
- The vehicle runner checks motion, visibility toggles and exact intact-image restoration. The verifier accepts this exemption only for catalog-declared runtime vehicles with an explanation and final motion image. Five verifier tests passed, including rejection of missing explanations and exemptions assigned to buildings.
- That checkpoint's capture catalog had 174 contexts, 208 variants. The latest complete 170-context run above predates those four contexts and the extra visibility layer; it is historical evidence, not full coverage of the latest source.
- Production typecheck/build and 24 targeted roof, rendering and asset-stability regression tests passed at this checkpoint. Runtime vehicle captures passed for all three variants (96 images). Hosted CI remains unrun.

## Mounted detail checkpoint

- Added seven reusable facade detail kinds with explicit south/east mounting cells: roll-up shutter, lettered signboard, theater marquee, porch posts/rails, fire escape, shallow entry steps and clock face. Each follows its mounting wall's controlled failure and disappears when a required mount is gone. These are non-colliding attachments; entry steps preserve entrance access and fire escapes are decorative, not traversable.
- Added fictional bakery/diner signs, a STAR THEATER marquee, boarding-house escapes/porch, a farmhouse porch, repair-shop shutters and hall steps. Clock hall has two visible clock faces and a service-storage interior instead of repeated pump equipment.
- Added D09 as the destructible `loading-dock-bumpers` prop and placed a set at the contractor-yard depot. It uses the production prop collision, crush and debris paths.
- Authoring helpers retain these recipes on explicit regeneration. Production reads owned JSON files and never invokes the helpers.
- Added a details visibility layer and seven automatically discovered detail host contexts. Captures assert visible detail-layer differences and absence of floating details after full damage. Current catalog is 182 contexts / 216 variants; no complete latest-catalog run is claimed yet.
- Attachment support/failure tests, facade draw-order tests, compiler/site/catalog regressions passed (107 cases across the targeted runs). Screenshot review exposed wall sorting and low railing contrast; both were corrected before final visual verification.
- New evidence: `artifacts/facade-details-verified/` (seven contexts, 509 views) and `artifacts/loading-dock-bumpers-verified/` (67 views). Both passed destruction and intact-image restoration checks. Production typecheck and build passed.

## Elevated water tower checkpoint

- B60 uses an explicit `elevatedTank` assembly with four continuous, exposed metal legs. Its empty layout declares no enclosed rooms, slabs or ordinary roof panels. The tank has a cylindrical body, conical lid, bands, bracing and a service ladder.
- Column collision matches the narrow square legs. The overhead tank does not create a ground-level obstacle. Its controlled descent produces ordinary colliding metal debris when it lands.
- One lost leg leaves three supports; losing a second triggers a 0.6-second warning followed by a 2.4-second tilt/drop. The remaining frame is pulled down and tank panels enter the production debris path. No general-purpose rigid-body physics is added.
- Tests cover 600 intact steps, one-leg survival, second-leg failure, decreasing tank height, twelve tank debris panels, full cleanup, exposed column dimensions and rejection of unsupported footprints. The capture runner explicitly requires the tank to be gone after full damage.
- The initial 73-view capture passed. Visual review then corrected broad leg geometry/collision and rear bracing painting through the lid. The final 73-view run in `artifacts/elevated-water-tower-verified/` passed with zero errors and exact intact-image restoration; the corrected model was visually reviewed.
- Current capture catalog: 183 contexts / 217 variants. Full latest-catalog verification remains outstanding.

## Bowling alley furnishing checkpoint

- B19 now has six long wood lanes with gutters, foul lines and aiming marks; six pinsetter assemblies with ten pins each; a shoe-rental register counter, shelving and booth seating. The generic production machines were removed. Source layouts and the explicit authoring helper agree on these recipes.
- Added `bowling-lane` and `pinsetter` fixture definitions with useful standalone dimensions. Fixture rendering normalizes against those dimensions, preserving all existing unit-sized fixture models. Discovered fixture hosts now size themselves to fit the actual model and allocate the correct yard grid budget.
- Reviewed the alley cutaway, the standalone lane and the two-floor pinsetter context. Captures in `artifacts/bowling/` and `artifacts/pinsetter/` passed destruction and exact restoration checks. Together these contain 345 screenshots across five contexts.
- Production typecheck/build passed. Construction, catalog, interior rendering, expanded-roster and test-yard regression checks passed (117 distinct cases across the targeted runs), plus the two water-tower tests and four site tests.
- Current capture catalog: 187 contexts / 221 variants. The full current catalog and a hosted CI run are still not verified.

## Production equipment, glazing and theater checkpoint

- B26 now contains dedicated printing presses with feed/output stacks, repeated printing units and controls. B34 now contains processing vats and a bottle-filling conveyor. Their generic production-machine layouts were removed. Each new fixture is also discoverable as an outdoor model and a supported interior context.
- D04 is reusable `display-glazing` on the bakery and grocery. Panes use glass cladding HP and glass debris while retaining the host's bearing structure. A targeted test breaks the glass without reducing frame HP or destabilizing the roof. Its dedicated capture recipe breaks only the glass before structural damage.
- B18 now has one seating floor, a tall screen, a ticket/concession lobby and an empty upper auditorium volume. Explicit `floorVoids` remove the entire upper auditorium slab from drawing, fixture support and collapse mass, while retaining its roof envelope. There are no duplicated upper seats or reused mail-sorting rooms.
- Tall fixture contexts now reserve enough vertical room, using floor openings between display levels when necessary. Tests check actual model clearance rather than assuming every upper fixture fits at floor 1. Wider baseline yard rows preserve space for the existing large-batch experiment test as the catalog grows.
- Floor-opening tests verify missing physical tiles, retained roof coverage, rejection of furnishings placed over an opening and successful final cleanup. The shared floor index excludes voids; normal buildings retain their existing floor behavior.
- Current capture catalog: 196 contexts / 230 variants. Full current-catalog verification remains outstanding. Final evidence and full regression results follow once running checks complete.

### Verified follow-up

- The full regression run completed with 457 passing cases and one outdated interior expectation: it required furnished rooms in the intentionally open elevated water tower. The interior test now explicitly requires no rooms, fixtures or slabs for elevated tanks, while retaining the furnished-interior assertions for conventional buildings. All 83 interior, floor-opening and elevated-tank cases passed afterward. This covers the 458-case suite across the full run and targeted correction; a fresh single full green run is not claimed.
- Production TypeScript checking and the Vite build passed after the theater's full upper-auditorium opening was finalized.
- Fresh production captures passed: `artifacts/theater-volume-verified/` (71 images), `artifacts/display-glazing-verified/` (69 images), and `artifacts/printing-verified/` (209 images across the building, fixture host and standalone press). These runs include destruction and exact image restoration checks.
- Visually reviewed the revised theater cutaway, glazing host and standalone printing press. The theater now has an unobstructed seating floor and screen; the press has distinct white paper stacks. These targeted views do not replace full-gallery review or full current-catalog coverage.

## Independent ground-floor access checkpoint

- Ground-floor connectivity now starts from actual exterior entrance cells, using the same exposed-frontage resolver as runtime door placement. Each disconnected room group must have its own entrance; an interior-cell opening cannot satisfy access. Templates and upper floors retain their existing connected-plan requirement.
- B22 storage has four independently entered units with three full-depth partitions and no connecting doors. B16 retail has separate entrances for its three businesses, retains each shop's internal room doors, and removes cross-business doors. Both authoring helpers preserve these changes.
- Three new regression cases verify full storage partitions, loading entrances, rejection of a sealed unit and rejection of a purported entrance on an interior cell. The 104-case construction/package/expansion/access run passed; the 79-case interior suite passed before the subsequent retail data edit. Typecheck and production build passed.
- Production captures passed destruction/restoration checks: `artifacts/storage-access-verified/` and `artifacts/retail-access-verified/`, 69 images each. Reviewed storage furnishing layout and retail frontage. Multi-floor independent access and full-gallery validation remain open.

## Roof exhaust checkpoint

- D08 is a reusable flat-roof exhaust assembly, first placed over the diner kitchen. The duct follows the covering roof panel's production hinge, sag and drop, and is removed with that panel. It has no ground collision or separate HP. Validation rejects pitched roofs and multi-cell mounts.
- Discovery adds a dedicated roof-duct host context with all layer and destruction captures. The capture support targets are the roof panel's actual bearing cells.
- Initial visual review caught roof overpainting. The corrected renderer paints rooftop details after their roof surfaces, with a regression assertion for this ordering. The final model was visually reviewed in `artifacts/roof-duct-verified/`; all 69 images and destruction/restoration checks passed.
- Production typecheck/build and the initial 14 targeted detail/render/asset tests passed. The catalog now has one additional detail context (expected 197 contexts / 231 variants); a full latest-catalog capture is still outstanding.

## Dormer checkpoint

- D06 adds a window, cheeks, front gable and paired roof planes on the boarding house's pitched roof. Two instances use the original covering plane height and follow the owning roof's production hinge/drop. They disappear with the roof, with no separate collision or occupied attic room.
- The existing roof-detail registry discovers the dormer host automatically. Roof-type and span validation covers both dormers and exhaust ducts; 17 detail/render/stability regression cases passed. Typecheck and production build passed.
- The dormer gallery at `artifacts/dormer/` passed all 73 captures, including destruction and exact restoration. Visually reviewed both the host silhouette and isolated dormers. The complete building run at `artifacts/boarding-house-dormers/` also passed 73 captures; its intact model was reviewed with the existing porch and fire escapes visible.
- Expected current catalog: 198 contexts / 232 variants. Full current-catalog coverage remains outstanding.

## Service-station canopy checkpoint

- D11 is a structural open canopy with four narrow metal columns, a forecourt slab and a supported flat metal roof. Only the columns collide at ground level; normal column/roof destruction produces debris and fully clears the structure. It is registered as a building for yard and capture discovery, in addition to the 58 implemented B-series buildings.
- S05 now places the canopy over its four existing fuel pumps. Site validation checks column volumes and overhead clearance, rejecting both column collisions and equipment reaching the roof. The site authoring helper preserves the placement.
- Tests verify stable intact support, open center space, column collision dimensions, roof debris and complete collapse; invalid duplicate supports are rejected. New site tests reject pump-column and overhead collisions. The 170-case initial construction/interior/expansion run and subsequent 15-case canopy/site/interior-render run passed. Typecheck and production build passed.
- Visual review removed unintended corner wall stubs. Final capture output is `artifacts/service-station-canopy-verified/`, covering the standalone structure and assembled service station; the corrected open frame was reviewed. Full current-catalog verification remains outstanding (expected 199 contexts / 233 variants).

## Duplex stair access checkpoint

- Added explicit, bounded stair connections between consecutive floors. Validation requires room containment, furnishing clearance, a supporting lower slab and an upper slab opening. With stairs present, all rooms must be reachable through real exterior entrances, room doors and stair flights. Floor-opening dimension overrides are rejected.
- The duplex now has two separate stair halls with rendered, destructible flights and upper-floor openings. Doors through the party wall were removed. The common authoring recipe preserves both owned layouts and package connections.
- Added a reusable twelve-step staircase fixture, discovered in both standalone and supported-host contexts. This is static furnishing; ground-space bulldozer driving remains unchanged.
- Typecheck/build passed. The 87-case initial interior/access/expansion run and subsequent 121-case access/package/construction/yard run passed. Rejection tests cover missing stair access, missing entrances and upper slabs sealing stairs.
- Production captures passed: `artifacts/duplex-stairs/` (71 images) and `artifacts/staircase/` (142 images). Reviewed the ground-floor duplex cutaway and standalone flight. Motel and other multi-unit layouts remain open, along with B40/B59 and full current-catalog verification. Expected catalog: 201 contexts / 235 variants.

## Motel circulation checkpoint

- The motel now has a shared interior corridor on both floors, eight private bedroom entrances, and one shared stair flight with an upper slab opening. Cross-room doors were removed. The footprint grows from 12×4 to 12×7 cells while retaining clearance in S03 and the yard.
- Its authoring recipe preserves the corridor layout and package connections. The common authoring helper now writes added layouts as well as the original room templates.
- Tests verify that neighboring bedrooms have no connecting doors and that removing a room entrance or all stairs fails access validation. Explicit empty stair lists retain whole-building validation. Section-local stair declarations are rejected rather than silently ignored.
- The initial 29 access/site/expansion/yard cases and typecheck passed. The fresh complete regression run passed **all 473 tests in 57 files**, including the long simulation benchmark (127.4 seconds total). Production build passed afterward.
- `artifacts/motel-access-verified/` passed 142 images across the motel block and roadside-motel site, with destruction and exact restoration checks. The ground-floor cutaway was visually reviewed. This is targeted evidence; the full latest-catalog gallery still needs regeneration and review.

## Fourplex circulation checkpoint

- The fourplex now has a two-cell-wide central stair hall, one flight and an upper opening with a clear adjacent landing strip. Four private homes open from living rooms into the hall. West-side homes are mirrored so entrances do not lead into bathrooms. Cross-home door connections were removed.
- The footprint grows from 8×6 to 10×6 cells, preserving the original furnished home sizes. The shared authoring recipe updates both room orientation and building circulation.
- Typecheck/build passed. The initial 20 access/package/expansion cases and subsequent 23 access/yard cases passed. Tests verify four private living-room entrances, the staircase and landing strip, and rejection of a sealed upper home. The prior 473-test full run predates this data change and new test.
- `artifacts/fourplex-access-verified/` passed 71 production captures with destruction and exact restoration checks. Reviewed the ground-floor furnishing cutaway and roof-hidden upper-floor view, including the central stair and separate home partitions. Full latest-catalog verification remains outstanding.

## Parking garage checkpoint

- B59 has four open concrete decks, 24 bearing columns, three alternating sloped ramps and upper slab openings. The top deck remains open. Deck-edge barriers and parking marks belong to their slab tiles and descend with them. There are no enclosed perimeter walls.
- Added explicit `openDecks` frame authoring and a smooth wedge primitive shared by outdoor and interior models. The ramp is separately discovered in both capture contexts. Ground-space driving is retained: ramps are destructible ground obstacles, not a new multi-level vehicle system.
- Authored stairs and ramps now depend on their upper landing as well as their lower slab. This corrected a ground ramp surviving the loss of every upper deck. Validation requires solid upper landings. The complete ground-support-loss test verifies deck and ramp cleanup.
- Initial captures caught lower ramps painting through upper decks. Open-deck rendering now orders the building's levels so upper slabs occlude lower ramps while preserving their openings. The corrected model and standalone ramp were visually reviewed.
- Typecheck/build passed. The 92-case structure/interior/access/expansion run and subsequent 92-case renderer/interior/garage run passed. Final production captures passed destruction/restoration: `artifacts/parking-garage-verified/` (75 images), `artifacts/vehicle-ramp-verified/` (142 images).
- Expected catalog: 204 contexts / 238 variants. B40, remaining apartment circulation and full current-catalog verification remain open. The previous full 473-test suite predates these changes.

## Grain elevator checkpoint

- B40 combines a six-level concrete headhouse with two cylindrical metal bins, conical lids, corrugation and supported feed pipes. Each bin has eight independently damageable shell-support sectors and arc-bounded ground collision. Ordinary low roofs are excluded from the bin bases.
- Three failed sectors leave five supports standing; a fourth triggers that bin's controlled 2.4-second collapse and sixteen metal debris panels. The headhouse and neighboring bin remain intact in the independent-collapse test. Full damage clears both bins and the complete building.
- The production renderer exposes shells, lids and pipes through walls/roofs/details layers. Capture state includes silo phase/progress, and full-damage verification explicitly rejects surviving silos.
- Typecheck/build passed. The 84-case interior/expansion run and 18-case silo/yard run passed; the strengthened silo test also confirms headhouse survival. `artifacts/grain-elevator/` passed 79 captures with destruction and exact restoration; the intact model was visually reviewed.
- All 60 B-series buildings now have implementations. This does not complete the goal: apartment circulation review, complete latest-catalog capture/visual review, remaining regression gates and hosted CI verification after publication remain open. Expected catalog: 205 contexts / 239 variants.

## Courtyard and garden apartment circulation checkpoint

- Both apartment packages now have shared rear and inner-wing corridors, private home entrances and two eastward flights with alternating upper openings and solid landings. Rear wings are divided into three furnished homes per floor, avoiding oversized furnishings stretched across a single broad room. Garden wing studios include compact kitchen fixtures.
- Added explicit `rotation: 90` stair authoring and a shared landing-cell resolver used by validation and runtime fixture support. Rotated staircase box painting is sorted in projected depth so higher steps do not disappear behind lower steps. The authoring helper preserves the complete layouts and connections.
- Final capture manifests in `artifacts/garden-apartment-access-verified/` and `artifacts/courtyard-apartment-access-verified/` each contain 73 images, zero errors and successful exact-image restoration. Both ground-floor cutaways were visually reviewed after the furniture and stair corrections; the steps, separate rear homes and open courts are visible.
- Full regression and complete latest-catalog coverage are being refreshed. These targeted captures do not establish catalog-wide completion. Tall residential circulation still needs review.

## Complete regression and gallery verification checkpoint

- Fresh full regression passed all **484 tests in 59 files** in 126.34 seconds, including the accelerated 20-minute simulation benchmark. TypeScript checking and the production Vite build passed afterward.
- Coverage verification now requires every standard layer view, every declared floor view, all damage stages and all three views at each destruction frame. Runtime vehicle exemptions require the complete motion sequence. Exhaustive runs require all 4,096 layer combinations. Duplicate screenshot paths are rejected.
- Eleven verifier tests pass, including deliberate omissions of layer, floor, breach and intermediate destruction images. The CI coverage job runs these tests before validating downloaded galleries.
- A fresh four-shard full-catalog capture is the next coverage gate. Hosted workflow execution and remaining visual/access reviews are still outstanding.

## Apartment tower access checkpoint

- B53 now has two private furnished homes per floor and a shared stair hall across all twelve levels, retaining the 7×7 footprint and original outer silhouette. Eleven alternating eastward flights have upper openings and solid landings. All 24 home entrances lead from living rooms into the hall, without cross-home doors.
- `scripts/tower-access-recipe.mjs` preserves the owned layouts and package links. New tests reject both a severed middle flight and a sealed top-floor home, and verify support for every generated flight. All 110 targeted access/interior/roster/yard cases passed.
- The four full-catalog capture jobs in `artifacts/catalog-current/shard-1` through `shard-4` remain live against the pre-tower-change production build. Do not rebuild `dist` while these jobs are running. Their tower images do not verify this change; fresh tower build/capture and visual review remain required afterward.
- Reviewed the completed clock-hall model: both clock faces, stepped roofline and entrance steps are visible. Reviewed the hotel cutaway; its repeated large bedroom floors still need private-room and shared circulation improvements.

## Hotel circulation checkpoint

- B54 now contains four separately entered bedroom/bathroom suites on each of six guest floors, for 24 guest rooms. Central corridors connect all bedroom entrances. Seven alternating flights connect the furnished lobby through the guest floors to the narrower top service floor, where two linen-storage rooms open onto the hall.
- The original podium and upper envelopes are retained. Lobby seating, a side table and a reception counter leave the stair rectangle clear. `scripts/hotel-access-recipe.mjs` preserves the new sections, furnishings, doors, stairs and slab openings.
- All 95 targeted access/interior/roster cases passed. New checks verify support for all seven flights and reject a sealed guest room or disconnected top service floor.
- Full-catalog capture continues against the earlier production build; at the intermediate checkpoint, completed per-variant manifests covered 119 variants and 8,441 images with successful restoration. Both tower and hotel changes require a fresh build and targeted visual/destruction capture after these jobs finish. Boarding-house and rowhouse vertical access reviews remain open.

## Rowhouse circulation checkpoint

- B04 retains its 3×7 footprint and three-story exterior. A two-cell-wide hall contains two alternating northward flights, with a clear adjacent lane and solid top landing on each upper level. Ground rooms contain living seating, a kitchen and bathroom; upper floors contain bedrooms, wardrobes and bathrooms.
- `scripts/rowhouse-access-recipe.mjs` preserves the owned ground/upper layouts and package connections. Tests verify both flights, clear landing lanes and rejection of a disconnected top floor. All 101 targeted access/interior/roster/site cases passed.
- Reviewed the current capture run's school-classroom-wing and strip-retail-block intact models. Their silhouettes and frontages are readable; this does not replace cutaway or destruction review.
- Full-catalog capture still uses the pre-tower/hotel/rowhouse build. These three revised assets and the rowhouse-court site require refreshed captures after the live jobs finish. Boarding-house circulation remains open.

## Full catalog capture result

- All four full-catalog shards exited successfully. The stricter combined verifier passed **205 asset contexts, 239 variants and 16,582 screenshots, with zero errors**, including mandatory layers, floor views, damage timelines, image hashes and exact restoration. The reviewable catalog is `artifacts/catalog-current/index.html`; its machine-readable result is `verification.json`.
- This full run predates the tower, hotel and rowhouse circulation edits. Typechecking and a fresh production build passed after those edits. Targeted replacement captures are running in `artifacts/apartment-tower-stairs-verified`, `artifacts/hotel-podium-stairs-verified` and `artifacts/rowhouse-stairs-verified` (including the rowhouse-court site).
- Catalog-wide capture coverage is now proven for that build, but complete visual review, the revised residential captures and remaining boarding-house circulation are not yet complete. Hosted CI execution remains unverified.

### Revised residential capture follow-up

- All replacement runs exited successfully: apartment tower 91 images, hotel 83 images, rowhouse and rowhouse-court site 146 images. These 320 captures passed destruction and exact restoration checks on the fresh production build.
- Visually reviewed tower and rowhouse ground-floor cutaways and the hotel's first guest-floor cutaway. Furnishings fit the private rooms, stair flights are visible and the hotel landing/opening is readable. The tower's fixed full-height camera leaves its ground cutaway relatively small; a future floor-detail framing option would improve review without replacing the consistent comparison camera.
- No capture jobs remain live from this checkpoint. Boarding-house circulation, remaining catalog visual review and final integrated regression/coverage evidence remain open.

## Boarding-house circulation checkpoint

- B07 now has eight private bedroom/bathroom units across two upper floors, mirrored west-side bedrooms opening into the central hall, and two alternating stair flights from the shared ground-floor commons. Seating and a dining table leave the stair footprint clear. The porch, fire escapes, dormers and 8×7 exterior envelope are retained.
- `scripts/boarding-access-recipe.mjs` preserves the owned layouts and connections. All 97 targeted access/interior/roster cases passed, as did TypeScript checking and the production build.
- `artifacts/boarding-house-access-verified/` completed 73 production captures with destruction and exact restoration checks. The first upper-floor cutaway was visually reviewed, showing the four private rooms, shared hall, stairs and slab opening.
- A fresh full regression run is in progress. The complete catalog still needs integrated evidence for the latest residential revisions and remaining visual review; hosted CI remains unrun.
- Additional intact-model review covered public-works-office, post-office and permit-office in the complete gallery. Their roof envelopes, exposed lower wings and facade entrances render consistently. Eleven capture-verifier tests and the tracked diff whitespace check passed.
- Fresh integrated regression passed **488 tests in 59 files** in 121.77 seconds, including the accelerated 20-minute benchmark. A complete four-shard refresh is starting in `artifacts/catalog-final/` from the boarding-house production build, incorporating all residential revisions. Keep that build unchanged while capture runs.

## Explicit backlog coverage gate

- Added a regression gate requiring exactly one of every B01–B60 code and a yard context for each building, all twelve named sites with yard contexts, and all 24 supporting assets through their registered detail hosts, prop, canopy or standalone/supported fixture contexts. Removing a roster entry can no longer silently reduce the stability test's scope.
- All four asset-expansion tests passed (two new coverage gates plus the existing stability and yard-budget checks). These test-only changes do not alter the frozen production build used by the live final capture jobs.
- Reviewed the bakery's sign/glazing intact model, the auto-repair-shop frame-90 collapse view, and the bowling-alley cutaway. The sign and glazing are visible, the repair roof has dropped into debris, and the six bowling lanes, pins and front furnishings are readable. These are representative checks within the larger ongoing review.

## Capture isolation correction

- Reviewed cold-storage and department-store interiors and the grain elevator's frame-180/final destruction views. The interiors were readable, but the grain-elevator images exposed the simulation-helper bulldozer above the cleared structure after stepping. Therefore `catalog-final` cannot yet be treated as final visual evidence despite its ongoing state checks.
- Non-runtime capture contexts now explicitly disable the moving-vehicles render layer. The runner asserts that condition in every non-vehicle screenshot. Runtime-vehicle contexts retain their normal visibility and motion coverage. Normal gameplay is unchanged.
- Added `--preview-dir` so a separately built directory can verify fixes without overwriting a build being served to ongoing capture jobs. The isolation build in `artifacts/isolation-build` passed, as did TypeScript checking. A targeted grain-elevator verification is running from that build in `artifacts/grain-elevator-isolated`.
- The targeted run finished successfully: 79 views, zero errors and exact restoration. Reviewed intact and final destruction images: the bins/headhouse remain visible intact, the rubble and foundation remain after collapse, and the stray bulldozer is absent. Full catalog recapture from this corrected build is still required after the older jobs finish.
- The combined verifier now independently requires `vehicles: false` in every non-runtime screenshot's recorded debug state. Thirteen verifier tests pass, including rejection of enabled vehicles and missing isolation evidence. Earlier galleries do not satisfy this stricter gate.
- Current normal-game smoke verification loaded all **193 yard entries** with zero registry/browser errors and confirmed keyboard bulldozer movement. Evidence: `artifacts/current-yard-playable.png` and `artifacts/verify-current-yard.mjs`. The ten mounted-detail hosts and two runtime-vehicle contexts bring the capture-only total to 205.
- All older `catalog-final` jobs have exited successfully, but their images predate the isolation fix and intentionally fail the new isolation gate. Replacement jobs are now running in `artifacts/catalog-isolated/shard-1` through `shard-4`, serving the unchanged `artifacts/isolation-build` directory. Review the farmstead and school-ground site layouts in the older run for assembly spacing; final image acceptance still depends on the corrected run.
- Additional corrected-run visual review covered dairy machinery and refrigeration, the library's ground-floor shelves/reading tables, the contractor workshop's stepped envelope, and the apartment tower's frame-90 progressive collapse. The non-runtime views contain no helper vehicle. The backlog's capability notes now describe the implemented assemblies and preserve the full 60/12/24 scope rather than the obsolete first-milestone scope.
- Reviewed fire-station ground equipment/storage, farmhouse domestic rear-wing furnishings, and community-hall tables/storage in the prior integrated gallery. These unchanged interior arrangements are readable. The requirement-by-requirement [completion audit](building-assets-completion-audit.md) distinguishes existing evidence from the pending corrected full-catalog gate and unrun hosted CI.
- Corrected-run destruction review covered sawtooth-factory at frame 60, parking-garage at frame 180, and the greenhouse's initial breach. The factory roof panels have descended, garage upper decks/ramps have cleared, and greenhouse frame/panes remain readable around the breached frontage. No helper vehicle appears in these views.
- Corrected fixture-host review covered theater screens and bowling lanes in the contents-only layer, showing both display levels clearly; opaque model views intentionally retain their host buildings. The commercial-oven host's frame-90 view shows its collapsed support structure. Standalone prop contexts remain available for unobstructed individual models.

## Final local acceptance

- All 60 building packages, twelve sites and 24 supporting assets are implemented and registered. Explicit roster gates pass, alongside the 488-test full regression and the two later coverage gates. TypeScript checking and the production isolation build passed.
- All four corrected capture shards exited successfully. `node scripts/verify-asset-captures.mjs artifacts/catalog-isolated` passed: **205 contexts / 239 variants / 16,582 screenshots / zero errors**. Required views, hashes, restoration and vehicle isolation were checked across the complete output.
- Reviewed final roof-duct and clock-face isolated views and dormer cleanup, in addition to the structural/interior/fixture reviews above. The final gallery is `artifacts/catalog-isolated/index.html`; `verification.json` contains its machine-readable result.
- Thirteen capture-verifier tests passed again. The current yard smoke test confirms 193 playable entries, no registry/browser errors, and working keyboard driving.
- The local requested deliverables are complete. The GitHub Actions workflow is authored and uses the verified commands; hosted execution remains unclaimed because no changes have been committed or pushed. Generated images/builds remain ignored. Normal district rollout and multi-level vehicle traversal were not added.
