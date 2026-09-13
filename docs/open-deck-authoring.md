# Open parking decks

`openDecks.columns` defines 4–16 continuous occupied column positions for a building with 2–6 deck levels. The top level is an open parking slab; columns run only beneath it. Use a flat roof setting for schema compatibility; open decks generate no roof panels. The owned parking-garage package is the first example.

Each deck uses the lower level's complete column support set for the game's inexpensive controlled collapse. Columns have narrow collision boxes and normal concrete damage. No enclosed wall spans or corner stubs are generated. Low edge barriers follow their deck tiles; parking marks are non-colliding decoration.

Declare ramps as `stairs` entries with `kind: "ramp"`. The same room-containment, lower-slab, upper-opening and landing rules apply. Alternating ramp lanes allow each flight to retain its lower slab. Flights need both their lower slab and an upper landing; they break if either support is lost. Static ramps render as smooth wedges in both prop and interior contexts.

Driving remains the game's existing ground-space simulation. The garage provides ground-level approach and column demolition. Ramp fixtures are destructible obstacles, and upper decks are demolition targets; no upper-level driving is added.

The renderer orders this open assembly by deck before local painter depth, so a lower ramp cannot overpaint a solid upper slab. Floor visibility controls deck slabs, walls controls columns/barriers, contents controls ramps, and details controls parking marks. Each level is available through the existing capture floor views.
