# Modular vehicles

The vehicle proving yard contains twelve configurations with two paint variants each:
sedan (`car`), hatchback, pickup, panel van, box truck, bus, tractor, combine,
forklift, tracked skid steer, tracked excavator, and tractor with farm trailer.

Open `?yard=1`, then **Debug → Assets → Category: vehicle**. Choose a vehicle and
use **Jump to baseline** or **View whole example**. The proving controls provide
route driving, park/stop, camera following, a staggered fleet demonstration,
damage/attachment overlays, directional impacts, and a falling overhead load.
The player continues to operate the bulldozer. Arms and forks are destructible
travel assemblies, not controllable working tools.

## Authoring

Definitions are discovered recursively from `src/world/data/vehicles/**/*.vehicle.json`.
Each source chooses a family/body assembly, dimensions, mass, reward, two paints,
speed and steering configuration. `src/vehicle/definitions.ts` expands these into
validated parts: shape, placement, parent attachment, role, material appearance,
mass share, strength, mount strength and deformation limit. Existing families can
be reused with new proportions and parameters; a genuinely different construction
requires adding an assembly recipe. Renderers and simulation do not branch on
vehicle IDs.

The registry rejects duplicate vehicle and part IDs, invalid dimensions/movement,
bad attachment references, cycles, inconsistent mass totals and more than sixteen
damage regions. New definitions appear automatically in the picker and capture
catalog. New vehicle types are yard-only until explicitly added to district
placement rules. Existing car and tractor IDs migrate into vehicle instances;
their models scale to the original reserved footprint. Their existing cash
rewards are retained.

## Runtime and integration

- `VehicleDefinition` is immutable authoring data; `VehicleState` contains motion,
  damage, attachments, route state, ownership and operational/disabled/wreck state.
- `Town.vehicles` owns all vehicle simulation. `Town.roadCar` is a compatibility
  reference for the existing road-demo and camera controls, not another simulation.
- `createVehicle`, `hitVehicle`, `stepVehicle`, `partPose` and `stepVehicleWorld`
  are the main entry points. Contact batches carry position/height, direction,
  impulse or sustained load, duration and source identity. Repeated samples from
  one source are reduced to the strongest contact before damage is applied.
- Damage acts locally, transfers reduced load to parent assemblies, and persists.
  Engine/running-gear failure disables propulsion; structural failure pays the
  reward once and leaves the chassis in the world. Wheel/track damage also reduces
  speed, steering authority and traction.
- Attached parts have no independent physics. Detached parents carry their still
  attached descendants; existing detached children remain separate. Assembly mass
  is partitioned by attachment ancestry without adding duplicate debris mass.
- Wheeled, rear-steered and differential-steered controllers share route following.
  The trailer uses a bounded articulated hitch. Obstacle recovery stops after three
  attempts. Road routes include a connected approach from the current position;
  damaged vehicles are not projected back onto a lane.
- Collision uses world-space oriented boxes and height intervals, a cached static
  index and a dynamic vehicle index. Motion substeps are bounded. Sources include
  the dozer/blade, vehicles, solids, moving debris, explosions and aggregate
  structural-collapse loads. This is controlled game physics, not a soft-body or
  general rigid-body solver.
- At most six detached assemblies per vehicle are integrated, sharing the existing
  active-debris budget. Overflow settles into sleeping, persistent collision. Wrecks
  retain their shape and can wake when hit. Detached parts stay owned by their
  source bay after leaving it; restoring that bay removes its entire old instance.

## Verification

Use the local Node entry points on Windows:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build --configLoader runner
node scripts/capture-assets.mjs --filter=vehicle: --output=artifacts/vehicle-catalog-final
node scripts/verify-asset-captures.mjs artifacts/vehicle-catalog-final --vehicles
node --test scripts/catalog.test.mjs
node scripts/verify-catalog.mjs
```

Browser verification uses the development server because the test harness imports
the production TypeScript modules through Vite:

```powershell
node node_modules/vite/bin/vite.js --configLoader runner --host 127.0.0.1 --port 5178
$env:VEHICLE_TEST_URL='http://127.0.0.1:5178'
node scripts/verify-vehicles.mjs
$env:MOBILE_TEST_URL='http://127.0.0.1:5178'
node scripts/verify-mobile.mjs artifacts/vehicle-mobile
```

Vehicle tests cover locality, rotated contacts, sample deduplication, gentle
pushing, sustained damage, inherited attachments and conserved mass, disabled
propulsion, one-time rewards, all twelve route controllers, towing, sleeping and
active-body limits, height separation, direct collisions, blocked routes, overhead
loads, bay restoration and a 120-wreck/12-active scene. The full suite also runs
the existing accelerated twenty-minute simulation benchmark.

The capture catalog records all paints, four headings, front/side/rear/overhead
contact sequences, travel, settling and pushing a wreck. Damage comes through
the production contact function rather than assigning health to zero. Each record
includes state and image hashes, and verifies deterministic intact restoration.
Catalog series expose the new vehicle sequences alongside existing asset studies.

The browser report at `artifacts/vehicle-verification/report.json` records the
test machine, browser, desktop/mobile controls, simulation and render submission
timings, body counts and heap usage over repeated restoration. Render submission
timing is not an end-to-end GPU frame-time measurement. Mobile tests emulate input
and viewport geometry; they do not establish physical-phone performance.

Generated screenshots, reports and build output stay in ignored artifact folders.
No commit or deployment is part of this implementation.
