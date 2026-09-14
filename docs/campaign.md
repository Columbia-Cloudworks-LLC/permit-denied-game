# Time Challenge campaign

Time Challenge is a seven-level demolition campaign on the same town. There is no second map, no unlock tree, and no between-run meta. Sandbox, the Asset Test Yard, captures, and development scenarios stay on their own paths.

Play: **Play → Time Challenge → Start Game**. Time Challenge does not ask for a site size. The county clock starts after **Begin Level**.

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

## Upgrades, retry, and advance

Cash milestones still pause the clock for one upgrade: stronger blade, more engine, or a faster powered push. Permit resubmission spends only the cash you can still spend this level, not the campaign total.

**LEVEL CLEARED** offers **Next Level**. Installed upgrades carry forward. Level cash resets; the campaign total does not.

Fail or quit the level and **Retry Level** (or **R**) rebuilds the same layout and seed and restores the upgrades you had when you entered the level. **N** does the same retry during a campaign; it does not roll a new lot.

Clear **Governor's Mansion** and the campaign is over (**COUNTY CLOSED**). **New Campaign** starts over from County.

## Levels

Density rises from County through City Downtown by tightening lots and setbacks, not only by adding buildings. City Borough and City Downtown also use **composition rules**: height-band quotas, variant caps, and mixed parcel classes so later maps read as urban instead of a dense village of one-story shops. Governor's Mansion is a smaller estate with a site-placed landmark. The exact mid-rise and skyscraper roster is in [urban-variant-roster](urban-variant-roster.md).

| # | Level | Landmark | Target | Clock | Buildings | Roads |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | County | County Sheriff's Office | $4,200 | 3:00 | 12 | County road |
| 2 | Village | Village Hall | $3,600 | 3:00 | 16 | Loop |
| 3 | Township | Township Hall | $4,500 | 3:15 | 22 | Crossroads |
| 4 | Suburb | District Police Station | $4,800 | 3:30 | 28 | Frontage |
| 5 | City Borough | Police Headquarters | $12,500 | 3:45 | 32 | T-junction |
| 6 | City Downtown | City Hall | $9,500 | 4:00 | 36 | Crossroads |
| 7 | Governor's Mansion | Governor's Mansion | $5,600 | 4:00 | 14 | Estate loop |

Settings live in `src/game/campaign.ts`. Level identity is not a Sandbox district size (`d10` / `d30` / `d100`).

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

Campaign placement is **opt-in**. Missing `campaign` metadata means the asset never appears in Time Challenge. Sandbox still uses `zones` weights. Landmarks keep all zoning weights at zero so they stay out of Sandbox districts.

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

Optional `family` groups visually related variants for diversity caps. Optional `exception` marks a deliberate low-rise that may appear in a city pool without counting as the default fabric (Borough/Downtown: `parking-garage` only). Missing `campaign` is still opt-out.

City composition is configured on the level in `src/game/campaign.ts`, not hoped-for from weights:

| Level | Ordinary buildings | Height rule | Variant / family caps |
| --- | ---: | --- | --- |
| City Borough | 31 | ≥80% mid-rise (5–12). No skyscrapers. | ≥6 IDs, none >20%, family ≤40% |
| City Downtown | 35 | ≥95% five stories or taller, ≥30% skyscrapers (20+) | ≥6 IDs, none >20%, family ≤40% |

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

### Checklist

1. Discover the package in the Asset Test Yard and demolish it there first. See [construction authoring](construction-authoring.md) and [asset test yard](asset-test-yard.md).
2. Add `campaign.levels` for the levels that should use it. Leave `zones` at zero until Sandbox should pick it too.
3. If it belongs to a site, give the site the same levels and make sure every member is eligible.
4. Run `npm test`. Campaign generation checks that every placed building and prop is eligible, that each level has exactly one landmark, and that available demolition value exceeds the dollar target.

## Direct links

Time Challenge still starts from the Play menu. Diagnostic links (`?sandbox=1`, `?yard=1`, `?job=brick`) do not enter the campaign. `?mode=challenge` skips the title and opens County’s briefing on the current seed.
