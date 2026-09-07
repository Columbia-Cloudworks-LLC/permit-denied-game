package lot

// Lot is the compact destruction sandbox world.
type Lot struct {
	W, H       float64 // world px
	Structures []Structure
	Ground     [][]int // tile IDs for draw (dirt/asphalt)
}

// TestLot builds the milestone-1 sandbox: wood shed, brick storefront,
// concrete municipal, open approach pads. World 400×288 (25×18 tiles).
func TestLot() Lot {
	const tw, th = 25, 18
	ground := make([][]int, th)
	for y := 0; y < th; y++ {
		ground[y] = make([]int, tw)
		for x := 0; x < tw; x++ {
			ground[y][x] = 1 // dirt
		}
	}
	// Central asphalt pad.
	for y := 2; y < th-1; y++ {
		for x := 3; x < tw-3; x++ {
			ground[y][x] = 5
		}
	}
	for y := 2; y < th-1; y++ {
		ground[y][12] = 6 // centerline dash
	}

	return Lot{
		W: float64(tw * Tile),
		H: float64(th * Tile),
		Structures: []Structure{
			woodShed(),
			brickStorefront(),
			concreteMunicipal(),
		},
		Ground: ground,
	}
}

// Spawn for the sandbox: south-center, facing north.
const (
	SpawnX = 200.0
	SpawnY = 248.0
)

func woodShed() Structure {
	const w, h = 4, 3
	cells := emptyGrid(w, h)
	// Footprint at tile (2, 10): west of spawn approach.
	wall := makeCell(KindWall, MatWood, "wood_wall", "wood_rubble")
	roof := makeCell(KindRoof, MatWood, "wood_roof", "wood_rubble")
	edge := makeCell(KindEdge, MatWood, "wood_edge", "wood_rubble")
	door := makeCell(KindDoor, MatWood, "wood_door", "wood_rubble")
	corner := makeCell(KindCorner, MatWood, "wood_corner", "wood_rubble")
	interior := makeCell(KindInterior, MatWood, "wood_interior", "wood_rubble")
	interior.State = Intact

	setCell(cells, w, 0, 0, corner)
	setCell(cells, w, 1, 0, edge)
	setCell(cells, w, 2, 0, edge)
	setCell(cells, w, 3, 0, corner)
	setCell(cells, w, 0, 1, wall)
	setCell(cells, w, 1, 1, roof)
	setCell(cells, w, 2, 1, roof)
	setCell(cells, w, 3, 1, wall)
	setCell(cells, w, 0, 2, wall)
	setCell(cells, w, 1, 2, door)
	setCell(cells, w, 2, 2, wall)
	setCell(cells, w, 3, 2, wall)
	// Interior under roofs (revealed when roof goes).
	_ = interior
	setCell(cells, w, 1, 1, roof)
	// Store interior tile name on roof cells for reveal draw via under-layer:
	// when roof is rubble/broken we draw wood_interior underneath in renderer.
	return Structure{Label: "SHED", TX: 2, TY: 10, W: w, H: h, Cells: cells}
}

func brickStorefront() Structure {
	const w, h = 6, 4
	cells := emptyGrid(w, h)
	wall := makeCell(KindWall, MatBrick, "brick_wall", "brick_rubble")
	roof := makeCell(KindRoof, MatBrick, "brick_roof", "brick_rubble")
	edge := makeCell(KindEdge, MatBrick, "brick_edge", "brick_rubble")
	corner := makeCell(KindCorner, MatBrick, "brick_corner", "brick_rubble")
	door := makeCell(KindDoor, MatBrick, "brick_door", "brick_rubble")
	win := makeCell(KindWindow, MatGlass, "brick_window", "glass_rubble")

	// Outer ring + roof fill. TX=16 TY=8 east side.
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			border := x == 0 || x == w-1 || y == 0 || y == h-1
			if !border {
				setCell(cells, w, x, y, roof)
				continue
			}
			if (x == 0 || x == w-1) && (y == 0 || y == h-1) {
				setCell(cells, w, x, y, corner)
			} else if y == 0 {
				setCell(cells, w, x, y, edge)
			} else if y == h-1 {
				if x == 2 {
					setCell(cells, w, x, y, door)
				} else if x == 1 || x == 3 || x == 4 {
					setCell(cells, w, x, y, win)
				} else {
					setCell(cells, w, x, y, wall)
				}
			} else {
				setCell(cells, w, x, y, wall)
			}
		}
	}
	return Structure{Label: "STORE", TX: 16, TY: 8, W: w, H: h, Cells: cells}
}

