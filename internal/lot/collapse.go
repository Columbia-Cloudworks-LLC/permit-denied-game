package lot

// CollapseTick advances sag, pending collapses, falling mass, and dust windows.
// Each deck cell is bound to its 3 nearest ground supports. Losing anchors
// undercuts nearby deck first; sagging cells tear when a neighbor falls so
// failure propagates from the breach without a global HP% gate.
func (l *Lot) CollapseTick() (broke []CellBreak) {
	for si := range l.Structures {
		s := &l.Structures[si]
		lift := s.LiftPx()
		if len(s.Anchors) != len(s.Cells) {
			s.BindAnchors()
		}

		// 1) Score deck cells: sag, schedule, or clear timers.
		for i := range s.Cells {
			c := &s.Cells[i]
			if !c.IsDeck() {
				continue
			}
			if c.State == Rubble || c.State == Broken || c.State == Empty || !c.Present() {
				continue
			}
			if c.Falling {
				continue
			}
			lx, ly := s.Index(i)
			sc := s.SupportScore(lx, ly)
			if sc >= SagScoreMin {
				c.Sag = 0
				c.CollapseIn = 0
				continue
			}
			if sc >= CollapseScoreMin {
				t := (SagScoreMin - sc) / (SagScoreMin - CollapseScoreMin)
				if t < 0 {
					t = 0
				}
				if t > 1 {
					t = 1
				}
				c.Sag = t * 4
				// Tear: sagging mass next to already-failed deck joins the collapse.
				if deckNeighborFailed(s, lx, ly) && c.CollapseIn <= 0 {
					c.CollapseIn = CollapseHopDelay / 2
					if c.CollapseIn < 3 {
						c.CollapseIn = 3
					}
				}
				continue
			}
			c.Sag = 4
			if c.CollapseIn <= 0 {
				delay := CollapseHopDelay
				bx, by := s.BreachLX, s.BreachLY
				if bx < 0 && by < 0 {
					bx, by = s.W / 2, s.H - 1
				}
				dist := chebyshev(lx, ly, bx, by)
				delay += dist * CollapseHopPerDist
				if s.ImpactDirX != 0 || s.ImpactDirY != 0 {
					cx := float64(lx) - float64(s.W-1)/2
					cy := float64(ly) - float64(s.H-1)/2
					if cx*s.ImpactDirX+cy*s.ImpactDirY < 0 {
						delay += CollapseHopDelay
					}
				}
				c.CollapseIn = delay
			}
		}

		// 2) Tick dust, collapse timers, and falling motion.
		for i := range s.Cells {
			c := &s.Cells[i]
			lx, ly := s.Index(i)

			if c.DustLeft > 0 {
				c.DustLeft--
				if c.DustLeft == 0 && c.State == Broken {
					s.FinishBroken(lx, ly)
				}
			}

			if c.IsDeck() && c.CollapseIn > 0 && !c.Falling &&
				c.State != Broken && c.State != Rubble {
				c.CollapseIn--
				if c.CollapseIn == 0 {
					c.Falling = true
					c.FallY = c.Sag
					c.Sag = 0
				}
			}

			if c.IsDeck() && c.Falling && c.State != Broken && c.State != Rubble {
				c.FallY += FallSpeedPerTick
				if c.FallY >= lift {
					c.FallY = lift
					cash, did := s.ApplyDamage(lx, ly, c.HP+1)
					c.Falling = false
					if did {
						broke = append(broke, CellBreak{
							Struct: si, LX: lx, LY: ly,
							Mat: c.Mat, Kind: c.Kind, Cash: cash,
							WX: float64((s.TX+lx)*Tile) + Tile/2,
							WY: float64((s.TY+ly)*Tile) + Tile/2,
							DirX: s.ImpactDirX, DirY: s.ImpactDirY,
						})
					}
				}
			}
		}
	}
	return broke
}

func deckNeighborFailed(s *Structure, lx, ly int) bool {
	for _, d := range [][2]int{{0, 1}, {0, -1}, {1, 0}, {-1, 0}} {
		n := s.At(lx+d[0], ly+d[1])
		if n == nil || !n.IsDeck() {
			continue
		}
		if n.Falling || n.State == Broken || n.State == Rubble {
			return true
		}
	}
	return false
}

// CellBreak describes a cell that just entered Broken.
type CellBreak struct {
	Struct    int
	LX, LY    int
	WX, WY    float64
	Mat       Material
	Kind      CellKind
	Cash      int
	FromBlade bool
	DirX      float64
	DirY      float64
}
