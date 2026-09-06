package lot

// CollapseTick advances pending collapses and dust windows.
// Roof cells with too little support get a delayed break so large buildings
// fail over ~1 second instead of vanishing in one frame.
func (l *Lot) CollapseTick() (broke []CellBreak) {
	const minSupport = 1
	const hopDelay = 6 // ticks between hops ≈ 1s across a municipal roof

	for si := range l.Structures {
		s := &l.Structures[si]
		// Schedule unsupported roofs.
		for i := range s.Cells {
			c := &s.Cells[i]
			if c.Kind != KindRoof && c.Kind != KindEdge {
				continue
			}
			if c.State == Rubble || c.State == Broken || c.State == Empty || !c.Present() {
				continue
			}
			lx, ly := s.Index(i)
			sup := s.CountSupport(lx, ly)
			if sup >= minSupport {
				c.CollapseIn = 0
				continue
			}
			if c.CollapseIn <= 0 {
				// Seed delay based on distance from nearest missing support.
				c.CollapseIn = hopDelay
			}
		}
		// Countdown and break.
		for i := range s.Cells {
			c := &s.Cells[i]
			lx, ly := s.Index(i)
			if c.DustLeft > 0 {
				c.DustLeft--
				if c.DustLeft == 0 && c.State == Broken {
					s.FinishBroken(lx, ly)
				}
			}
			if c.CollapseIn > 0 {
				c.CollapseIn--
				if c.CollapseIn == 0 && c.State != Broken && c.State != Rubble {
					cash, did := s.ApplyDamage(lx, ly, c.HP+1)
					if did {
						broke = append(broke, CellBreak{
							Struct: si, LX: lx, LY: ly,
							Mat: c.Mat, Kind: c.Kind, Cash: cash,
							WX: float64((s.TX+lx)*Tile) + Tile/2,
							WY: float64((s.TY+ly)*Tile) + Tile/2,
						})
					}
				}
			}
		}
	}
	return broke
}

// CellBreak describes a cell that just entered Broken.
type CellBreak struct {
	Struct     int
	LX, LY     int
	WX, WY     float64
	Mat        Material
	Kind       CellKind
	Cash       int
	FromBlade  bool
}
