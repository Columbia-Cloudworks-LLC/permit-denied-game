package lot_test

import (
	"testing"

	"permitdenied/internal/lot"
)

func TestHallWindowsDoNotCollapseDeck(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	for _, x := range []int{1, 2, 5, 6} {
		c := s.At(x, s.H-1)
		if c.Kind != lot.KindWindow {
			t.Fatalf("expected window at %d, got %v", x, c.Kind)
		}
		s.ApplyDamage(x, s.H-1, 999)
		s.FinishBroken(x, s.H-1)
	}
	for tick := 0; tick < 180; tick++ {
		if br := l.CollapseTick(); len(br) > 0 {
			t.Fatalf("window bites collapsed deck: %+v", br[0])
		}
	}
}

func TestHallSWCornerSagsWithoutFalling(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	s.ApplyDamage(0, 5, 999)
	s.FinishBroken(0, 5)
	sagged := false
	for tick := 0; tick < 90; tick++ {
		if br := l.CollapseTick(); len(br) > 0 {
			t.Fatalf("single corner should not collapse deck: %+v", br[0])
		}
		c := s.At(1, 4)
		if c.Sag > 0 {
			sagged = true
		}
		if c.Falling {
			t.Fatal("deck 1,4 should sag, not fall, after SW corner only")
		}
	}
	if !sagged {
		t.Fatal("expected nearby deck to sag after losing a south-west support")
	}
}

func TestHallSouthCollapseIsContiguousAndLeavesNorth(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	for x := 0; x < s.W; x++ {
		s.ApplyDamage(x, s.H-1, 999)
		s.FinishBroken(x, s.H-1)
	}
	s.ImpactDirX, s.ImpactDirY = 0, -1
	var first [2]int
	found := false
	groups := map[int]int{}
	for tick := 0; tick < 400; tick++ {
		_ = l.CollapseTick()
		if !found {
			for i := range s.Cells {
				if s.Cells[i].Falling {
					lx, ly := s.Index(i)
					first = [2]int{lx, ly}
					found = true
					break
				}
			}
		}
		for i := range s.Cells {
			if s.Cells[i].FallGroup > 0 {
				groups[s.Cells[i].FallGroup]++
			}
		}
	}
	if !found {
		t.Fatal("expected a falling stage")
	}
	if first[1] < 3 {
		t.Fatalf("collapse should start near the south breach, got %v", first)
	}
	northUp := 0
	southDown := 0
	checker := 0
	for x := 1; x < s.W-1; x++ {
		c := s.At(x, 1)
		if c.IsDeck() && (c.State == lot.Intact || c.State == lot.Cracked) && !c.Falling {
			northUp++
		}
		c4 := s.At(x, 4)
		if c4.IsDeck() && (c4.State == lot.Rubble || c4.State == lot.Broken) {
			southDown++
		} else if c4.IsDeck() && c4.State == lot.Intact {
			checker++
		}
	}
	if northUp < 4 {
		t.Fatalf("northern deck should remain, up=%d", northUp)
	}
	if southDown < 4 {
		t.Fatalf("southern deck should have fallen, down=%d", southDown)
	}
	if checker > 0 {
		t.Fatalf("southern row left intact cells (checkerboard) count=%d", checker)
	}
	if len(groups) == 0 {
		t.Fatal("expected fall groups on collapsing sections")
	}
}

func TestLoadPathIslandCollapses(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	// Remove every ground support; remaining deck must not hover on stale anchors.
	for i := range s.Cells {
		c := &s.Cells[i]
		if !c.IsSupport() {
			continue
		}
		lx, ly := s.Index(i)
		s.ApplyDamage(lx, ly, 999)
		s.FinishBroken(lx, ly)
	}
	broke := 0
	for tick := 0; tick < 500; tick++ {
		broke += len(l.CollapseTick())
	}
	standing := 0
	for i := range s.Cells {
		c := &s.Cells[i]
		if c.IsDeck() && (c.State == lot.Intact || c.State == lot.Cracked) && !c.Falling {
			standing++
		}
	}
	if standing > 0 {
		t.Fatalf("unsupported deck still standing: %d (broke=%d)", standing, broke)
	}
	if broke < 8 {
		t.Fatalf("expected a real collapse, broke=%d", broke)
	}
}