func concreteMunicipal() Structure {
	const w, h = 8, 6
	cells := emptyGrid(w, h)
	wall := makeCell(KindWall, MatConcrete, "conc_wall", "conc_rubble")
	roof := makeCell(KindRoof, MatConcrete, "conc_roof", "conc_rubble")
	edge := makeCell(KindEdge, MatConcrete, "conc_edge", "conc_rubble")
	corner := makeCell(KindCorner, MatConcrete, "conc_corner", "conc_rubble")
	door := makeCell(KindDoor, MatSteel, "conc_door", "steel_rubble")
	win := makeCell(KindWindow, MatGlass, "conc_window", "glass_rubble")

	// TX=8 TY=1 north pad.
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			border := x == 0 || x == w-1 || y == 0 || y == h-1
			if !border {
				setCell(cells, w, x, y, roof)
				continue
			}
			if (x == 0 || x == w-1) && (y == 0 || y == h-1) {
				setCell(cells, w, x, y, corner)
			} else if y == 0 {
				setCell(cells, w, x, y, edge)
			} else if y == h-1 {
				if x == 3 || x == 4 {
					setCell(cells, w, x, y, door)
				} else if x == 1 || x == 2 || x == 5 || x == 6 {
					setCell(cells, w, x, y, win)
				} else {
					setCell(cells, w, x, y, wall)
				}
			} else if x == 0 || x == w-1 {
				if y == 2 || y == 3 {
					setCell(cells, w, x, y, win)
				} else {
					setCell(cells, w, x, y, wall)
				}
			} else {
				setCell(cells, w, x, y, wall)
			}
		}
	}
	return Structure{Label: "HALL", TX: 8, TY: 1, W: w, H: h, Cells: cells}
}

// AABB is a colliding solid collected from cells.
type AABB struct {
	X, Y, W, H float64
	Struct     int
	LX, LY     int
	Rubble     bool
}

func (l *Lot) CollectSolids() []AABB {
	var out []AABB
	for si := range l.Structures {
		s := &l.Structures[si]
		for i := range s.Cells {
			c := &s.Cells[i]
			lx, ly := s.Index(i)
			wx, wy := s.WorldXY(lx, ly)
			x, y, w, h, ok := c.SolidAABB(wx, wy)
			if !ok {
				continue
			}
			out = append(out, AABB{
				X: x, Y: y, W: w, H: h,
				Struct: si, LX: lx, LY: ly,
				Rubble: c.State == Rubble,
			})
		}
		for _, p := range s.Spill {
			out = append(out, AABB{
				X: p.X, Y: p.Y, W: p.W, H: p.H,
				Struct: si, Rubble: true,
			})
		}
	}
	return out
}

// StructureByLabel returns a pointer into Lot.Structures.
func (l *Lot) StructureByLabel(label string) *Structure {
	for i := range l.Structures {
		if l.Structures[i].Label == label {
			return &l.Structures[i]
		}
	}
	return nil
}

// IntactSolidCount counts non-rubble solid cells (for tests).
func (l *Lot) IntactSolidCount() int {
	n := 0
	for si := range l.Structures {
		for i := range l.Structures[si].Cells {
			c := &l.Structures[si].Cells[i]
			if c.Solid() && c.State != Rubble {
				n++
			}
		}
	}
	return n
}

// RubbleCount counts rubble cells plus spill piles.
func (l *Lot) RubbleCount() int {
	n := 0
	for si := range l.Structures {
		for i := range l.Structures[si].Cells {
			if l.Structures[si].Cells[i].State == Rubble {
				n++
			}
		}
		n += len(l.Structures[si].Spill)
	}
	return n
}
