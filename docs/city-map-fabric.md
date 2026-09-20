# Campaign urban fabric

Time Challenge maps share one town, but each level has a geography. Lots are classified from **world position and road/block context**, not from the order they are filled. The same seed always produces the same bands.

Sandbox districts keep their own zone weights. Campaign `urbanBands` never change Sandbox placement.

## Urban bands

Every campaign building lists `campaign.urbanBands`. A lot’s band is the first band of its district role.

| Band | Typical forms |
| --- | --- |
| `rural` | Farms, ranch houses, scattered civic |
| `village-main-street` | Shop row, hall, two-story storefronts |
| `suburban` | Houses, duplexes, corridor retail |
| `borough-mixed` | 2–8 story walk-ups, mixed-use, civic, rowhouses |
| `downtown-core` | 4+ story mid-rise and towers. No one-story |
| `downtown-transition` | Mid-rise plus selected 1–2 story shops |
| `service-industrial` | Garages, sheds, warehouses, pumps |
| `estate` | Governor's Mansion campus |

Optional `streetRole`: `corner` (corner shop / corner apartments), `run` (rowhouse or attached mixed-use), or omitted (`standard`).

## Level geography

Roles come from distance-to-center (normalized by the lot cluster), public road class, and whether the frontage sits on a junction.

| Level | Roles |
| --- | --- |
| County | `rural`, `scattered` |
| Village | `village-main-street`, `village-edge` |
| Township | `civic-center`, `mixed-neighborhood`, `township-edge` |
| Suburb | `suburb-neighborhood`, `commercial-corridor`, `suburb-edge` |
| City Borough | `borough-center`, `mixed-use-corridor`, `borough-neighborhood`, `industrial-service-edge` |
| City Downtown | `downtown-core`, `transition-ring`, `borough-edge`, `industrial-service-edge` |
| Governor's Mansion | `estate` |

Service roads always classify as `industrial-service-edge`. Large empty interior blocks on city maps are reserved as a named `park`, `plaza`, or `civic-square` instead of remaining accidental vacant lots.

## City thresholds

Ordinary = building count minus the landmark. Evaluated in `evaluateUrbanFabric` / `evaluateCampaignComposition`.

| Check | City Borough | City Downtown |
| --- | ---: | ---: |
| Buildings | 32 | 36 |
| 2–8 story share | ≥65% | — |
| 4+ story share | — | ≥70% |
| Mid-rise 5–12 | ≥45% | — |
| Skyscrapers 20+ | 0 | 22–45% |
| Core one-story | 0 | 0 |
| Core 4+ count | ≥2 | ≥4 |
| Core 8+ count | ≥1 | ≥3 |
| Core towers | 0 | ≤14 |
| Core 4+ share | ≥40% | ≥60% |
| Distinct variants | ≥6 | ≥6 |
| Single variant share | ≤20% | ≤20% |
| Family share | ≤40% | ≤40% |
| Mean frontage fill | ≥40% | ≥40% |
| Building / lot coverage | ≥18% | ≥20% |
| Unclassified vacant blocks | 0 | 0 |

Inspect a live map with `?mode=challenge&seed=19&level=city-downtown&nhood=1`. `window.__pd.urbanSnapshot()` prints band and role per lot (local dev, or production with `?debug=1`). `G` toggles the overlay; lots are colored by band.

## Adding a building to a band

1. Discover the package in the Asset Test Yard.
2. Set `campaign.levels` for the levels that may use it.
3. Set `campaign.urbanBands` to the roles it is allowed to occupy. Do not infer this from the file name or Sandbox `zones`.
4. Use `streetRole` only if generation should prefer a corner lot or an attached run.
5. Run `./node_modules/.bin/vitest run src/world/urbanGeography.test.ts src/world/campaignLayout.test.ts`.
