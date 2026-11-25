# Monument assemblies

A `monument` building is a drawn figure standing on a destructible foundation. The foundation is an ordinary building of wall cells, at most three floors so it is simulated cell by cell, with a flat roof. The figure has no cells of its own: the dozer cannot chew it, only bring it down.

`monument` contains `figure`, `height` (world units above the roof, 2–48), `minimumSupport` (0–1), `warningDuration`, `fallDuration`, `bonus` and `color`, and optionally `fall` (`topple`, `crumble` or `roll`; absent topples) and, for a rolling figure, `reach` (4–80 world units; absent is twice the height). The validator rejects a monument on a building taller than three floors or one that is also a core-collapse tower, elevated tank, silo host, canopy or open deck.

The Statue of Liberty package (`src/world/landmarkData/liberty-statue/`) is the reference implementation: a star-fort ground floor, a pedestal and a plinth, in stone via `wallColor`, with the copper figure on top.

| Figure | Package | Fall |
| --- | --- | --- |
| `liberty` | `liberty-statue` | topple |
| `lattice-tower` | `paris-lattice-tower` | topple |
| `wheel` | `linq-observation-wheel` | topple |
| `sign` | `vegas-welcome-sign` | topple |
| `sphinx` | `luxor-sphinx` | crumble |
| `sphere` | `desert-orb-arena` | roll |

## Behaviour

- **Standing.** Each floor's wall cells are counted. The weakest floor governs: when its standing share drops below `minimumSupport` the statue goes. The dozer reaches only the ground floor, so in play that is the outer wall.
- **Warning.** The figure leans toward the centre of the lost cells and shudders for `warningDuration`. A rolling figure only rocks on its seat and a crumbling one only shudders.
- **Falling**, over `fallDuration`. What is left of the foundation stays standing.
  - *Topple.* It rotates from upright to flat toward the lost cells, its feet sliding off the plinth to the ground.
  - *Crumble.* It sags and spreads where it stands.
  - *Roll.* It drops off the plinth toward the lost cells and rolls `reach` units, fast at first and running out of speed. Once on the ground it flattens the props under it, breaks the ground-floor and first-floor walls of any other building in its way, loads the traffic it crosses, and runs the dozer down once (`applyMonumentRoll`).
- **Landing.** It breaks into plates of its own metal (rubble tinted with `color`) and pays `bonus` once. A toppled figure shatters along its length and strikes that line; a crumbled one lies in a ring round its plinth and a rolled one bursts where it stops, and both strike a circle. A dozer within the strike takes up to 22 engine heat and 26 track stress, full under the figure and fading to the edge, and is shoved clear: sideways from a line, straight out from a circle (`src/sim/monumentImpact.ts`).

The building counts as fully down only once the figure is gone.

## Adding a figure

Figures are drawn in `src/render/monument.ts` in the figure's own frame (side, front, up), so one set of panels serves standing, leaning, falling, sagging and rolling. The helpers are tapered rings (`tube`, `cap`), world-axis boxes for a figure that must face a street (`box`, `w`), and flat strips and polygons that face the camera (`ribbon`, `disc`). Add the id to `MONUMENT_FIGURES` in `src/structure/monument.ts` and to the validator's list in `src/world/archetypes.ts`, write its draw function, and list it in `FIGURES`.

Heights are drawn taller than widths: one unit of height covers as much screen as about 0.45 units across it. A flat shape that should look as wide as it is tall (the wheel, a disc) multiplies its side offsets by `FACE`. A ball is authored and spun as a true sphere of diameter `height`, then narrowed on the ground by `MONUMENT_BALL_GIRTH` (about 0.52), which is also the radius its roll sweeps.

A figure wider than its plinth, or one that Downtown fill would hide, needs `clear` (and `view`, toward the camera) on its pin in the [city plan](city-plans.md). A plinth that should read as stone rather than as a small building sets `windowStride: 0`: no window is authored or implied on any floor, and the door stays.

`window.__pd.snapshot()` reports each monument's phase beside its cell states.
