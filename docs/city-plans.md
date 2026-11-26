# City plans

A city plan makes one region's Downtown county (County 6) a real place in miniature. The plan is authored geography: coastline, street grid, parks, and where each landmark stands. The town generator does everything else. It cuts lots along the plan's streets, fills them with the ordinary City Downtown buildings under the usual composition rules, and dresses them. The same county always builds the same city.

| Region | City | Plan | Landmarks |
| --- | --- | --- | --- |
| `US-IL` | Chicago | `src/world/cityPlans/chicago.ts` | Willis Tower (objective), Hancock Tower, Navy Pier, Field Museum, Shedd Aquarium, Adler Planetarium |
| `US-NE` | Omaha | `src/world/cityPlans/omaha.ts` | First National Tower (objective), WoodmenLife Tower, Union Station, Joslyn Art Museum, Saint Cecilia Cathedral, the Bob Kerrey Pedestrian Bridge, a riverfront grain elevator |
| `US-NV` | Las Vegas | `src/world/cityPlans/lasVegas.ts` | The Strat (objective), the Sphere, the Venetian, Caesars Palace, the Bellagio and its fountain lake, the Eiffel Tower, the High Roller, the Luxor pyramid and its sphinx, the Welcome sign |
| `US-NY` | New York City | `src/world/cityPlans/newYorkCity.ts` | Empire State Tower (objective), Chrysler Spire Tower, One World Tower, Flatiron Wedge, Statue of Liberty |
| `US-WA` | Seattle | `src/world/cityPlans/seattle.ts` | Space Needle (objective), Smith Tower, Pike Place Market, the Seattle Great Wheel, the Pacific Science Center arches, the Garden and Glass house, Colman Dock, the aquarium on Pier 59, Pier 54 |
| `US-WI` | Milwaukee | `src/world/cityPlans/milwaukee.ts` | Milwaukee Art Museum and its wings (objective), Saint Josaphat Basilica, Milwaukee Public Library, Brewers Stadium (an open ballpark on its own superblock, with a diamond and a fan roof), Pabst Theater |

Play one with `?mode=sandbox&region=US-NY&county=6` (or `mode=challenge`). Add `&nhood=1` to see lots coloured by urban band.

## What a plan holds

`CityPlan` is defined in `src/world/cityPlan.ts`. Coordinates are world units with the origin at the map's north-west corner: +x is east, +y is south.

