# Lab destruction

The destruction laboratory is a brick municipal on the sandbox lot. F4 from play enters it. Blade-down OBB bites open cells; rubble spills; roofs collapse on a delay with impact-direction bias.

## Sub-features

- `lab-enter` F4 from play → scene `lab`, BLADE DOWN on the south pose.
- `lab-south-ram` hold W into the municipal → open_cells or spill_count rises.
- `lab-reset` is covered by unit tests (`R`); control scripts re-enter via a fresh drive.

## How to get to it (user POV)

- From play, press **F4**.
- Face the brick building with blade down and drive into a wall.
- Press **R** in-lab to reset; **1–4** for south/north/east/west poses; **F2** for contact debug.

## Driving it with control-permitdenied

Preconditions:

- Doctor is green.
- Fresh drive from play.

- **Enter lab.** Run `drive --out <out> .cursor/skills/verify-permitdenied/scripts/lab-enter.script`. After F4, `lab.json` has `scene=lab` and `blade=down`.
- **South ram.** Run `lab-south-ram.script`. After holding W, `open_cells > 0` or `spill_count > 0`.

## Gotchas

- Lab disables heat cook; you will not reach ENGINE COOKED here.
- Four-direction ruin proofs are covered by `TestLabFourPosesDeterministic` in `go test` — scripts only smoke the live Draw path.
