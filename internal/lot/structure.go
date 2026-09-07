package lot

// Structure is one authored building on the test lot: a W×H grid of cells.
type Structure struct {
	Label      string
	TX, TY     int // top-left tile
	W, H       int
	Cells      []Cell // len = W*H; KindNone = open
	ImpactDirX float64
	ImpactDirY float64 // last bite; collapse bias
	Spill      []SpillPile
}

func (s *Structure) At(lx, ly int) *Cell {
	if lx < 0 || ly < 0 || lx >= s.W || ly >= s.H {
		return nil
	}
	return &s.Cells[ly*s.W+lx]
}

func (s *Structure) WorldXY(lx, ly int) (float64, float64) {
	return float64((s.TX+lx)*Tile), float64((s.TY+ly)*Tile)
}

func (s *Structure) Index(i int) (lx, ly int) {
	return i % s.W, i / s.W
}

func makeCell(kind CellKind, mat Material, tile, rubble string) Cell {
	hp := MaxHPFor(mat, kind)
	return Cell{
		Kind:   kind,
		Mat:    mat,
		HP:     hp,
		MaxHP:  hp,
		State:  Intact,
		Tile:   tile,
		Rubble: rubble,
		Value:  CashFor(mat, kind),
	}
}

func emptyGrid(w, h int) []Cell {
	return make([]Cell, w*h)
}

func fillRect(cells []Cell, w, x0, y0, x1, y1 int, c Cell) {
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			cells[y*w+x] = c
		}
	}
}

func setCell(cells []Cell, w, x, y int, c Cell) {
	cells[y*w+x] = c
}

// ApplyDamage hits one cell. Returns cash awarded and whether the cell newly broke.
func (s *Structure) ApplyDamage(lx, ly int, amount float64) (cash int, broke bool) {
	c := s.At(lx, ly)
	if c == nil || !c.Present() || c.State == Rubble || c.State == Broken {
		return 0, false
	}
	if c.Kind == KindInterior {
		// Interiors only take damage once the roof/wall above is gone (drawn exposed).
		// They are not solid; still smashable for cash once exposed.
	}
	c.HP -= amount
	if c.HP > 0 {
		if c.HP <= c.MaxHP*0.5 {
			c.State = Cracked
		}
		return 0, false
	}
	c.HP = 0
	c.State = Broken
	c.DustLeft = 18
	c.CollapseIn = 0
	return c.Value, true
}

// FinishBroken promotes Broken → Rubble after dust clears.
func (s *Structure) FinishBroken(lx, ly int) {
	c := s.At(lx, ly)
	if c == nil || c.State != Broken {
		return
	}
	c.State = Rubble
	c.DustLeft = 0
}

// CountSupport returns how many cardinal neighbors still support a roof cell.
func (s *Structure) CountSupport(lx, ly int) int {
	n := 0
	for _, d := range [][2]int{{0, 1}, {0, -1}, {1, 0}, {-1, 0}} {
		n2 := s.At(lx+d[0], ly+d[1])
		if n2 != nil && n2.SupportsRoof() {
			n++
		}
	}
	return n
}
