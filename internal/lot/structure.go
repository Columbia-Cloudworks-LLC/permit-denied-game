package lot

import "fmt"

// Structure is one authored building on the test lot: a W×H grid of cells.
type Structure struct {
	Label      string
	TX, TY     int // top-left tile
	W, H       int
	Stories    int    // visual height; 1 = shed, 2 = store/hall
	Cells      []Cell // len = W*H; KindNone = open
	ImpactDirX float64
	ImpactDirY float64 // last bite; collapse bias
	BreachLX   int     // last support breach (local); -1 if none
	BreachLY   int
	Spill      []SpillPile
	// Openings records spilled ground cells so the renderer can merge holes.
	Openings []Opening
	// Anchors binds each deck cell to its 3 nearest load-bearing cells
	// (flat indices into Cells). Alive-anchor count drives sag/collapse.
	Anchors [][3]int
	// FallStarts are deck cells that began falling this tick (local x,y).
	FallStarts [][2]int
	nextGroup  int
}

// Opening is a drive-through breach (cell deleted from the grid, pile elsewhere).
type Opening struct {
	LX, LY     int
	Mat        Material
	Kind       CellKind
	DirX, DirY float64
}

func (s *Structure) At(lx, ly int) *Cell {
	if lx < 0 || ly < 0 || lx >= s.W || ly >= s.H {
		return nil
	}
	return &s.Cells[ly*s.W+lx]
}

func (s *Structure) WorldXY(lx, ly int) (float64, float64) {
	return float64((s.TX + lx) * Tile), float64((s.TY + ly) * Tile)
}

func (s *Structure) Index(i int) (lx, ly int) {
	return i % s.W, i / s.W
}

func (s *Structure) storyCount() int {
	if s.Stories < 1 {
		return 1
	}
	return s.Stories
}

// LiftPx is the elevated deck height in pixels for this structure.
func (s *Structure) LiftPx() float64 {
	return float64(s.storyCount() * StoryLiftPx)
}

