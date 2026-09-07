package lot

// Cell destruction: each 16×16 section has its own HP and solid AABB.
// Ground supports (walls/corners/doors) collide. Elevated deck (roof/edge)
// is visual + structural mass only until it falls into rubble.
// Visual debris is garnish; rubble collides and matches its sprite inset.

const Tile = 16

// StoryLiftPx is the per-story upward draw offset for elevated decks.
// Large enough that a 2-story hall clearly out-tops the 1-story shed.
const StoryLiftPx = 12

// Support thresholds use alive-anchor counts (each deck cell binds 3 nearest supports).
const (
	SupportReach       = 2 // retained for debug overlays
	CollapseScoreMin   = 1.5 // need ≥2 alive anchors
	SagScoreMin        = 2.5 // 2 anchors → sag; 3 → intact
	FallSpeedPerTick   = 0.7
	CollapseHopDelay   = 6
	CollapseHopPerDist = 4
)

type CellState int

const (
	Intact CellState = iota
	Cracked
	Broken // brief dust window before rubble
	Rubble
	Empty // approach space / never authored
)

type Material int

const (
	MatWood Material = iota
	MatBrick
	MatConcrete
	MatGlass
	MatSteel
)

type CellKind int

const (
	KindNone CellKind = iota
	KindWall
	KindRoof
	KindEdge
	KindCorner
	KindDoor
	KindWindow
	KindInterior
)

type Cell struct {
	Kind  CellKind
	Mat   Material
	HP    float64
	MaxHP float64
	State CellState
	// CollapseIn > 0: ticks until this deck cell begins falling.
	CollapseIn int
	// DustLeft covers the tile swap for a few ticks after Broken.
	DustLeft int
	Tile     string // buildings.png frame while standing
	Rubble   string // buildings.png frame once rubble
	Value    int    // cash when this cell becomes rubble
	Paid     bool   // destruction cash awarded exactly once

	// Elevated deck motion (pixels). Sag while weak; FallY while collapsing.
	Sag   float64
	FallY float64
	// Falling is true once support has failed and the mass is descending.
	Falling bool
}

func (c *Cell) Present() bool {
	return c.Kind != KindNone && c.State != Empty
}

// IsDeck reports elevated structural mass (roof / eave).
func (c *Cell) IsDeck() bool {
	if c == nil || !c.Present() {
		return false
	}
	return c.Kind == KindRoof || c.Kind == KindEdge
}

// IsSupport reports ground-floor load-bearing structure.
// Windows/glass are cosmetic openings — not columns.
func (c *Cell) IsSupport() bool {
	if c == nil || !c.Present() {
		return false
	}
	if c.State == Rubble || c.State == Broken || c.State == Empty {
		return false
	}
	switch c.Kind {
	case KindWall, KindCorner, KindDoor:
		return true
	default:
		return false
	}
}

func (c *Cell) Solid() bool {
	if !c.Present() {
		return false
	}
	// Elevated deck does not block the ground plane while standing or falling.
	if c.IsDeck() && c.State != Rubble {
		return false
	}
	switch c.State {
	case Intact, Cracked:
		return c.Kind != KindInterior && !c.IsDeck()
	case Broken:
		return c.Kind != KindInterior && !c.IsDeck()
	case Rubble:
		return true
	default:
		return false
	}
}

// SupportsRoof is kept for debug overlays; prefer IsSupport.
func (c *Cell) SupportsRoof() bool {
	return c.IsSupport()
}

func (c *Cell) Frame() string {
	if c.State == Rubble {
		return c.Rubble
	}
	if c.State == Cracked || c.State == Broken {
		if c.Tile != "" {
			return c.Tile + "_crack"
		}
	}
	return c.Tile
}

// LiftDrawY returns how many pixels above the footprint the cell should draw.
// Positive values mean shift up (smaller screen Y).
func (c *Cell) LiftDrawY(stories int) float64 {
	if !c.IsDeck() || c.State == Rubble {
		return 0
	}
	if stories < 1 {
		stories = 1
	}
	base := float64(stories * StoryLiftPx)
	y := base - c.Sag - c.FallY
	if y < 0 {
		return 0
	}
	return y
}

// SolidAABB returns world collision for this cell. Rubble is inset so the
// visible pile matches the collider.
func (c *Cell) SolidAABB(worldX, worldY float64) (x, y, w, h float64, ok bool) {
	if !c.Solid() {
		return 0, 0, 0, 0, false
	}
	const inset = 2.0
	if c.State == Rubble {
		return worldX + inset, worldY + inset, Tile - 2*inset, Tile - 2*inset, true
	}
	return worldX, worldY, Tile, Tile, true
}

func MaxHPFor(mat Material, kind CellKind) float64 {
	base := 8.0
	switch mat {
	case MatWood:
		base = 6.0
	case MatBrick:
		base = 10.0
	case MatConcrete:
		base = 14.0
	case MatGlass:
		base = 3.0
	case MatSteel:
		base = 18.0
	}
	if kind == KindRoof || kind == KindEdge {
		base *= 0.75
	}
	if kind == KindWindow {
		base *= 0.5
	}
	if kind == KindDoor {
		base *= 0.85
	}
	return base
}

func CashFor(mat Material, kind CellKind) int {
	switch mat {
	case MatWood:
		return 8
	case MatBrick:
		return 12
	case MatConcrete:
		return 18
	case MatGlass:
		return 15
	case MatSteel:
		return 22
	}
	if kind == KindInterior {
		return 4
	}
	return 10
}

func chebyshev(x0, y0, x1, y1 int) int {
	dx := x0 - x1
	if dx < 0 {
		dx = -dx
	}
	dy := y0 - y1
	if dy < 0 {
		dy = -dy
	}
	if dx > dy {
		return dx
	}
	return dy
}
