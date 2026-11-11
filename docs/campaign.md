# Time Challenge campaign

Time Challenge is a seven-level demolition campaign on the same town generator. The overworld wraps those seven levels as the seven counties of each state, province, and territory. Each county is a seeded variant of its level, not a new map. Sandbox, the Asset Test Yard, captures, and development scenarios stay on their own paths.

Play: **Play → atlas (season keys) → state or province → Go → sheet (mode switch) → county → Go**. The county clock starts after **Begin Level**.

## Overworld and counties

There is no setup screen. **Play** (and, from the Home Yard, the pause menu's **Dispatch** and the lowboy ramp) opens the atlas directly. **Season** (Spring, Summer, Autumn, Winter) is four round keys in the atlas's title box, out in the ocean; it defaults to Summer. **Mode** is a two-way switch in the bottom-left margin of each state sheet: **Time Challenge**, the default, clears counties off the map and banks their cash, with the capitol locked until Counties 1–6 clear; **Sandbox** opens every county with no clock or breakdowns and marks nothing. Switching mode redraws the open sheet where it lies and keeps the picked county. The continental map's county stamps always show the Time Challenge record. On a paused run's own maps (World Map, State Map) the other season keys are disabled. The season applies to every county played from that map, including later counties reached by **Next Level**.

**Macro view.** A paper road atlas lies slightly askew on a desk. It slides in from the left folded in half with its other side up: a printed cover ("Official Road Atlas · North America" over a globe). The top half then swings across on the centre fold, so the cover turns away as the map's face comes round, and lands as the right half of the sheet. The paper's folds and wrinkles are a photographed sheet (see **Paper art** below). It shows all 63 regions: 50 US states and 13 Canadian provinces and territories (`US-IL`, `CA-ON`, `CA-YT`, …) with their real outlines, capitols, lakes, and major highways. Alaska sits in its natural place; Hawaii is inset at the lower left. Wheel or pinch zooms toward the pointer, drag pans, and the corner **+**, **−**, and **Reset View** buttons step the zoom, so small states like Rhode Island or Prince Edward Island are reachable by zooming in. A press that moves 5px or more is a pan and never changes the selection. Hovering (or focusing) a region lays a yellow highlighter swipe over it. One click selects a region: a red grease-pencil circle is scrawled around it, drawn on stroke by stroke (`scribbleCircle` in `src/render/overworldMap.ts`, seeded by the region so each keeps its own loop), and the bottom bar shows its seven county stamps (cleared, open, or locked) and **Go to *Region***. A double-click, or Enter on the selected region, opens it directly. The manifest is `src/world/regions.ts`.

**Micro view.** **Go** slides the region's atlas sheet in from the right, folded the other way with a plain title block on its back, and opens it leftward over the continental map, tilted the other way. The continental map which stays mounted and dimmed underneath with its left edge showing. The sheet splits the region into seven counties: a deterministic Voronoi tessellation clipped to the real outline, with County 7 seeded at the actual capitol (marked with a bullseye) and six more cells spread over the interior. The six cells are ranked by highway density (expressways count fully, secondary highways at 0.6, ties go to the cell nearer the capitol): the busiest becomes Downtown (6), then Suburban (4), Industrial (3), Main Street (5), Roadside (2), and the quietest Rural (1). County numbers keep their archetype, level, seed, and saved clears; only their place on the sheet follows the roads. The sheet pans and zooms like the macro view. Hover highlights a county and one click circles it in grease pencil, as on the macro view; a double-click on an open county deploys it. Once a county is picked, a dossier card pinned to the sheet's top-right corner shows its name and status, then icon rows for the objective or landmark, the dollar target and county clock in Time Challenge, the regional flavor, and buildings to watch for. The bottom bar shows the county's stamp, its Weather and Weather effects, and a short **Go to *Highway County*** (or **Go to *Springfield*** for the capitol). **Back** closes the sheet and keeps the macro zoom and selection. While the sheet is open, the continental map behind it is only dimmed paper: its title box, bar, and zoom buttons hide.

| County | Archetype | Level generator |
| ---: | --- | --- |
| 1 | Rural / Agricultural | `county` |
| 2 | Roadside / Highway | `village` |
| 3 | Industrial / Works | `township` |
| 4 | Suburban | `suburb` |
| 5 | Main Street / Town | `city-borough` |
| 6 | Downtown / Commercial | `city-downtown` |
| 7 | Capitol: Governor's Mansion | `governors-mansion` |

County 7 is named for the real capitol, for example *Springfield Capitol District — Governor's Mansion*. Each county's layout seed is `hashSeed("<region>#<index>")` (`src/world/counties.ts`), so the same county always builds the same town.

**Unlocks.** Sandbox opens every county. In Time Challenge, Counties 1–6 are open in any order and County 7 opens once all six are cleared. Clears are stored per browser under `permit-denied.county-progress.v1` (`src/game/countyProgress.ts`). Without storage they last for the page session. **Next Level** goes to the next uncleared county in the region, then the capitol. Clearing the capitol ends the run (**COUNTY CLOSED**). **New Campaign** restarts that region from County 1.

**Map from pause.** The pause menu has **State Map** (for an overworld county) and **World Map**. It has no New Game during a run: a run is replaced only by deploying another county from these maps, where the county card warns first. **State Map** skips the atlas's unfold: the atlas slides up from the bottom already open (`.atlas-macro.risen`, about a quarter second) and the state sheet unfolds over it a beat later (`.atlas-sheet.late`). **World Map** unfolds the atlas as usual. They open the map over the paused run: the clock stays stopped, the season and weather roll stay the run's, and the county you are playing is outlined in green and preselected. The bar offers **Resume *County***, and its dossier card **Restart County N** with the weather shown. Any other county's card warns that deploying ends the current run. Nothing changes until you deploy. Back and Esc step from state map to world map to the pause menu.

**Weather.** Weather is a county condition, separate from the season: Clear, Overcast, Rain (Snow in winter), Storm (Blizzard in winter), or Fog. Each county rolls a condition when the map opens, seeded from the map load and the county and weighted by season. The continental map never changes weather. Only the selected county on the state sheet can, from the bottom bar's Weather select or its cycle button, right before **Go**. The Weather effects setting (On, Reduced, Off) sits beside it in the same bar. Weather is presentation only: tint, particles, and a haze veil for fog and storms.

**Regional flavor.** `src/world/regionalCatalog.ts` maps each region to a flavor (Grain Belt, Great Lakes Works, Northeast Rowhouse, Southern Roadside, Southwest Travel Plaza, Mountain West, Pacific Coast, Northern Timber). A flavor sets the biome and multiplies the campaign weight of buildings the level already allows. County archetypes add their own boosts. A boost never makes an ineligible building eligible, so `campaign.levels` stays the opt-in gate. Up to two placed buildings per county are tagged as **regional signatures**, region picks first and then archetype picks. They pay an extra $600 on collapse, and the HUD calls them out on first hit and when they fall.

**Links and bundle.** `?region=US-IL&county=3` opens that county: its level, seed, and biome unless the link names them. `&weather=storm` sets the condition. The overworld (manifest, flavor data, map markup, pan/zoom) is a lazy chunk (`src/game/overworld.ts`). It loads when the pointer or focus reaches Play (or on the click itself), or when a link names a region. Legacy `?level=` and `?district=` links, the test yard, and job links do not load it. The atlas geometry is a separate static file, `public/atlas/north-america-atlas.json` (about 245 KB), fetched once when setup opens and precached by the service worker. If the fetch fails, the map falls back to a schematic grid of squares built from each region's `tile`.

**Rebuilding the atlas.** `node scripts/build-atlas-data.mjs` regenerates the JSON from public-domain Natural Earth v5.1.2 (1:50m admin-1, lakes and countries; 1:10m roads). Sources are pinned by SHA-256 and cached in `node_modules/.cache/natural-earth`, so the output is byte-for-byte reproducible. It projects with an Albers equal-area conic, stores coordinates to 0.1 unit as compact relative SVG paths, four-colors neighbors, and precomputes each region's label anchor, capitol point, and seven county cells (ranked by highway density) with `src/world/atlasGeometry.ts`.

**Compositor rule.** Nothing in the atlas stack uses CSS or SVG filters (`drop-shadow`, `blur`, `feTurbulence`), `mix-blend-mode`, or `will-change`. Over two stacked full-viewport SVGs they made Chromium's GPU compositor bleed tiles of the continental map through the state sheet. Paper grain, creases, the dim, the highlighter, and the grease-pencil circle are plain gradients and strokes; the paper relief is an `<image>` inside each map's SVG. The fold is a short-lived 3D flap (`transform` and `backface-visibility` only) that is removed when it lands.

**Leaving for a county.** Deploying (Go, a double-click, or Restart County) sweeps both maps off the desk and leaves a loading card (`.atlas-splash`: the county, mode, season and weather over crawling hazard tape) until the level takes over the screen. `AtlasView.depart` starts the level about half a second later, once the card has painted, because building the level can hold the page; the tape is a transform animation so it keeps moving meanwhile. While leaving, the maps ignore clicks and Back. If the level never takes over, the maps return after 20 seconds.

**Clearing progress.** The main menu has a small **Clear progress…** link, and nowhere else does. It opens a confirmation page that lists what is erased (every county clear, so the atlas is unmarked and capitols lock again; the career profile, so the wallet, Heavy Shop upgrades, attachments, liveries and range tiers go back to stock) and what is kept (sound and privacy settings). Nothing is erased until **Erase Everything**; **Keep My Progress**, Back and Escape all leave it untouched. `CountyProgress.clearAll` and `CareerStore.reset` do the work.

**One sheet under the camera.** The relief is the top layer of the map's SVG, in map units, so pan and zoom move the creases with the roads and borders; nothing textured is left fixed to the window for the map to slide under. For the same reason the map bleeds to the paper's edge, and the titles (the atlas's title box, a sheet's title strip) are boxes laid on top rather than margins. `AtlasView.fitPaper` stretches the relief over exactly what the unzoomed map shows, refits it when the window resizes, and turns it on its side on a tall window. Pan and zoom never leave that area, so no view reaches past the paper's edge. The relief's opacity eases off as the map zooms in (it follows `--label-scale`, down to a floor of 0.2), so a crease does not swell into a dark band across a county. The copy of the paper on a folding flap must match the real sheet to the pixel when it lands; its rule (`.atlas .atlas-flap .atlas-flap-front > .atlas-paper`) deliberately outranks every rule that positions a real sheet.

**The fold.** `AtlasView.unfold` (`src/render/atlasView.ts`) builds the flap: its back face is `coverHtml()`, its front face a throwaway copy of the paper stripped of ids, `data-*`, ARIA and tab stops, inert and hidden from assistive tech. While it swings, the real paper is clipped to the half that lies on the desk. The flap lands on `animationend` (or a 1.8 s fallback) and is removed, leaving one real sheet. Reduced motion skips it. Anything that queries the map right after it opens should wait for `.atlas-flap` to be gone, as the verify scripts do.

**Paper art.** `public/atlas/paper-atlas.webp`, `paper-sheet-a.webp` and `paper-sheet-b.webp` are shading overlays, translucent black for shadow and white for highlight, each derived from a different photograph of folded paper; `globe.webp` is the cover globe cut to a disc. The continental atlas uses the first. Every state and province picks one of the two sheet papers and one of four mirrorings from its region id (`sheetPaper` in `src/render/overworldMap.ts`), so opening another state unfolds a differently creased sheet, and the same state always unfolds the same one. `node scripts/build-atlas-paper.mjs <atlas-paper> <sheet-paper-a> <sheet-paper-b> <globe>` rebuilds all four from source images, which are not kept in the repository. The service worker precaches them with the atlas JSON. `scripts/verify-menu-usability.mjs` asserts this with the sheet open.

## How a level works

Each level has two objectives. Both must be done while the county clock still has time:

1. **Demolish the landmark.** Tear out 90% of the landmark’s original structural members and let roofs, floors, and falling cells settle. The HUD shows the landmark name and a percent; **DOWN** means the structure is finished.
2. **Earn the level dollar target.** Cash from this level only. Landmark payout alone is never enough; you have to work the surrounding lots.

Either order is fine. Completing one does not end the level.

The run ends if the clock hits zero (**COUNTY CLOCK**), the engine overheats (**ENGINE COOKED**), or track stress maxes out (**TRACK THROWN**). After the clock expires, finishing the objectives later does not count as a win.

A gold pin marks the landmark. If it is off-screen, a gold arrow on the rim points toward it.

## HUD

The top bar keeps cash wheels and the county clock. During a campaign it also shows:

- Level index and name (`1/7 County`)
- Dollars earned this level versus the level target (`DONE` when the dollar objective is met)
- Landmark name, demolition percent, and **DOWN** when the landmark is settled

On a phone the compact readouts show the same level/cash/landmark line. Pause still opens equipment, permit resubmission, and Debug.

## Retry and advance

The clock never pauses for upgrades; the Heavy Shop in the Home Yard is the only way to improve the dozer (see [Career, Home Yard, and the Heavy Shop](#career-home-yard-and-the-heavy-shop)). Permit resubmission spends only the cash you can still spend this level, not the campaign total.

**LEVEL CLEARED** offers **Next Level**. Level cash resets; the campaign total does not.

Fail or quit the level and **Retry Level** (or **R**) rebuilds the same layout and seed. **N** does the same retry during a campaign; it does not roll a new lot.

Clear **Governor's Mansion** and the campaign is over (**COUNTY CLOSED**). **New Campaign** starts over from County.

## Levels

Density rises from County through City Downtown by tightening lots and setbacks, then by placing buildings into **urban bands** derived from world-space geometry (distance to center, road class, corner/frontage). City Borough and City Downtown also use **composition rules**: height-band quotas, variant caps, street-wall parcels, and named plazas/parks so later maps read as urban fabric instead of leftover vacant blocks. Governor's Mansion is a smaller estate with a site-placed landmark. The exact mid-rise and skyscraper roster is in [urban-variant-roster](urban-variant-roster.md). The band model and numeric thresholds are in [city-map-fabric](city-map-fabric.md).

| # | Level | Landmark | Target | Clock | Buildings | Roads |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | County | County Sheriff's Office | $4,200 | 3:00 | 12 | County road |
| 2 | Village | Village Hall | $3,600 | 3:00 | 16 | Loop |
| 3 | Township | Township Hall | $4,500 | 3:15 | 22 | Crossroads |
| 4 | Suburb | District Police Station | $4,800 | 3:30 | 28 | Frontage |
| 5 | City Borough | Police Headquarters | $12,500 | 3:45 | 32 | T-junction |
| 6 | City Downtown | City Hall | $9,500 | 4:00 | 36 | Crossroads |
| 7 | Governor's Mansion | Governor's Mansion | $5,600 | 4:00 | 14 | Estate loop |

Settings live in `src/game/campaign.ts`. Sandbox and Time Challenge both play these seven levels through the same generator. A shared level and seed produce the same town. Sandbox leaves the clock, heat, and track failures off. Older `district=d10` / `d30` / `d100` links open County, Suburb, and City Downtown.

### Landmark roster

| Level | Building ID | Package |
| --- | --- | --- |
| County | `county-sheriff-office` | `src/world/data/buildings/civic/county-sheriff-office/` |
| Village | `village-hall` | `src/world/data/buildings/civic/village-hall/` |
| Township | `township-hall` | `src/world/data/buildings/civic/township-hall/` |
| Suburb | `district-police-station` | `src/world/data/buildings/civic/district-police-station/` |
| City Borough | `police-headquarters` | `src/world/data/buildings/civic/police-headquarters/` |
| City Downtown | `city-hall` | `src/world/data/buildings/civic/city-hall/` |
| Governor's Mansion | `governors-mansion` | `src/world/data/buildings/civic/governors-mansion/` |

The mansion sits in site `governors-estate` (`src/world/data/sites/neighborhoods/governors-estate/`). Gatehouse, admin wings, garage, and service buildings are estate dressing. Only `governors-mansion` counts toward the landmark objective.

Landmark demolition uses the same 90% settled rule as the brick job. Visual debris is garnish; rubble still collides.

## Adding a building, site, or prop to selected levels

Campaign placement is **opt-in**. Missing `campaign` metadata means the asset never appears on a campaign level, including Sandbox on that level. Landmarks keep all zoning weights at zero so they stay the marked objective.

### Buildings

Add a `campaign` object on the `*.building.json`:

```json
"campaign": {
  "levels": {
    "county": 3,
    "village": 2,
    "township": 1,
    "suburb": 2
  }
}
```

Weights are relative odds among eligible buildings on that level. Use only these level IDs: `county`, `village`, `township`, `suburb`, `city-borough`, `city-downtown`, `governors-mansion`. Invalid IDs or negative weights fail discovery.

Optional `family` groups visually related variants for diversity caps. Optional `exception` marks a deliberate low-rise that may appear in a city pool without counting as the default fabric (Borough/Downtown: `parking-garage` only). Optional `urbanBands` lists the map roles the building may occupy (`rural`, `village-main-street`, `suburban`, `borough-mixed`, `downtown-core`, `downtown-transition`, `service-industrial`, `estate`). Optional `streetRole` is `corner`, `run`, or `standard`. Missing `campaign` is still opt-out. Sandbox on a campaign level uses the same placement rules as Time Challenge.

City composition is configured on the level in `src/game/campaign.ts`, not hoped-for from weights:

| Level | Ordinary buildings | Height / band rule | Variant / family caps |
| --- | ---: | --- | --- |
| City Borough | 31 | ≥65% 2–8 stories, ≥45% mid-rise (5–12). No skyscrapers. Low-rise service only at the industrial-service edge. | ≥6 IDs, none >20%, family ≤40% |
| City Downtown | 35 | ≥70% four stories or taller, 22–45% skyscrapers (20+). Core has no one-story buildings. One-story shops/service only in transition, borough edge, or service edge. | ≥6 IDs, none >20%, family ≤40% |

Generation plans those slots, reserves larger lots for taller footprints, expands a lot when needed, and retries the seed a bounded number of times. If the map still cannot meet the rule, layout throws instead of filling with leftover bakeries.

Ranch, cottage, colonial, storefront, and the rest of the catalog already list the levels they belong on. Copy a nearby package’s `campaign` block when you add a new house or shop.

Landmarks also set `"landmarkOnly": true` and a weight on their own level only. Do not scatter a landmark into ordinary lots.

### Sites

Sites use the same `campaign` object. Every constituent building (unless the site is `landmarkOnly`) and every equipment prop must itself be eligible for those levels. A site cannot sneak an ineligible building onto County.

```json
"campaign": {
  "levels": { "village": 1, "township": 1 },
  "maxRepeats": 1
}
```

`maxRepeats` caps how many times that site may appear on one map. `governors-estate` is `landmarkOnly` and only listed on `governors-mansion`.

### Props

Yard props get campaign weights from the table in `src/world/catalog.ts` (`PROP_CAMPAIGN`). Generic street furniture is eligible on every level. Rural props (hay, tractor, trough, grain bin) stay on County, Village, and the estate. Add a new `AssetDef` to `ASSET_CATALOG` and a matching `PROP_CAMPAIGN` entry, or set `campaign` on the definition itself.

Optional `campaign.zones` further limits a prop or building to listed lot zones.

Lot dressing identity is resolved from the placed building (`src/world/lotUse.ts`). Fuel pumps only appear on a service profile (service-station canopy). Crop fields only attach to an agricultural profile (barns, farmhouses, grain, livestock). Ordinary houses, apartments, shops, and civic buildings do not inherit a random farm or fuel yard from their street index.


### Checklist

1. Discover the package in the Asset Test Yard and demolish it there first. See [construction authoring](construction-authoring.md) and [asset test yard](asset-test-yard.md).
2. Add `campaign.levels` for the levels that should use it and `campaign.urbanBands` for the map roles it may occupy. Leave `zones` at zero until Sandbox should pick it too.
3. If it belongs to a site, give the site the same levels and make sure every member is eligible.
4. Run `npm test`. Campaign generation checks eligibility, landmarks, urban-band fabric, and that available demolition value exceeds the dollar target.

## Career, Home Yard, and the Heavy Shop

Between county runs the dozer lives in the **Home Yard** (**Return to Yard** on results; **Home Yard** on the world or state map; **Bail Out to Yard** from pause; `?home=1`). It is the one hand-built lot, generated by `src/world/homeYard.ts` and loaded lazily with the Heavy Shop (`src/game/homeBase.ts`). It runs as a free sandbox with no clock, traffic, police, or pay.

| Zone | Trigger | What it does |
| --- | --- | --- |
| Heavy Shop apron (yellow) | Stop on it (< 0.75 m/s) | Opens the Heavy Shop overlay and washes off stage grime. **Roll Out** puts the dozer back on the yard, facing out, with purchases installed. |
| Proving ground lanes A–D | — | Respawning test targets: timber shed, masonry shop, concrete pump house, junked tractor-trailer and combine. Range tiers add a water tower + grain elevator lane and an eight-story office slab pad. Wrecks pay $0. |
| Reset pad (blue) / **T** | Drive over it | Rebuilds every lane the dozer is not standing in, with its debris, marks, and pile. |
| Lowboy ramp (orange) | Halt on it (< 1.5 m/s) | Unfolds the atlas to deploy a county. |
| Trophy lot | — | Fills with crushed cruisers (one per three counties cleared) and salvaged signs and caps as lifetime cash grows. |

**Escrow and settlement** (`settleRun` in `src/game/career.ts`). Run cash is escrow, already multiplied live by Salvage Magnetics and the combo. A run settles exactly once, however it ends:

- Time Challenge clear: escrow + $50 × seconds left, halved on a county cleared before; a first capitol (County 7) clear adds a $7,000 bounty.
- Time Challenge failure, restart, or bailout: 20% of escrow (halved on a replayed county).
- Sandbox: 25% of escrow when the run is left.
- The yard, test maps, the brick job, and replays never pay.

**Economy scale.** The design tables are written against a $25,000 standard county. Live counties pay about a fifth of that, so every price and bounty is the design figure × `ECONOMY_SCALE` (0.2): Drivetrain level 1 costs $2,000, the full core set $667,500, all Skunkworks Mk III $291,000. Cash targets and in-run values are unchanged.

**Core tracks** (levels 0–10): Twin-Turbo Drivetrain (top speed `max(stock, k × police cruise)`, k from 0.45 to 2.00, acceleration kept within 2.2 s), Ballast & Torque (pile and mass drag ignored, 22% to a 98% cap; solid walls still stop the hull), Hydraulic Overdrive (+12% turn and +4% blade width per level), Salvage Magnetics (1.12× to 2.50× cash; combo window 2–7 s adds 0.01× per 10 chained cells, up to +0.50×). Fixed steps faster than 0.45 of a cell per tick are split into sub-steps so the blade never skips a wall.

**Skunkworks** (opens at any track level 3; one blade slot, one aux slot): Shaped-Charge Blade (charges over 22/18/14 s, faster for each cell and vehicle wrecked; **Q** with the blade down arms a 4/5/6.5 s window of detonations every 0.40/0.35/0.28 s, radius 3.5/4.5/6 m), JATO Thrusters (2.5/2.85/3.2× cruiser speed for 1.5/2/2.5 s, five times the hit, 30% steering), Seismic Ripper (−15/10/5% speed, a trench, and pulses that pre-crack foundations to 35/50/70% within 5/7/9 m), Wrecking Harpoon (18/24/30 m cable at 400/800/1200 kN of tension that tears out the support it hits).

**Prestige.** Liveries (Hazard-Stripe, Black-Ops Matte, Polished Chrome, 24K Municipal Nightmare Gold) and three range tiers, the last paving the yard into a floodlit concrete depot.

The profile is stored per browser under `permit_denied_profile_v1`; a corrupt or foreign record starts clean. Recorded playthroughs keep the loadout they were recorded with, and ability presses are recorded actions, so a replay is unaffected by later purchases.

## Direct links

Time Challenge still starts from the Play menu. Diagnostic links (`?sandbox=1`, `?yard=1`, `?job=brick`) do not enter the campaign. `?mode=challenge` skips the title and opens County’s briefing on the current seed. `?mode=challenge&level=city-downtown&nhood=1` jumps to that level for map inspection.
