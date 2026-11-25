# City plans

A city plan makes one region's Downtown county (County 6) a real place in miniature. The plan is authored geography: coastline, street grid, parks, and where each landmark stands. The town generator does everything else. It cuts lots along the plan's streets, fills them with the ordinary City Downtown buildings under the usual composition rules, and dresses them. The same county always builds the same city.

| Region | City | Plan | Landmarks |
| --- | --- | --- | --- |
| `US-IL` | Chicago | `src/world/cityPlans/chicago.ts` | Willis Tower (objective), Hancock Tower, Navy Pier, Field Museum, Shedd Aquarium, Adler Planetarium |
| `US-NY` | New York City | `src/world/cityPlans/newYorkCity.ts` | Empire State Tower (objective), Chrysler Spire Tower, One World Tower, Flatiron Wedge, Statue of Liberty |

Play one with `?mode=sandbox&region=US-NY&county=6` (or `mode=challenge`). Add `&nhood=1` to see lots coloured by urban band.

## What a plan holds

`CityPlan` is defined in `src/world/cityPlan.ts`. Coordinates are world units with the origin at the map's north-west corner: +x is east, +y is south.

| Field | Meaning |
| --- | --- |
| `width`, `depth` | Map size. Everything outside `land` is open water. |
| `land` | Rings of dry ground: the mainland or island, piers, causeways. |
| `water` | Rings cut back out of the land: rivers, ponds. |
| `streets` | Straight streets. `axis: 'x'` runs east-west along `y = at`; `'y'` runs north-south along `x = at`. A node is made wherever two cross or one ends. A street that crosses water is a bridge. A street that reaches the map edge is a traffic exit; plans get no generated edge roads. |
| `parks` | Named lawns. No lot may overlap one. `trees` scatters trees over it. |
| `landmarks` | Pinned buildings, by package id and north-west corner. The first is the county's objective; the others are tagged as signatures and pay the signature bonus. |
| `cores` | Circles that are `downtown-core`. Roles fall off with distance from the nearest core, to `borough-edge` at worst. |
| `fillCount` | Ordinary buildings between the landmarks. |
| `dollarTarget`, `timeLimit` | Time Challenge target and clock for this county. |
| `block` | Nominal block size, for lot sizing. |

The county's level is City Downtown with the plan's objective, building count (`fillCount + 1`), target and clock (`regionalLevel` in `src/world/regionalPlacement.ts`). The county is named for the city on the atlas and the HUD.

## How generation uses it

In `generateRuralLayoutInner` (`src/world/rural.ts`), a plan replaces four steps and leaves the rest alone:

1. **Surface.** `paintSurfaceGrid` paints water and ground from the plan instead of generating ponds, woods and fields. The biome quota pass is skipped, so parks and vacant blocks stay green.
2. **Streets.** `buildPlanStreets` builds the plan's grid instead of a topology skeleton. Streets are never trimmed.
3. **Landmarks.** `placePlanLandmarks` stands each pinned building on a lot cut to its footprint, with a driveway from the nearest street, before any other lot exists.
4. **Lots.** `planLotPool` cuts frontage along every street, then drops lots that overlap a park or sit more than 8% over water. Roles come from the plan's cores.

Ordinary fill, composition checks, driveways, dressing, traffic and spawns are the generic code. If the fill cannot meet the Downtown composition rules the layout throws, as it does for any city level, so a plan must leave enough buildable frontage for its `fillCount`.

## Landmark packages

City landmarks are ordinary landmark packages in `src/world/landmarkData/`, loaded with the lazy overworld chunk (`landmarkPack.ts`). They are `landmarkOnly`, carry zero zone weights, and list `city-downtown` in `campaign.levels`. A package may set `wallColor` to give the whole building one wall colour in place of the regional paint (the statue's copper green, the Willis Tower's black steel). Tapered and stepped towers are stacked `sections`; a mast or spire is a one-cell section. The Statue of Liberty is a [monument](monument-authoring.md): a drawn copper figure on a destructible stone foundation that topples and shatters when half the fort wall is gone.

Names are descriptive rather than trademarks where the real one is a brand (`willis-bundle-tower`, `one-world-tower`).

## Adding a city

1. Write the plan in `src/world/cityPlans/<city>.ts` and list it in `CITY_PLANS` (`cityPlans/index.ts`) under its region id.
2. Author its landmark packages in `src/world/landmarkData/<id>/` and pin them in the plan. Leave 0.6 units between a pinned footprint and the pavement.
3. Add the city's longitude and latitude to `src/world/cityPlanSites.ts`, then rebuild the atlas (`node scripts/build-atlas-data.mjs`) so the state sheet seeds County 6 at the real place.
4. Run `npx vitest run src/world/cityPlan.test.ts src/world/landmarkPack.test.ts src/world/atlas.test.ts`. The city test builds every planned county and checks that each landmark stands exactly where pinned, the fill is a legal Downtown mix, nothing stands in water, on a street or in a park, and the spawn can reach every street.
5. Play it. A map that reads half empty needs a higher `fillCount` or less land; a generation error naming the composition needs a lower one or more street frontage.

One city per region, and only County 6. Counties 1 to 5 and the capitol are unchanged.
