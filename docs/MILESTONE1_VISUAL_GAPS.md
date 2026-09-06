# Visual gaps after milestone 1

Captured under `.cursor/skills/verify-permitdenied/artifacts/sandbox-4/` (intact / bitten / collapsing / destroyed).

## What reads in frames

- Three authored buildings with distinct wood / brick / concrete materials, doors, windows.
- Dozer 16-facing sprites, blade stance HUD, cash, clock, `R - AGAIN`.
- Cruiser present; hunts after first wreck (vehicle $ appears when flattened).
- Struct cash and rubble counts move with blade contact; restart clears the lot.
- Boom/spark bursts and dollar pops fire on breaks.

## Still visually incomplete

1. **SNES polish** — building tiles are generated palette stamps, not hand-authored late-SNES art; silhouettes work, but lack exaggerated animation and richer roof/awning detail.
2. **Dust / debris scale** — fragments and dust exist but read small on the 320×224 frame; need larger puffs and longer on-screen lifetime for the tile-swap cover story.
3. **Partial bite clarity** — local cell HP works, but a mid-bite still needs stronger crack overlays and a clearer “missing chunk” silhouette against intact neighbors.
4. **Collapse drama** — municipal roof chain reaction runs in sim (~1s hops); on-screen it needs staged falling roof frames (not only crack→rubble) and denser dust along the wave.
5. **Ground scars / detritus** — present in FX, but still thin against asphalt; want denser persistent piles after particles die.
6. **Layered SFX** — single wreck oneshot; glass / wood / concrete / steel layers not yet distinct WAVs.
7. **Dozer impact juice** — hit-stop and shake fire; want a brighter blade flash and track-skid scar when chewing.

Do **not** treat green tests alone as destruction-complete. Re-check these frames after the next art/FX pass.
