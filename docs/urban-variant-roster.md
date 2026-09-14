# Urban variant roster

Eighteen independently owned building packages for City Borough and City Downtown. Each variant differs from its source and siblings in at least two of: footprint/massing, floor arrangement, entrance/storefront organization, roofline, facade rhythm, or interior layout. Recolor is not used as a distinction.

World footprints use the default `cellSize` of **1.15**. Occupied structural stories (`floors`) are the classification source: low-rise 1–4, mid-rise 5–12, high-rise 13–19, skyscraper 20+.

Heights stay near the validated Union Tower (24 stories). The widest proposed 28-story forms were not authored: room-count, grid-slot, and facade-readability limits favor compact 20–26 story towers. Needle office is the tallest at **26**. Residential skyscrapers omit authored stair voids: the engine allows at most 16 void rectangles and forbids combining voids with `coreCollapse`, so a 20+ story walk-up stair cannot be validated the way `apartment-tower` is.

Construction reuses existing presets (`concrete-bearing`, `brick-mixed-use`) and owned sibling layouts. No inheritance framework.

| ID | Family | Source | Floors | Cells | World ft | Distinguishing features | Levels | Approach |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| `walkup-block` | urban-apartment | apartment-tower | 6 | 5×8 | 5.75×9.20 | Narrow single-loaded slab; rear stair; offset door; chimney + parapet | Borough, Downtown | Section copy; 1 home + stair |
| `avenue-apartments` | urban-apartment | apartment-tower | 7 | 9×6 | 10.35×6.90 | Wide shallow bar; center-through stair/entrance; windowStride 3; civic theme | Borough, Downtown | Two homes flanking full-depth stair |
| `terrace-apartments` | urban-apartment | apartment-tower | 8 | 6×8 | 6.90×9.20 | Side-loaded stair; south door at stair; fire escape; chimney | Borough, Downtown | Side hall + one deep stack |
| `bakery-walkup` | mixed-use | bakery + apartment-tower | 5 | 6×7 | 6.90×8.05 | Bakery ground (awning, sign, glazing); 4 residential floors; offset shop door | Borough, Downtown | Shop + two homes + stair |
| `laundry-lofts` | mixed-use | laundromat + apartment-tower | 6 | 7×6 | 8.05×6.90 | Laundry ground; single wide loft plate above; windowStride 3 | Borough, Downtown | Shop + loft + stair |
| `market-apartments` | mixed-use | small-grocery + apartment-tower | 8 | 8×7 | 9.20×8.05 | Grocery ground (MARKET, dual glazing); two stacks; 7 apt floors | Borough, Downtown | Shop + dual homes + stair |
| `courtyard-midrise` | courtyard-apartment | courtyard-apartment | 7 | 9×9 | 10.35×10.35 | True U-plan court; 7 stories; south-court massing | Borough, Downtown | U sections + shared hall |
| `corner-apartments` | courtyard-apartment | courtyard-apartment | 8 | 8×8 | 9.20×9.20 | L-plan; corner hall/entrance; 8 stories | Borough, Downtown | South + east wings |
| `stepped-apartments` | courtyard-apartment | courtyard-apartment + stepped-office | 10 | 9×7 | 10.35×8.05 | 6-story bar + 4-story inset crown; through stair | Borough, Downtown | Base stacks + inset top |
| `office-slab-eight` | midrise-office | mid-rise-office-slab | 8 | 8×5 | 9.20×5.75 | Compact 8-story slab; shallower than source | Borough, Downtown | Single office volume |
| `office-stepped-ten` | midrise-office | stepped-office-block | 10 | 10×7 | 11.50×8.05 | Three setback tiers (4+3+3); windowStride 3 | Borough, Downtown | Base/middle/top offices |
| `office-compact-twelve` | midrise-office | twin-office-building | 12 | 6×6 | 6.90×6.90 | Square 12-story point tower; roof duct | Borough, Downtown | Single compact volume |
| `plaza-office-tower` | office-skyscraper | union-tower | 22 | 10×8 | 11.50×9.20 | 3-story full podium; 6×6 shaft; core collapse | Downtown | Podium + tower + mech |
| `needle-office` | office-skyscraper | union-tower | 26 | 8×7 | 9.20×8.05 | 2-story podium; 5×5 needle; tallest variant | Downtown | Slim core-collapse tower |
| `setback-office-tower` | office-skyscraper | union-tower + stepped-office | 24 | 10×8 | 11.50×9.20 | Four-tier setbacks ending in mech crown | Downtown | Base/mid/top/mech |
| `residence-tower` | residential-skyscraper | apartment-tower | 20 | 7×7 | 8.05×8.05 | Same two-home + rear hall plan, 20 stories | Downtown | Scaled tower access |
| `twin-residence` | residential-skyscraper | apartment-tower | 22 | 9×7 | 10.35×8.05 | Three studio stacks + rear hall; wider bar | Downtown | Triple-loaded plate |
| `crown-apartments` | residential-skyscraper | apartment-tower + union-tower | 24 | 8×8 | 9.20×9.20 | 3-story lobby podium; 6×6 dual-home shaft; mech crown; core collapse | Downtown | Podium + shaft + crown |

## Intended campaign use

- **City Borough ordinary pool:** mid-rise families only (the twelve 5–12 story variants plus kept originals such as `apartment-tower` and `mid-rise-office-slab`). No skyscrapers. `parking-garage` is the only explicit low-rise exception (`campaign.exception`, `maxRepeats: 1`).
- **City Downtown ordinary pool:** mid-rises plus the six skyscrapers. Skyscraper originals (`union-tower`) stay yard/catalog unless a compact variant is used.
- **Sandbox:** all eighteen have zero zone weights. Discovery is automatic. Original low-rise shops and houses remain in County–Suburb and Sandbox as before.

## Construction notes

- Shared presets only; each package owns its layouts.
- Core-collapse supports are authored per podium and stay off the facade.
- Stairs and floor voids are generated for residential/mixed-use circulation, matching apartment-tower practice.
- `campaign.family` is asset-owned metadata used for diversity caps. Missing family falls back to `traits.use[0]` or the building id.
