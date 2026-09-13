# Stair flights and independent homes

Layouts may declare `stairs` entries with lower room ID `a`, upper room ID `b`, and a normalized building-space rectangle `x`, `y`, `w`, `d`. Section packages declare these at the package level, using expanded room IDs such as `west-home/0/stair-hall`. Flat packages own them in their layout file.

Rooms must be on consecutive floors. The flight rectangle must fit both rooms, avoid their contents, have a supporting lower slab, and have an explicit `floorVoids` opening on the upper floor. Reserve landing space outside that opening. Buildings with floor openings retain their authored dimensions; runtime resizing is rejected.

When stairs are declared, connectivity is validated across the whole building from actual ground-floor entrances, through internal doors and stair flights. Every room must be reached. Missing links cannot be replaced by an assumed first room on an upper floor. Layouts without stairs retain the existing per-floor validation contract.

Each link generates a destructible wood staircase fixture, twelve steps high, supported by its lower floor and at least one intact upper landing tile. Flights ascend toward negative Y by default; `rotation: 90` ascends toward positive X. Reserve a solid upper landing immediately beyond the high end, outside the floor opening. They are static furnishings: the bulldozer still operates in ground space and does not acquire stair traversal. The fixture also has standalone and supported-host capture contexts.

The duplex has its own entrance and stair hall per home, a solid party wall, and upper slab openings. The motel uses a shared indoor corridor on both floors, private room doors and one shared flight. The corresponding `scripts/independent-duplex-recipe.mjs` and `scripts/motel-access-recipe.mjs` preserve these layouts during explicit authoring-helper regeneration.

An explicitly empty stair list still opts into whole-building access validation; it cannot silently fall back to per-floor checks. Section layout templates cannot declare stair links: their owning building package must use expanded room IDs. Other multi-floor asset access remains a separate authoring task.

The fourplex uses a central shared hall with four private living-room entrances. Courtyard and garden apartments use a shared rear corridor, inner wing corridors and two eastward stair flights in alternating corridor rows. Their rear wings contain three separately furnished homes per floor. `scripts/fourplex-access-recipe.mjs` and `scripts/apartment-circulation-recipe.mjs` preserve these arrangements. Keep private entrances on the corridor edge and retain open courtyard cells when adjusting the footprints.

The apartment tower uses two homes per floor with a two-cell-deep south hall. Eleven eastward flights alternate hall rows so the previous upper opening does not remove the next flight's lower support. The top level retains its solid landing. `scripts/tower-access-recipe.mjs` owns this arrangement.

The hotel has four private bedroom/bathroom suites on each of six guest floors. A central two-cell-deep hall connects their bedroom entrances. Seven alternating eastward flights connect the lobby, guest levels and narrower top service hall; linen-storage rooms open from the top hall. The lobby seating and reception counter leave the stair footprint clear. `scripts/hotel-access-recipe.mjs` preserves the layout without changing the podium or upper building envelopes.

The three-cell-wide rowhouse uses a two-cell-wide rear hall with flights in alternating columns. Each opening leaves the neighboring column clear, and both landings occupy the solid north row. Ground living/kitchen rooms become bedroom/wardrobe rooms upstairs. `scripts/rowhouse-access-recipe.mjs` preserves this plan within the existing envelope.

The boarding house uses a central two-cell-wide hall with alternating stair columns. Four private bedroom/bathroom units flank that hall on each upper floor; west-side rooms are mirrored so their bedroom edges meet the hall. Ground-floor seating and shared dining leave both stair lanes clear. `scripts/boarding-access-recipe.mjs` preserves the layout and original exterior envelope.
