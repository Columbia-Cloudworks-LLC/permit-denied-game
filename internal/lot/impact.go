package lot

// SpillPile is authoritative debris outside a bitten cell (drive-through openings).
type SpillPile struct {
	X, Y, W, H float64
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
			X: im.X, Y: im.Y,
			DirX: im.DirX, DirY: im.DirY,
			Kind: c.Kind, Mat: c.Mat, Cash: cash,
		}
		s.SpillRubble(br)
		out = append(out, br)
	}
	return out
}

// SpillRubble opens a bitten wall cell and drops an offset pile along the impact dir.
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
	c.Kind = KindNone
	c.State = Empty
	c.DustLeft = 0
	c.CollapseIn = 0
	c.HP = 0

	const spill, rw, rh = 10.0, 12.0, 10.0
	px := cx + dirX*spill - rw/2
	py := cy + dirY*spill - rh/2
	s.Spill = append(s.Spill, SpillPile{X: px, Y: py, W: rw, H: rh})
	if mat == MatBrick {
		sideX, sideY := -dirY, dirX
		s.Spill = append(s.Spill, SpillPile{
			X: px + sideX*6, Y: py + sideY*6, W: 8, H: 8,
		})
	}
}
