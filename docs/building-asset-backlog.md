# Building asset backlog

Status: implementation authorized for the full roster. See [implementation progress](building-asset-progress.md) and the [automated capture workflow](asset-capture-workflow.md) for current evidence and remaining work.

## Goal

Make the town recognizable through a wider range of building shapes, uses, interiors, and demolition experiences. The authorized scope is **60 new buildings, 12 assembled sites, and 24 supporting assets**, plus automatic catalog-wide screenshot generation. The milestones below describe implementation order, not a reduction in scope.

Every new building should differ from its closest existing neighbor in at least two meaningful ways: silhouette, footprint, floor arrangement, interior organization, or demolition approach. A new name or color alone does not count as a new building.

## Existing library

Inventory checked against the local building JSON packages, prop/fixture catalogs, construction documentation, and saved visual-verification screenshots. Screenshots are prior captures, not a new live playtest.

| Group | Existing building IDs | Coverage |
| --- | --- | --- |
| Residential | `cottage`, `ranch`, `colonial`, `porch-house`, `walkup` | Five small houses, one or two stories; the current walkup is a narrow two-story timber building. |
| Commercial | `storefront`, `corner-shop`, `rivertown`, `campus-office`, `union-tower` | Three two-story shops, a one-story operations office, and a 24-story podium tower. |
| Industrial and civic | `warehouse`, `steel-warehouse`, `civic`, `data-hall`, `logistics-hub` | Three-story works building, one-story steel workshop, three-story annex, data hall, and large logistics building with a two-story office. |
| Assembled sites | `edge-campus` | Two data halls, operations office, transformers, and HVAC. |

There are also 37 outdoor prop definitions and 13 interior-content definitions, totaling 50 catalog props. The 13 interior kinds are cabinet, counter, toilet, sofa, table, radiator, shelf, rack, pallet, fridge, bed, machine, and partition. These also have separate fixture contexts in the test yard.

Reuse the existing shed, grain bin, fuel pump, tractor, farm implement, hay bales, pallets, crates, HVAC, transformer, fences, cars, and street furniture where appropriate. In particular, the shed is already a prop; a new structural shed must offer an interior and building damage to justify a separate asset.

The current visual language uses simple isometric volumes, flat material colors, readable windows, and sparse detail. Prioritize recognizable rooflines, proportions, entrances, and large furnishings over tiny decorative geometry.

## Build paths

- **A — Package:** intended to use existing construction, roofs, facade themes, and fixture types. Exact geometry still needs validation. Specialized furnishings can follow later.
- **B — Detail work:** needs a new fixture, facade treatment, or attached detail to deliver the defining look; ordinary building damage should remain usable.
- **C — Capability work:** depends on geometry, support, or collision behavior the current packages do not express adequately. Scope separately before implementation.

Stories below are proposed ranges, not finalized dimensions. Residential/commercial/civic labels here describe content; they do not require new gameplay kinds or zoning enums.

## First milestone: 12 new buildings

Target: grow the building library from **15 to 27**, covering small timber structures, divided homes, recognizable businesses, rural buildings, and a mid-rise. Introduce them in the test yard first; district placement is a separate integration step.

| Order | Candidate | Why it belongs in the first batch |
| --- | --- | --- |
| 1 | B01 Detached garage | Small, approachable demolition target with a wide frontage and open interior. |
| 2 | B02 Side-by-side duplex | Two households and a central dividing wall create a different clearing pattern. |
| 3 | B21 Auto repair shop | Broad service bays, workshop fixtures, and a small office. |
| 4 | B31 Gable barn | A large timber building fills a missing rural silhouette. |
| 5 | B11 Roadside diner | Long, low commercial shape with counter and seating zones. |
| 6 | B22 Self-storage row | Repeated compartments give a sequence of small breaches. |
| 7 | B04 Rowhouse unit | A deep, narrow multi-floor building usable in assembled streets. |
| 8 | B12 Small grocery | Open retail aisles, a checkout zone, and back-room storage. |
| 9 | B32 Farm equipment shed | Broad metal shed contrasts with the timber barn. |
| 10 | B41 Permit office | A recognizable civic destination with reception and records rooms. |
| 11 | B06 Motel room block | Repeated bedrooms and bathrooms produce dense interior clearing. |
| 12 | B51 Mid-rise office slab | Fills the large height gap below Union Tower. |

All 12 have an A-path first version. Diner seating can use existing sofas/tables; auto repair equipment can use existing machines; office furniture can use tables, cabinets, and partitions. Their specialized detail assets are follow-on work.

## 60 building candidates

### Residential and lodging