func makeCell(kind CellKind, mat Material, tile, rubble string) Cell {
	hp := MaxHPFor(mat, kind)
	return Cell{
		Kind:    kind,
		Mat:     mat,
		HP:      hp,
		MaxHP:   hp,
		State:   Intact,
		Tile:    tile,
		Rubble:  rubble,
		Value:   CashFor(mat, kind),
		WasKind: kind,
		WasMat:  mat,
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

// BindAnchors assigns each deck cell its 3 nearest authored supports.
// Call once after the grid is filled. Anchor slots use -1 when fewer than 3.
func (s *Structure) BindAnchors() {
	s.Anchors = make([][3]int, len(s.Cells))
	for i := range s.Anchors {
		s.Anchors[i] = [3]int{-1, -1, -1}
	}
	var supports []int
	for i := range s.Cells {
		c := &s.Cells[i]
		// Authored support kinds (windows excluded even if intact).
		switch c.Kind {
		case KindWall, KindCorner, KindDoor:
			supports = append(supports, i)
		}
	}
	for i := range s.Cells {
		if !s.Cells[i].IsDeck() {
			continue
		}
		lx, ly := s.Index(i)
		type cand struct{ idx, dist int }
		var cs []cand
		for _, si := range supports {
			sx, sy := s.Index(si)
			cs = append(cs, cand{si, chebyshev(lx, ly, sx, sy)})
		}
		// Sort by distance ascending (stable insertion; grids are tiny).
		for a := 1; a < len(cs); a++ {
			for b := a; b > 0 && cs[b].dist < cs[b-1].dist; b-- {
				cs[b], cs[b-1] = cs[b-1], cs[b]
			}
		}
		for k := 0; k < 3 && k < len(cs); k++ {
			s.Anchors[i][k] = cs[k].idx
		}
	}
}

// ApplyDamage hits one cell. Returns cash awarded and whether the cell newly broke.
func (s *Structure) ApplyDamage(lx, ly int, amount float64) (cash int, broke bool) {
	c := s.At(lx, ly)
	if c == nil || !c.Present() || c.State == Rubble || c.State == Broken {
		return 0, false
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
	c.DustLeft = DustBite
	if c.IsDeck() {
		c.DustLeft = DustCollapse
	}
	c.CollapseIn = 0
	c.Falling = false
	c.Sag = 0
	if !c.Paid {
		c.Paid = true
		cash = c.Value
	}
	if c.Kind == KindWall || c.Kind == KindCorner || c.Kind == KindDoor || c.Kind == KindWindow {
		s.BreachLX, s.BreachLY = lx, ly
	}
	return cash, true
}

// FinishBroken promotes Broken → Rubble after dust clears.
func (s *Structure) FinishBroken(lx, ly int) {
	c := s.At(lx, ly)
	if c == nil || c.State != Broken {
		return
	}
	c.State = Rubble
	c.DustLeft = 0
	c.FallY = 0
	c.Sag = 0
	c.Falling = false
}

// aliveAnchors counts how many bound anchors still bear load.
func (s *Structure) aliveAnchors(flat int) int {
	if flat < 0 || flat >= len(s.Anchors) {
		return 0
	}
	n := 0
	for _, ai := range s.Anchors[flat] {
		if ai < 0 || ai >= len(s.Cells) {
			continue
		}
		if s.Cells[ai].IsSupport() {
			n++
		}
	}
	return n
}

func (s *Structure) hasLocalSupport(lx, ly int) bool {
	return s.rootedAt(lx, ly)
}

// SupportScore returns the collapse metric for a deck cell.
// Bound alive anchors (0..3) drive the value, but a cell with no live
// support in its 8-neighborhood cannot be held up by distant anchors —
// that was leaving southern bays hovering on far north walls.
func (s *Structure) SupportScore(lx, ly int) float64 {
	if lx < 0 || ly < 0 || lx >= s.W || ly >= s.H {
		return 0
	}
	sc := float64(s.aliveAnchors(ly*s.W + lx))
	if sc > 1 && !s.hasLocalSupport(lx, ly) {
		sc = 1
	}
	return sc
}

// CountSupport returns alive anchors (debug / tests).
func (s *Structure) CountSupport(lx, ly int) int {
	return s.aliveAnchors(ly*s.W + lx)
}

// ValidateSupport returns an error if any standing deck cell would collapse
// when the structure is otherwise intact (authoring guard).
func (s *Structure) ValidateSupport() error {
	if len(s.Anchors) != len(s.Cells) {
		s.BindAnchors()
	}
	for i := range s.Cells {
		c := &s.Cells[i]
		if !c.IsDeck() || c.State != Intact {
			continue
		}
		lx, ly := s.Index(i)
		sc := s.SupportScore(lx, ly)
		if sc < CollapseScoreMin {
			return fmt.Errorf("%s deck %d,%d anchors %.0f < min %.2f", s.Label, lx, ly, sc, CollapseScoreMin)
		}
		if !s.HasLoadPath(lx, ly) {
			return fmt.Errorf("%s deck %d,%d has no load path to a live support", s.Label, lx, ly)
		}
	}
	return nil
}

// MarkBreach records where a support was removed (spill path / external).
func (s *Structure) MarkBreach(lx, ly int) {
	s.BreachLX, s.BreachLY = lx, ly
}

// HasLoadPath reports whether standing (non-falling) deck at lx,ly can reach a
// live adjacent support through a connected sheet of standing deck.
func (s *Structure) HasLoadPath(lx, ly int) bool {
	c := s.At(lx, ly)
	if c == nil || !c.IsDeck() {
		return true
	}
	if c.Falling || c.State == Rubble || c.State == Broken || c.State == Empty {
		return false
	}
	type pt struct{ x, y int }
	start := pt{lx, ly}
	seen := map[pt]bool{start: true}
	q := []pt{start}
	for len(q) > 0 {
		p := q[0]
		q = q[1:]
		if s.rootedAt(p.x, p.y) {
			return true
		}
		for _, d := range [][2]int{{0, 1}, {0, -1}, {1, 0}, {-1, 0}} {
			nx, ny := p.x+d[0], p.y+d[1]
			n := s.At(nx, ny)
			if n == nil || !n.IsDeck() {
				continue
			}
			if n.Falling || n.State == Rubble || n.State == Broken || n.State == Empty {
				continue
			}
			np := pt{nx, ny}
			if seen[np] {
				continue
			}
			seen[np] = true
			q = append(q, np)
		}
	}
	return false
}

func (s *Structure) rootedAt(lx, ly int) bool {
	for _, d := range [][2]int{
		{0, 1}, {0, -1}, {1, 0}, {-1, 0},
		{1, 1}, {1, -1}, {-1, 1}, {-1, -1},
	} {
		n := s.At(lx+d[0], ly+d[1])
		if n != nil && n.IsSupport() {
			return true
		}
	}
	return false
}

// InteriorSupport is a load-bearing post inside the footprint (not the outer ring).
func (s *Structure) InteriorSupport(lx, ly int) bool {
	if lx <= 0 || ly <= 0 || lx >= s.W-1 || ly >= s.H-1 {
		return false
	}
	c := s.At(lx, ly)
	return c != nil && c.IsSupport()
}

// Cavity reports a visual hole: spilled wall or fallen deck.
func (s *Structure) Cavity(lx, ly int) bool {
	c := s.At(lx, ly)
	if c == nil {
		return false
	}
	if c.Kind == KindNone || c.State == Empty {
		return true
	}
	if c.IsDeck() && (c.State == Rubble || c.State == Broken) && !c.Falling {
		return true
	}
	return false
}

func (s *Structure) allocFallGroup() int {
	s.nextGroup++
	if s.nextGroup <= 0 {
		s.nextGroup = 1
	}
	return s.nextGroup
}
