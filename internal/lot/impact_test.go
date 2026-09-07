package lot_test

import (
	"testing"

	"permitdenied/internal/lot"
)

func TestApplyImpactsSouthOpensSouthWall(t *testing.T) {
	s := lot.LabBrickMunicipal()
	imps := []lot.Impact{{
		Col: 2, Row: s.H - 1,
		X: 0, Y: 0, DirX: 0, DirY: -1, // heading north into south wall → force north
		Force: 999,
	}}
	broke := s.ApplyImpacts(imps)
	if len(broke) != 1 {
		t.Fatalf("breaks %d", len(broke))
	}
	c := s.At(2, s.H-1)
	if c.Solid() {
		t.Fatal("bitten south wall should not be solid")
	}
	if c.State != lot.Empty || c.Kind != lot.KindNone {
		t.Fatalf("want Empty opening, got kind=%v state=%v", c.Kind, c.State)
	}
	if len(s.Spill) == 0 {
		t.Fatal("expected spill rubble")
	}
	// Neighbor east wall still solid.
	n := s.At(3, s.H-1)
	if !n.Solid() {
		t.Fatal("neighbor should remain solid")
	}
}

func TestApplyImpactsEastOpensEastWall(t *testing.T) {
	s := lot.LabBrickMunicipal()
	imps := []lot.Impact{{
		Col: s.W - 1, Row: 2,
		DirX: -1, DirY: 0, Force: 999,
	}}
	broke := s.ApplyImpacts(imps)
	if len(broke) != 1 {
		t.Fatalf("breaks %d", len(broke))
	}
	c := s.At(s.W-1, 2)
	if c.Solid() {
		t.Fatal("east wall should be open")
	}
	south := s.At(2, s.H-1)
	if !south.Solid() {
		t.Fatal("south wall should still be solid after east bite")
	}
}

func TestFourDirectionBreachesDiffer(t *testing.T) {
	type pose struct {
		col, row int
		dx, dy   float64
	}
	poses := []pose{
		{2, 4, 0, -1}, // south
		{2, 0, 0, 1},  // north
		{5, 2, -1, 0}, // east
		{0, 2, 1, 0},  // west
	}
	var keys []string
	for _, p := range poses {
		s := lot.LabBrickMunicipal()
		s.ApplyImpacts([]lot.Impact{{
			Col: p.col, Row: p.row, DirX: p.dx, DirY: p.dy, Force: 999,
		}})
		key := ""
		for i := range s.Cells {
			c := &s.Cells[i]
			if !c.Solid() && c.Kind == lot.KindNone {
				lx, ly := s.Index(i)
				key += string(rune('A'+lx)) + string(rune('0'+ly)) + ";"
			}
		}
		keys = append(keys, key)
	}
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[i] == keys[j] {
				t.Fatalf("poses %d and %d produced same opening set %q", i, j, keys[i])
			}
		}
	}
}

func TestSpillInCollectSolids(t *testing.T) {
	l := lot.NewLabLot()
	s := &l.Structures[0]
	before := len(l.CollectSolids())
	s.ApplyImpacts([]lot.Impact{{
		Col: 2, Row: s.H - 1, DirX: 0, DirY: 1, Force: 999, // spill south onto street
	}})
	after := l.CollectSolids()
	if len(s.Spill) == 0 {
		t.Fatal("no spill")
	}
	// One wall removed, spill piles added — net solids should still include spill.
	rubbleSolids := 0
	for _, a := range after {
		if a.Rubble {
			rubbleSolids++
		}
	}
	if rubbleSolids == 0 {
		t.Fatal("collectSolids missing spill piles")
	}
	if len(after) < before-1 {
		t.Fatalf("solids before=%d after=%d", before, len(after))
	}
}

func TestSouthVsEastCollapseSetsDiffer(t *testing.T) {
	collapseSet := func(dirX, dirY float64, wallCols [][2]int) map[[2]int]bool {
		l := lot.NewLabLot()
		s := &l.Structures[0]
		for _, w := range wallCols {
			s.ApplyImpacts([]lot.Impact{{
				Col: w[0], Row: w[1], DirX: dirX, DirY: dirY, Force: 999,
			}})
		}
		set := map[[2]int]bool{}
		for tick := 0; tick < 120; tick++ {
			for _, br := range l.CollapseTick() {
				set[[2]int{br.LX, br.LY}] = true
			}
		}
		return set
	}
	// Undercut full south wall.
	var southWall [][2]int
	s0 := lot.LabBrickMunicipal()
	for x := 1; x < s0.W-1; x++ {
		southWall = append(southWall, [2]int{x, s0.H - 1})
	}
	south := collapseSet(0, -1, southWall)

	var eastWall [][2]int
	for y := 1; y < s0.H-1; y++ {
		eastWall = append(eastWall, [2]int{s0.W - 1, y})
	}
	east := collapseSet(-1, 0, eastWall)

	if len(south) == 0 || len(east) == 0 {
		t.Fatalf("collapse empty south=%d east=%d", len(south), len(east))
	}
	same := len(south) == len(east)
	if same {
		for k := range south {
			if !east[k] {
				same = false
				break
			}
		}
	}
	if same {
		t.Fatal("south and east collapse sets identical")
	}
}