| ID | Asset | Stories | Defining shape, interior, or demolition experience | Path |
| --- | --- | --- | --- | --- |
| B01 | Detached garage | 1 | Squat gable box, broad loading-style frontage, shelves and workbench. | A |
| B02 | Side-by-side duplex | 2 | Wide paired home, separate entrances, mirrored rooms and central partition. | A |
| B03 | Fourplex | 2 | Four compact homes around shared internal circulation; denser room clearing. | A |
| B04 | Rowhouse unit | 3 | Narrow, deep brick home, repeated bedroom floors and flat parapet roof. | A |
| B05 | Courtyard apartment | 3–4 | U-shaped occupied footprint with exposed inner walls and an open court. | A |
| B06 | Motel room block | 2 | Long flat-roof block of repeated sleeping/bathroom modules; no elevated exterior walkway in the first version. | A |
| B07 | Boarding house | 3 | Broad gabled home with many small bedrooms and shared dining space. | A |
| B08 | Single-wide manufactured home | 1 | Very long, narrow footprint; light interior partitions and clustered rooms. | A |
| B09 | Garden apartment block | 3 | Broad residential slab with stepped ends and repeated living units. | A |
| B10 | Stepped hillside-style house | 2 | Unequal-height wings on level ground; lower-wing roof exposed beside upper rooms. | A |

### Retail, food, and leisure

| ID | Asset | Stories | Defining shape, interior, or demolition experience | Path |
| --- | --- | --- | --- | --- |
| B11 | Roadside diner | 1 | Long low frontage, counter lane, seating rows, compact kitchen. | A |
| B12 | Small grocery | 1 | Wide shop floor, shelf aisles, checkout and rear stockroom. | A |
| B13 | Laundromat | 1 | Glazed-style frontage with recognizable washer/dryer rows and folding tables. | B |
| B14 | Hardware store | 2 | Deep brick shop, dense shelves downstairs and bulky stock upstairs. | A |
| B15 | Bakery | 1 | Small customer room, long preparation area and distinctive commercial oven. | B |
| B16 | Strip retail block | 1 | Three connected shop units with distinct partitions and door spacing. | A |
| B17 | Furniture showroom | 1 | Large open room full of existing beds, sofas, cabinets, and tables. | A |
| B18 | Neighborhood theater | 2 | Tall rear volume, low lobby, marquee and seat rows; auditorium seating is simplified to a flat floor. | B |
| B19 | Bowling alley | 1 | Very deep hall with lane markings, counters and pin-setting machinery. | B |
| B20 | Garden-center shop | 1 | Compact retail shell, stockroom and broad frontage; outdoor nursery belongs to its site. | A |

### Workshops, storage, and industry

| ID | Asset | Stories | Defining shape, interior, or demolition experience | Path |
| --- | --- | --- | --- | --- |
| B21 | Auto repair shop | 1 | Two broad service frontages, machine bays, parts racks and small office. | A |
| B22 | Self-storage row | 1 | Long shallow shell with many separately partitioned units and loading panels. | A |
| B23 | Contractor workshop | 2 | Broad work floor and narrower occupied upper office section; machinery below. | A |
| B24 | Cold-storage depot | 1 | Few windows, heavy service frontage, refrigeration equipment and storage lanes. | B |
| B25 | Textile mill | 4 | Long brick block with repeated windows and machine rows on each floor. | A |
| B26 | Printing works | 2 | Offset office/work volumes, press-like machinery and paper pallet lanes. | B |
| B27 | Recycling shed | 1 | Broad shed roof, sorting machines and partitions around stock zones. | A |
| B28 | Freight transfer depot | 1 | Long narrow hall with several south loading fronts and short cross-aisles. | A |
| B29 | Vehicle service depot | 2 | Wide ground workshop and smaller upper offices; no functional vehicle circulation required. | A |
| B30 | Sawtooth-roof factory | 1 | Repeating roof teeth create a distinctive industrial skyline. | C |

### Farm and rural buildings

| ID | Asset | Stories | Defining shape, interior, or demolition experience | Path |
| --- | --- | --- | --- | --- |
| B31 | Gable barn | 1 | Large timber gable, central aisle and divided storage areas. | A |
| B32 | Farm equipment shed | 1 | Wide metal shed roof with loading panels, machinery and clear work space. | A |
| B33 | Stable block | 1 | Long timber building divided into repeated empty stalls. | A |
| B34 | Dairy building | 1 | Low masonry building with washable floor and distinctive processing fixtures. | B |
| B35 | Feed store | 2 | Brick sales room, bag/pallet storage and upper stock floor. | A |
| B36 | Poultry house | 1 | Very long low timber building with repeated internal partitions; no animals required. | A |
| B37 | Orchard packing shed | 1 | Broad steel shell, sorting-machine lane and crate storage. | A |
| B38 | Farmhouse with rear wing | 2 | Broad main house stepping down to a single-story kitchen/storage wing. | A |
| B39 | Glass greenhouse | 1 | Transparent sloped panels and benches, with appropriately light breakage. | C |
| B40 | Grain elevator | 5–6 | Tall headhouse linked to cylindrical bins; requires silo geometry and authored support behavior. | C |

