# PERMIT DENIED

Top-down tank-steer dozer on a compact destruction sandbox. Smash authored buildings cell by cell. Rubble stays. One cruiser hunts after the first wreck. Sixty seconds on the clock.

Window title: **PERMIT DENIED**.

## Run

Requires Go 1.25+ and Ebitengine v2.9.

```powershell
go test ./...
go run ./cmd/permitdenied
```

Window starts at 1280×896 (4× a 320×224 logical screen). Resize is enabled; the sim stays 60 TPS.

## Build

**Local (Windows):** run `build.bat`. It runs tests, then writes `dist\permitdenied.exe` (console left on for debugging). Do not commit the exe.

```bat
build.bat
dist\permitdenied.exe
```

**CI:** GitHub Actions builds a GUI exe (`-H windowsgui`), uploads `permitdenied-windows-amd64` on push/PR, and attaches it to a GitHub Release on `v*` tags.

## Keys

| Key | Action |
|-----|--------|
| `A` / `D` | Tank-steer left / right (the machine’s left) |
| `W` / `S` | Forward / reverse |
| `Space` | Toggle blade |
| `R` | Restart sandbox instantly |
| `M` | Mute / unmute music |
| `F2` | Debug: cell solids vs sprite rects |

## The lot

One compact pad (400×288). You start already in the dozer.

- **Wood shed** (west) — planks, door, ridge roof
- **Brick storefront** (east) — glass windows, awning line, doorway
- **Concrete municipal** (north) — corners, steel doors, roof that collapses in a chain
- **One cruiser** (southeast) — parks until you wreck something, then hunts

Buildings are grids of independently destructible 16×16 cells. The blade bites only the overlapped cells. Roofs lose support and fall over about a second. Rubble collides and matches its sprite inset. Fragments, dust, flashes, hit-stop, and shake are juice; they do not collide.

## Tunables

All numbers live in `internal/game/const.go`. Lot footprints live in `internal/lot/lot.go`.

## Tests

Covered by `go test ./...`:

- Spawn in play, W north, A heading, local blade bite, R reset
- `TestForwardVector`, lot collapse timing, rubble AABB inset
- Draw smoke for the sandbox atlas

Regenerate building art:

```powershell
go run ./cmd/genbuildings
```
