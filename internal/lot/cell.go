package lot

// Cell destruction: each 16×16 section has its own HP and solid AABB.
// Visual debris is garnish; collision comes only from Intact/Cracked/Broken walls
// and persistent Rubble cells whose sprite inset matches the collider.

const Tile = 16

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
	// CollapseIn > 0 means this roof/edge will break after that many ticks.
	CollapseIn int
	// DustLeft covers the tile swap for a few ticks after Broken.
	DustLeft int
	Tile     string // buildings.png frame while standing
	Rubble   string // buildings.png frame once rubble
	Value    int    // cash when this cell becomes rubble
}

func (c *Cell) Present() bool {
	return c.Kind != KindNone && c.State != Empty
}

func (c *Cell) Solid() bool {
	if !c.Present() {
		return false
	}
	switch c.State {
	case Intact, Cracked:
		return c.Kind != KindInterior
	case Broken:
		return c.Kind != KindInterior && c.Kind != KindRoof
	case Rubble:
		return true
	default:
		return false
	}
}

func (c *Cell) SupportsRoof() bool {
	if !c.Present() {
		return false
	}
	if c.State == Rubble || c.State == Broken || c.State == Empty {
		return false
	}
	// Only vertical structure holds a roof up — not other roofs or eaves.
	switch c.Kind {
	case KindWall, KindCorner, KindDoor, KindWindow:
		return true
	default:
		return false
	}
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
	if kind == KindRoof {
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