### Civic and neighborhood services

| ID | Asset | Stories | Defining shape, interior, or demolition experience | Path |
| --- | --- | --- | --- | --- |
| B41 | Permit office | 2 | Broad public counter, waiting area, back offices and dense records storage. | A |
| B42 | Post office | 1 | Low brick frontage, service counter, sorting room and rear storage. | A |
| B43 | Branch library | 2 | Reading room, repeated bookshelf aisles and smaller upper section. | A |
| B44 | Fire station | 2 | Wide garage frontage with narrower upper staff rooms and beds. | A |
| B45 | Neighborhood clinic | 1 | Reception, corridor and repeated small examination rooms; specialized fixtures follow later. | B |
| B46 | School classroom wing | 2 | Long masonry wing, repeated classrooms, storage and corridor partitions. | A |
| B47 | Community hall | 1 | Broad gable roof over a large furnished meeting room and service rooms. | A |
| B48 | Public works office | 2 | L-shaped office/records footprint with a low counter wing. | A |
| B49 | Telephone exchange | 3 | Compact, nearly windowless masonry block with heavy equipment racks. | A |
| B50 | Pump house | 1 | Small stout concrete utility building with dense machine interior. | A |

### Mid-rise buildings and landmarks

| ID | Asset | Stories | Defining shape, interior, or demolition experience | Path |
| --- | --- | --- | --- | --- |
| B51 | Mid-rise office slab | 6 | Broad rectangular office floors with partitions; ordinary construction first. | A |
| B52 | Stepped office block | 8 | Successively smaller occupied upper sections expose several roof terraces. | A |
| B53 | Apartment tower | 10–12 | Slender residential stack with repeated furnished apartments; evaluate core-collapse setup separately. | A |
| B54 | Hotel with podium | 8 | Wide lobby base, narrow room floors and a smaller service section. | A |
| B55 | Department store | 4 | Large floor plates, distinct retail zones and dense fixture clearing. | A |
| B56 | Civic records tower | 7 | Narrow-window vertical block with shelf-heavy archive floors. | A |
| B57 | Clock hall | 3–5 | Broad hall with a supported central clock section and visible clock faces. | B |
| B58 | Twin office buildings | 10 each | Two separately destructible tower packages arranged as a site; no bridge connecting them. | A |
| B59 | Parking garage | 4 | Open-sided decks, columns and ramps require support and driving decisions first. | C |
| B60 | Elevated water tower | — | Tank on exposed legs requires a distinct structure and controlled collapse design. | C |

## 12 assembled site candidates

Sites reuse the buildings above and the existing catalog. These count as arrangements, not additional unique building designs. Buildings within a site retain independent damage. Site placement does not automatically add roads, terrain dressing, or district generation.

| ID | Site | Main ingredients | Dependency |
| --- | --- | --- | --- |
| S01 | Suburban block | Existing houses, B01 garages, B02 duplex, fences and yard props. | First milestone |
| S02 | Rowhouse court | Repeated B04 units, shared rear clearance, bins and fences. | First milestone |
| S03 | Roadside motel | Two B06 blocks, small office, cars and vending machines. | First milestone |
| S04 | Main street | Existing shops, B11 diner, B14 hardware store and B42 post office. | Later buildings |
| S05 | Service station | Existing storefront and fuel pumps, B21 repair shop; canopy is optional later detail. | First milestone |
| S06 | Storage business | Repeated B22 rows, existing operations office and utility equipment. | First milestone |
| S07 | Farmstead | Existing house, B31 barn, B32 shed, existing grain bin, hay and tractor. | First milestone |
| S08 | Contractor yard | B23 workshop, B28 depot, pallet/crate stacks and parked equipment. | Later buildings |
| S09 | Civic block | B41 permit office, B43 library, B42 post office and frontage furniture. | Later buildings |
| S10 | School grounds | B46 classroom wings and B47 hall, fences and picnic tables. | Later buildings |
| S11 | Factory works | B25 mill, existing steel workshop, operations office and equipment. | Later buildings |
| S12 | Office pair plaza | Two B58 towers, existing campus office, planters and utility props. | Later buildings; performance check |

## 24 supporting assets

These are separate deliverables alongside the 60 buildings. New fixtures need rendering, registration and damage behavior; attached details need a clear owner and must disappear or fall appropriately when their support is lost.

