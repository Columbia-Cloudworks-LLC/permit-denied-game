package lot

// CollapseTick advances pending collapses and dust windows.
// Roof cells with too little support get a delayed break so large buildings
// fail over ~1 second instead of vanishing in one frame.
func (l *Lot) CollapseTick() (broke []CellBreak) {
	const minSupport = 1
	const hopDelay = 6 // ticks between hops ≈ 1s across a municipal roof

	for si := range l.Structures {
		s := &l.Structures[si]
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
				delay := hopDelay
				if s.ImpactDirX != 0 || s.ImpactDirY != 0 {
					cx := float64(lx) - float64(s.W-1)/2
					cy := float64(ly) - float64(s.H-1)/2
					if cx*s.ImpactDirX+cy*s.ImpactDirY < 0 {
						delay = hopDelay * 2
					}
				}
				c.CollapseIn = delay
			}
		}
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
							DirX: s.ImpactDirX, DirY: s.ImpactDirY,
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
