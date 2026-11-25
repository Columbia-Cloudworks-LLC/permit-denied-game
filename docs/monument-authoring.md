# Monument assemblies

A `monument` building is a statue standing on a destructible foundation. The foundation is an ordinary building of wall cells, at most three floors so it is simulated cell by cell, with a flat roof. The statue is one drawn figure with no cells of its own: the dozer cannot chew it, only bring it down.

`monument` contains `figure`, `height` (world units above the roof, 2–24), `minimumSupport` (0–1), `warningDuration`, `fallDuration`, `bonus` and `color`. The validator rejects a monument on a building taller than three floors or one that is also a core-collapse tower, elevated tank, silo host, canopy or open deck.

The Statue of Liberty package (`src/world/landmarkData/liberty-statue/`) is the reference implementation: a star-fort ground floor, a pedestal and a plinth, in stone via `wallColor`, with the copper figure on top.

## Behaviour

- **Standing.** Each floor's wall cells are counted. The weakest floor governs: when its standing share drops below `minimumSupport` the statue goes. The dozer reaches only the ground floor, so in play that is the outer wall.
- **Warning.** The statue leans toward the centre of the lost cells and shudders for `warningDuration`.
- **Falling.** It rotates from upright to flat over `fallDuration` in that direction, its feet sliding off the plinth to the ground. What is left of the foundation stays standing.
- **Landing.** It shatters along its length into plates of its own metal (rubble tinted with `color`), pays `bonus` once, and strikes the line it lands on. A dozer within the strike takes up to 22 engine heat and 26 track stress, full under the figure and fading to the edge, and is shoved sideways (`src/sim/monumentImpact.ts`).

The building counts as fully down only once the statue is gone.

## Adding a figure

Figures are drawn in `src/render/monument.ts` as stacks of tapered rings in the statue's own frame (side, front, up), so one set of panels serves standing, leaning and falling. Add the id to `MONUMENT_FIGURES` in `src/structure/monument.ts` and to the validator's list in `src/world/archetypes.ts`, write its draw function, and dispatch on `figure` in `monumentCommands`.

`window.__pd.snapshot()` reports each monument's phase beside its cell states.