| ID | Asset | First useful building/site | Scope |
| --- | --- | --- | --- |
| D01 | Roll-up service-door treatment | Garage, repair shop, storage row | Facade treatment; no opening animation required. |
| D02 | Business signboard | Diner, grocery, feed store | Reusable attached sign with fictional names. |
| D03 | Theater marquee | Theater | Attached canopy/sign geometry and support loss. |
| D04 | Shopfront display glazing | Grocery, bakery, laundromat | Distinct facade treatment using compatible damage materials. |
| D05 | Porch posts and railings | Existing houses, farmhouse | Extension of the existing porch treatment. |
| D06 | Dormer window | Boarding house, farmhouse | Roof geometry and damage integration; later capability work. |
| D07 | Exterior fire escape | Apartments, mill | Attached decorative structure with support loss; no traversal. |
| D08 | Roof exhaust duct | Diner, bakery, factory | Supported rooftop detail, reusing HVAC where sufficient. |
| D09 | Loading-dock bumper set | Freight depot, workshop | Small destructible frontage props. |
| D10 | Entry steps | Clinic, library, houses | Explicit collision treatment so decoration cannot unexpectedly block access. |
| D11 | Gas-station canopy | Service station | Supported structure; not a floating roof prop. |
| D12 | Clock-face detail | Clock hall | Reusable attached visual; no working clock required. |
| D13 | Diner booth | Diner | Distinct interior fixture. |
| D14 | Washer/dryer bank | Laundromat | Distinct metal fixture. |
| D15 | Commercial oven | Bakery, diner | Distinct metal fixture. |
| D16 | Office desk | Permit office, mid-rise | Distinct fixture, beyond the existing generic table. |
| D17 | Filing cabinet | Records tower, permit office | Distinct metal fixture, beyond the existing wood cabinet. |
| D18 | Checkout register station | Grocery, hardware store | Counter fixture variant with visible register. |
| D19 | Theater seat row | Theater | Repeated crushable fixture. |
| D20 | Repair-bay lift | Auto repair shop | Static destructible machinery; no operational lifting. |
| D21 | Refrigerated display case | Grocery, cold storage | Distinct fixture, beyond the existing fridge. |
| D22 | School desk cluster | Classroom wing | Sparse repeated fixtures within content budgets. |
| D23 | Examination table | Clinic | Distinct fixture. |
| D24 | Nursery bench with plant trays | Garden center, greenhouse | Destructible outdoor prop/interior fixture as needed. |

## Production boundaries and completion criteria

1. **Implement the complete authorized roster in batches.** The first milestone is the starting batch; retain the other entries until they meet their individual completion criteria.
2. **Author one complete building at a time.** Give it a stable ID, owned room layouts, deliberate materials, dimensions, entrances, roof and meaningful furnishings. Preserve existing shared presets unless a shared change is intended.
3. **Use explicitly supported capabilities.** Roofs include gable, flat, shed and authored sawtooth geometry. Dedicated canopy, open-deck, silo and elevated-tank assemblies have their own validation and controlled failure paths. Authored stairs and ramps are destructible furnishings with slab openings and support checks; they do not add multi-level driving. Section packages do not support arbitrary rotations or different construction per section. Rooms must use supported room kinds; descriptive uses do not automatically add simulation systems.
4. **Make demolition readable.** Check approach space, facade breach, exposed interior, support loss, roof/floor collapse, rubble clearing and restoration. Use ordinary timber/brick/steel/concrete behavior or explicitly authored existing core collapse. Do not promise independent wing collapse inside one coordinated core-collapse building.
5. **Keep additions in the yard initially.** Start with zero zoning weights. Verify district lot fit and distribution separately before enabling normal generation. Sites need their own integration decision.
6. **Validate each implementation batch.** Run package/regression checks and the production build; inspect intact, breached and settled states in the browser. Check fixtures on upper floors and restoration ownership. Measure large structures and multi-building sites during demolition, not just intact rendering.
7. **Budget by actual complexity.** Current package caps include 8,192 bounding grid slots, 256 expanded rooms and 512 content placements per building. Site caps include 16 buildings and 16,384 total grid slots. These are ceilings, not performance targets; tall buildings need sparse furnishings and economical footprints.

The first milestone is complete when its 12 buildings are individually recognizable in the test yard, furnished, destructible, restorable, and verified. The full authorized objective also includes the remaining buildings, all twelve assembled sites, all 24 supporting assets and catalog-wide screenshot automation. Enabling the additions in generated districts remains a separate integration decision.

## Local references

- [Construction authoring](construction-authoring.md)
- [Asset test yard](asset-test-yard.md)
- [Building packages](../src/world/data/buildings/)
- [Site packages](../src/world/data/sites/)
- [Outdoor prop catalog](../src/world/catalog.ts)
- [Interior contents](../src/world/contents.ts)
- [Building and fixture types](../src/structure/types.ts)
- [Saved visual verification](visual-verification/)
