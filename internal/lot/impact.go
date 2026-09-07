package lot

// SpillPile is authoritative debris outside a bitten cell (drive-through openings).
type SpillPile struct {
	X, Y, W, H float64
	Mat        Material
}

// Impact is one oriented blade contact against a structure cell.
type Impact struct {
	Col, Row   int
	X, Y       float64
	DirX, DirY float64
	Heading    float64
	Speed      float64
	Force      float64
	BladeT     float64
	Depth      float64
}

type BreakCause int

const (
	CauseBite BreakCause = iota
	CauseCollapse
	CauseDustSettle
)

// Break is a cell state transition from impacts or collapse.
type Break struct {
	Col, Row   int
	From, To   CellState
	Cause      BreakCause
	X, Y       float64
	DirX, DirY float64
	Kind       CellKind
	Mat        Material
	Cash       int
}

// ApplyImpacts damages contacted cells and records impact direction for collapse bias.
func (s *Structure) ApplyImpacts(in []Impact) []Break {
	if len(in) == 0 {
		return nil
	}
	last := in[len(in)-1]
	if last.DirX != 0 || last.DirY != 0 {
		s.ImpactDirX, s.ImpactDirY = last.DirX, last.DirY
	}
	var out []Break
	for _, im := range in {
		c := s.At(im.Col, im.Row)
		if c == nil {
			continue
		}
		from := c.State
		cash, broke := s.ApplyDamage(im.Col, im.Row, im.Force)
		if !broke {
			continue
		}
		br := Break{
			Col: im.Col, Row: im.Row,
			From: from, To: Broken,
			Cause: CauseBite,
			X:     im.X, Y: im.Y,
			DirX: im.DirX, DirY: im.DirY,
			Kind: c.Kind, Mat: c.Mat, Cash: cash,
		}
		s.SpillRubble(br)
		out = append(out, br)
	}
	return out
}

// SpillRubble opens a bitten wall cell and drops offset piles along the impact dir.
func (s *Structure) SpillRubble(br Break) {
	c := s.At(br.Col, br.Row)
	if c == nil {
		return
	}
	switch c.Kind {
	case KindRoof, KindEdge, KindInterior:
		return
	}
	wx, wy := s.WorldXY(br.Col, br.Row)
	cx := wx + float64(Tile)/2
	cy := wy + float64(Tile)/2
	dirX, dirY := br.DirX, br.DirY
	if dirX == 0 && dirY == 0 {
		dirX, dirY = s.ImpactDirX, s.ImpactDirY
	}
	mat := c.Mat
	kind := c.Kind
	s.MarkBreach(br.Col, br.Row)
	s.Openings = append(s.Openings, Opening{
		LX: br.Col, LY: br.Row, Mat: mat, Kind: kind, DirX: dirX, DirY: dirY,
	})
	c.WasKind = kind
	c.WasMat = mat
	c.Kind = KindNone
	c.State = Empty
	c.DustLeft = 0
	c.CollapseIn = 0
	c.Falling = false
	c.Sag = 0
	c.FallY = 0
	c.HP = 0

	s.Spill = append(s.Spill, spillShape(mat, cx, cy, dirX, dirY, br.Col, br.Row)...)
}

func spillShape(mat Material, cx, cy, dirX, dirY float64, col, row int) []SpillPile {
	h := CellHash(col, row, 11)
	jitter := func(salt int) float64 {
		return float64(int(CellHash(col, row, salt)%7) - 3)
	}
	px := cx + dirX*10 - 5 + jitter(1)
	py := cy + dirY*10 - 4 + jitter(2)
	sideX, sideY := -dirY, dirX
	switch mat {
	case MatGlass:
		return []SpillPile{
			{X: px + jitter(3), Y: py, W: 5, H: 4, Mat: mat},
			{X: px + sideX*5 + 1, Y: py + sideY*4, W: 4, H: 3, Mat: mat},
			{X: px - sideX*4, Y: py + 3, W: 3, H: 3, Mat: mat},
		}
	case MatWood:
		return []SpillPile{
			{X: px, Y: py, W: 14, H: 6, Mat: mat},
			{X: px + sideX*5, Y: py + sideY*3, W: 8, H: 5, Mat: mat},
		}
	case MatBrick:
		return []SpillPile{
			{X: px, Y: py, W: 11, H: 9, Mat: mat},
			{X: px + sideX*6, Y: py + sideY*5, W: 7, H: 6, Mat: mat},
			{X: px - 3, Y: py + 4, W: 6, H: 5, Mat: mat},
		}
	case MatSteel:
		return []SpillPile{
			{X: px + 1, Y: py + 1, W: 8, H: 7, Mat: mat},
			{X: px + sideX*4, Y: py + 2, W: 5, H: 4, Mat: mat},
		}
	default: // concrete
		w := 10.0 + float64(h%4)
		ht := 8.0 + float64((h>>3)%3)
		return []SpillPile{
			{X: px, Y: py, W: w, H: ht, Mat: mat},
			{X: px + sideX*5 + jitter(4), Y: py + sideY*4, W: 7, H: 6, Mat: mat},
		}
	}
}
