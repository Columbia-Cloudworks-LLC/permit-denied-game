# Traffic and police

Through traffic and police live in `src/vehicle/traffic.ts`. The session attaches a `TrafficState` to `town.traffic` after it builds the town (`Game.attachTraffic`). Test maps, the tower test, demos, the brick job, and headless sim tests get no traffic unless they create it.

## Edge roads

`src/world/edgeRoads.ts` runs at most one straight public road per side from the town out to the map bounds. It starts from the closest point on an existing public road whose run to the edge misses lots, buildings, open spaces and other roads. Rural and campaign layouts compute their bounds before adding edge roads, then keep those bounds. The estate does the same. Roadside dressing may sit on the shoulder but not in a public travel lane (`propInTravelLane` in `rural.ts`).

An exit is any public road end within 1.5 units of the bounds (`edgeExitNodes`). Each exit has one inbound and one outbound lane.

## Civilians

- **Density:** set per level in `DENSITY`: County 3, Village 4, Township 6, Suburb 7, City Borough 11, City Downtown 14, Governor's Mansion 3. About 60% of the cap is placed on lanes at the start; the rest enter from the edges.
- **Speed:** `CRUISE` by road class, scaled up from posted limits so a car outruns the 8.6 u/s dozer (residential 9.5, rural 12, arterial 12.5). Cars slow for bends ahead.
- **Routing:** Dijkstra over lane links. Costs are travel seconds plus penalties for U-turns, driveways, lanes blocked by rubble, wrecks or props (refreshed once a second), and lanes passing within 7 units of where the driver last saw the dozer.
- **Following:** the car checks the path ahead against every vehicle, the dozer and on-road props, and holds a stopping distance.
- **Junctions:** three or more roads meeting form a junction. Junction nodes within 6 units share one reservation. A car takes the junction when it is free and unoccupied, and otherwise stops short of it.
- **Deadlocks:** two stuck cars blocking each other resolve by having the newer one turn around (head-on) or back off. A car pressing forward without moving reverses briefly and replans.
- **Sight:** `SIGHT`: a 30-unit, ±55° cone from the front bumper. Standing ground- and first-floor cells block it (`sightBlocked`). Drivers look about five times a second and remember for 5 s.
- **Reaction:** when the remembered dozer is within 16 units, the car flees: 35% faster, rerouted away from the dozer. If the dozer still sits on the road ahead with no turn-off, the car three-point-turns: forward lock, reverse opposite lock, then away on the opposite lane. Civilians never leave the pavement; each turn phase ends early at the road edge.
- **Exit:** cars leave the map at an exit. A car stuck for 30 s far from the dozer is removed.

## Police

- **Dispatch:** Time Challenge only. The first cruiser comes 25 s in. City levels allow two at once, others one. A replacement arrives 14 s after one goes down. In Sandbox, **P** queues one cruiser, recorded as a replay action.
- **Pursuit:** police always know where the dozer is. They route at 16 u/s with light penalties and pass traffic by swerving around it. Within 9 units, or 22 with line of sight, they charge directly, off-road if needed.
- **Hits:** the cruiser's nose is tested against the dozer's full footprint, blade included. Any touch ends the charge and sends the cruiser back to reverse. A collision with more than 2 u/s closing speed counts as one hit, from the cruiser ramming, the dozer ramming, or the blade at speed. Three hits wreck the cruiser (`wreckAfterHits`) and pay its bounty.
- **Ram cost to the dozer:** heat `10 + 1.1·force` and track `7 + 0.8·force`, with force capped at 12. Both cool quickly, so one cruiser stings and two at once hurt. The dozer also takes a small velocity jolt.
- **Push resistance:** the dozer's push mass is `8 × engine × (blade down ? blade : 1) × (1 + 0.5·speed/max)` (`dozerPushMass` in `vehicle/world.ts`). It decides how much each side gives in any dozer-vehicle contact, so the 5-mass cruiser shoves harder than a 2-mass sedan unless the dozer is upgraded, blade down, or moving.

## Tests

`src/vehicle/traffic.test.ts` covers density by map, free flow through exits without traffic crashes, the sight cone and building occlusion, turning around for a dozer on the road, police pursuit and the three-hit wreck, and the sandbox request. `src/world/edgeRoads.test.ts` checks that every campaign level has at least two exits and that every entrance reaches another exit.