| Field | Meaning |
| --- | --- |
| `width`, `depth` | Map size. Everything outside `land` is open water. |
| `land` | Rings of dry ground: the mainland or island, piers, causeways. |
| `water` | Rings cut back out of the land: rivers, ponds. |
| `ground` | Dry covers for the open land (`scrub`, `dirt`, `gravel`, `sand`), mixed in drifts with the middle of the list commonest. Absent is turf. With it set, only the parks are lawn. |
| `streets` | Straight streets. `axis: 'x'` runs east-west along `y = at`; `'y'` runs north-south along `x = at`. A node is made wherever two cross or one ends. A street that crosses water is a bridge. A street that reaches the map edge is a traffic exit; plans get no generated edge roads. |
| `parks` | Named lawns. No lot may overlap one. `trees` scatters trees over it, of the catalog asset `tree` (default `mature-tree`). `cover` makes it a plaza of that ground instead of lawn. |
| `landmarks` | Pinned buildings, by package id and north-west corner. The first is the county's objective; the others are tagged as signatures and pay the signature bonus. `clear` keeps ordinary lots that far from the footprint, for a drawn figure wider than its plinth. `view` keeps them that much further off on the camera side only (south and east), so fill does not stand in front of it. |
| `fountains` | Rows of jets on the plan's water. Drawn only. |
| `ballfields` | A baseball diamond painted on the ground as cover patches: a square with home plate in the `home` corner. It goes in the open middle of a ballpark package. |
| `rails` | Freight lines: a straight track along `y = at` or `x = at`, with `consists` of rail cars parked on it. See [Rail lines](#rail-lines). |
| `monorails` | Elevated beamways on pylons the dozer can break, each with a train parked on it. See [Monorails](#monorails). |
| `ferries` | Ferries moored on the plan's water, each lying along `axis` with its middle at (`x`, `y`). See [Ferries](#ferries). |
| `canopies` | A vaulted canopy over one stretch of a street. Drawn only: nothing collides with it, and it thins out over the dozer. |
| `cores` | Circles that are `downtown-core`. Roles fall off with distance from the nearest core, to `borough-edge` at worst. |
| `fillCount` | Ordinary buildings between the landmarks. |
| `dollarTarget`, `timeLimit` | Time Challenge target and clock for this county. |
| `block` | Nominal block size, for lot sizing. |

The county's level is City Downtown with the plan's objective, building count (`fillCount + 1`), target and clock (`regionalLevel` in `src/world/regionalPlacement.ts`). The county is named for the city on the atlas and the HUD.

## How generation uses it

In `generateRuralLayoutInner` (`src/world/rural.ts`), a plan replaces four steps and leaves the rest alone:

1. **Surface.** `paintSurfaceGrid` paints water and ground from the plan instead of generating ponds, woods and fields. The biome quota pass is skipped, so parks and vacant blocks stay as authored.
2. **Streets.** `buildPlanStreets` builds the plan's grid instead of a topology skeleton. Streets are never trimmed.
3. **Landmarks.** `placePlanLandmarks` stands each pinned building on a lot cut to its footprint, with a driveway from the nearest street, before any other lot exists.
4. **Lots.** `planLotPool` cuts frontage along every street, then drops lots that overlap a park or sit more than 8% over water. Roles come from the plan's cores.

Ordinary fill, composition checks, driveways, dressing, traffic and spawns are the generic code. So are the county's climate dressing and landforms: Nevada's Downtown resolves to the Mojave, so Las Vegas gets Joshua trees, creosote, boulders and the odd butte on its open ground with no help from the plan. If the fill cannot meet the Downtown composition rules the layout throws, as it does for any city level, so a plan must leave enough buildable frontage for its `fillCount`.

## Desert ground

A plan in a desert climate needs `ground`. Without it the plan's land is all `grass`: the renderer already draws turf as bare soil under a snowless desert climate, so the map would look dry, but the simulation would still call it lawn and the parks could never be green. With `ground` set, the open land is the listed covers and each park lawn is marked watered on the surface grid (`SurfaceGrid.irrigated`), which exempts it from the bare-soil rule and the soil wash. Las Vegas uses `['scrub', 'dirt', 'dirt', 'sand']`, a palm-planted golf course as its one lawn, and `gravel` plazas round the fountain lake and beside the Fremont canopy.

## Rail lines

A plan's `rails` lay a freight line on the ground: a gravel bed painted on the surface, ties and rails drawn over it (`render/cityDecor.ts`), and no lot within 1.7 units of the centre line. A street that crosses the line is a level crossing. Each consist lists vehicle ids (`freight-locomotive`, `boxcar`, `tank-car`) from the low end of the line up, starting at its `at`; keep consists clear of the crossings, which the city test checks. The town parks the cars when it is built (`placeRailCars` in `src/vehicle/rail.ts`).

A car on the rails rolls along its line and nothing else. Its flanges pull it back to the centre line, so a slow push from the side only leans on it. Pushed more than 0.42 units off the line (the dozer at about half speed or better) it derails: it is thrown clear at 6.5 units/s, lies over, pays a $100 bonus once, and drags off the cars coupled either side of it. A derailed car that slides into a wall at over 1.5 units/s breaks the ground-floor cells round the strike (`src/sim/railImpact.ts`), so a street of warehouses backing onto the line is worth the frontage. After that it is an ordinary heavy wreck. Tuning is `RAIL` in `src/vehicle/runtime.ts`; `src/vehicle/rail.test.ts` covers it.

## Monorails

A plan's `monorails` each run a concrete beam along `y = at` or `x = at`, 3.6 units up, from the first of its `pylons` to the last. Each pylon is a `monorail-pylon` prop, a solid the dozer has to grind through (70 hp). Author them down the middle of an arterial, at least 4 units from every cross street, and no more than 12 apart; off a street the line keeps lots 1.3 units clear either side. `train` parks a train of `monorail-car`s on the beam from `at` toward the high end.

Each beam rests on the pylon at either end. Break a pylon and both beams it carried let go: each hangs from the pylon it still has for a moment, then lands after 0.8 seconds. A landing beam pays $120, breaks into lengths of concrete rubble, flattens the props under it, loads the traffic it lands on, and strikes the dozer if it is underneath (the same heat and track stress as a landing monument, `src/sim/monumentImpact.ts`). A car whose middle was on that beam is pitched off the side away from the dozer (toward the camera when the dozer is dead under the line). It pays $400 and lands as a derailed rail car thrown at 15 units/s, so it slides across the avenue and breaks the ground-floor cells of the wall it hits, exactly as a derailed freight car does. Beams and cars either side of the gap stay up. State is `town.monorails`; tuning is `MONORAIL` in `src/sim/monorail.ts`, and drawing is `monorailPieces` in `render/cityDecor.ts`. Riding cars are drawn only: nothing collides with the beam or the train until they come down.

## Ferries

A plan's `ferries` float a `state-ferry` at each berth. A moored hull holds its berth: a slow push only leans on it and the lines haul it back. Pushed 0.4 units off the berth (a ram at about half speed), the lines part. It pays $500 once, leaves at 5.5 units/s or better in the direction it was pushed, and drifts with little drag. It stays on the water: when the side it is moving toward touches a shore at over 0.8 units/s it stops there, breaks every ground-floor cell within 3.4 units of that side of the hull and the props along it, throws up a line of spray, and rebounds a little. A drifting hull draws a wash astern and a bow wave. Nothing ashore moves a moored hull, and on a frozen bay it cannot be cast loose at all.

Berth a ferry with one rail half a unit over the edge of a pier the dozer can drive on, so the blade reaches it, and open water on its other side as far as the shore it should hit. Keep the water's edge on whole units: the surface grid is one unit square. Seattle moors one against the south side of three finger piers, 13 units across a slip from the next pier down, so a ferry rammed from Pier 59 takes the Great Wheel's plinth out from under it. Tuning is `FERRY` in `src/vehicle/runtime.ts`; the berth and grounding rules are `src/vehicle/ferry.ts`, the damage is `applyRailHits` (`src/sim/railImpact.ts`), and `src/world/seattle.test.ts` covers both mechanics on the real map.

The world has no elevation. Seattle's hills are likewise told by its low blocks north of Denny Way and east of 7th Avenue. Omaha's climb from the river to the cathedral is told by its bands of streets and what stands in them, not by height.

## Landmark packages

City landmarks are ordinary landmark packages in `src/world/landmarkData/`, loaded with the lazy overworld chunk (`landmarkPack.ts`). They are `landmarkOnly`, carry zero zone weights, and list `city-downtown` in `campaign.levels`. A package may set `wallColor` to give the whole building one wall colour in place of the regional paint (the statue's copper green, the Willis Tower's black steel). Tapered and stepped towers are stacked `sections`; a mast or spire is a one-cell section. A section marked `cantilever` may project past the floor below it (the Strat's pod); see [construction authoring](construction-authoring.md#flat-layouts-and-sections). Shapes that cells cannot make are [monuments](monument-authoring.md): a drawn figure on a destructible foundation that comes down when half the foundation's wall is gone. The Statue of Liberty, the Eiffel Tower, the High Roller, the Welcome sign, the Milwaukee Art Museum's wings, the Space Needle, the Great Wheel and the Science Center arches topple; the Bob Kerrey bridge's mast topples and its span then drops into the river pier by pier; the sphinx crumbles, and so does the fan roof of Brewers Stadium; the Sphere rolls.

Names are descriptive rather than trademarks where the real one is a brand (`willis-bundle-tower`, `one-world-tower`).

## Adding a city

1. Write the plan in `src/world/cityPlans/<city>.ts` and list it in `CITY_PLANS` (`cityPlans/index.ts`) under its region id.
2. Author its landmark packages in `src/world/landmarkData/<id>/` and pin them in the plan. Leave 0.6 units between a pinned footprint and the pavement.
3. Add the city's longitude and latitude to `src/world/cityPlanSites.ts`, then rebuild the atlas (`node scripts/build-atlas-data.mjs`) so the state sheet seeds County 6 at the real place.
4. Run `npx vitest run src/world/cityPlan.test.ts src/world/landmarkPack.test.ts src/world/atlas.test.ts`. The city test builds every planned county and checks that each landmark stands exactly where pinned, the fill is a legal Downtown mix, nothing stands in water, on a street or in a park, and the spawn can reach every street.
5. Play it. A map that reads half empty needs a higher `fillCount` or less land; a generation error naming the composition needs a lower one or more street frontage. Downtown fill runs to twenty floors and more, so a landmark hotel shorter than that disappears among it, and a drawn figure with fill on its south-east side is hidden from the camera: give it `clear`, and `view` if the fill is across a street.

One city per region, and only County 6. Counties 1 to 5 and the capitol are unchanged.
