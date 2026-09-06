# PERMIT DENIED — usable assets

Shipped art under `assets/usable/`. Masters in `assets/src/` (not embedded).

## Files

| File | Role |
|---|---|
| `tileset.png` | 16×16 ground tiles (dirt, asphalt, …) |
| `sprites.png` + `sprites.json` | Dozer 16 facings, cruiser, boom/spark |
| `buildings.png` + `buildings.json` | Authored structure cells (roof/wall/edge/corner/door/window/crack/interior/rubble) + dust/frag/scar |
| `sfx/*.wav` | wreck / peel / burst |

## Contract with the sim

1. **Ground tiles draw the pad. Structure cells own collision.** Each building is a grid of independently destructible 16×16 cells in `internal/lot`. Do not stamp one generic building tile across an AABB.
2. **Rubble sprites match rubble AABBs** (2px inset). Visual fragments/dust do not collide.
3. **16 facings are draw-only.** Physics uses continuous heading. Blitting a facing frame: do not also `GeoM.Rotate`.
4. **Filter is nearest.** Logical screen 320×224.
5. **Do not repack `sprites.png`.** Slot-locked. New building art is regenerated with `go run ./cmd/genbuildings` into `buildings.png` only.

## Building frames

Prefixes: `wood_`, `brick_`, `conc_`. Suffixes: `wall`, `roof`, `edge`, `corner`, `door`, `window`, `interior`, `rubble`, plus `_crack` overlays. Shared: `glass_rubble`, `steel_rubble`, `dust_0..3`, `frag_*`, `scar_*`.