func TestSuperficialDamageStaysLocal(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	c := s.At(3, 5) // steel door
	_, broke := s.ApplyDamage(3, 5, c.MaxHP*0.2)
	if broke {
		t.Fatal("light hit should not breach")
	}
	if c.State == lot.Cracked {
		t.Fatal("20% damage should stay superficial, not cracked")
	}
	if c.Wound() < 0.15 {
		t.Fatalf("wound %v", c.Wound())
	}
	for tick := 0; tick < 60; tick++ {
		if br := l.CollapseTick(); len(br) > 0 {
			t.Fatalf("superficial hit collapsed: %+v", br[0])
		}
	}
}

func TestSpillRecordsOpeningAndMaterialPiles(t *testing.T) {
	s := lot.LabBrickMunicipal()
	s.BindAnchors()
	s.ApplyImpacts([]lot.Impact{{
		Col: 2, Row: s.H - 1, DirX: 0, DirY: 1, Force: 999,
	}})
	if len(s.Openings) != 1 {
		t.Fatalf("openings %d", len(s.Openings))
	}
	if s.Openings[0].Mat != lot.MatBrick {
		t.Fatalf("opening mat %v", s.Openings[0].Mat)
	}
	if len(s.Spill) < 2 {
		t.Fatalf("brick should scatter multiple piles, got %d", len(s.Spill))
	}
	for _, p := range s.Spill {
		if p.Mat != lot.MatBrick {
			t.Fatalf("pile mat %v", p.Mat)
		}
		if p.W < 4 || p.H < 3 {
			t.Fatalf("pile too tiny %+v", p)
		}
	}
}

func TestStoreAndShedStillCollapseFromSupports(t *testing.T) {
	l := lot.TestLot()
	store := l.StructureByLabel("STORE")
	for x := 0; x < store.W; x++ {
		store.ApplyDamage(x, store.H-1, 999)
		store.FinishBroken(x, store.H-1)
	}
	broke := 0
	for tick := 0; tick < 400; tick++ {
		broke += len(l.CollapseTick())
	}
	if broke == 0 {
		t.Fatal("STORE south undercut did not drop any deck")
	}

	l2 := lot.TestLot()
	shed := l2.StructureByLabel("SHED")
	_, did := shed.ApplyDamage(1, 2, 999)
	if !did {
		t.Fatal("shed door should still break")
	}
	// Three remaining walls still carry the tiny roof; it must not cascade from one door.
	for tick := 0; tick < 120; tick++ {
		if br := l2.CollapseTick(); len(br) > 0 {
			t.Fatalf("single shed door should not drop the roof: %+v", br[0])
		}
	}
}

func TestGlassSpillIsSmallerThanConcrete(t *testing.T) {
	hall := lot.TestLot()
	s := hall.StructureByLabel("HALL")
	s.ApplyImpacts([]lot.Impact{{
		Col: 1, Row: s.H - 1, DirX: 0, DirY: 1, Force: 999,
	}})
	var glassA, concA float64
	for _, p := range s.Spill {
		glassA += p.W * p.H
	}
	l2 := lot.TestLot()
	h2 := l2.StructureByLabel("HALL")
	h2.ApplyImpacts([]lot.Impact{{
		Col: 0, Row: h2.H - 1, DirX: 0, DirY: 1, Force: 999,
	}})
	for _, p := range h2.Spill {
		concA += p.W * p.H
	}
	if glassA >= concA {
		t.Fatalf("glass spill area %v should be smaller than concrete %v", glassA, concA)
	}
}
