package lot_test

import (
	"testing"

	"permitdenied/internal/lot"
)

func TestTestLotFootprints(t *testing.T) {
	l := lot.TestLot()
	if l.W != 400 || l.H != 288 {
		t.Fatalf("lot size %vx%v", l.W, l.H)
	}
	if len(l.Structures) != 3 {
		t.Fatalf("want 3 structures, got %d", len(l.Structures))
	}
	labels := map[string]bool{}
	for _, s := range l.Structures {
		labels[s.Label] = true
		if len(s.Cells) != s.W*s.H {
			t.Fatalf("%s cells %d want %d", s.Label, len(s.Cells), s.W*s.H)
		}
		if s.Stories < 1 {
			t.Fatalf("%s stories %d", s.Label, s.Stories)
		}
		if err := s.ValidateSupport(); err != nil {
			t.Fatal(err)
		}
	}
	for _, want := range []string{"SHED", "STORE", "HALL"} {
		if !labels[want] {
			t.Fatalf("missing %s", want)
		}
	}
	if l.StructureByLabel("SHED").Stories != 1 {
		t.Fatal("shed should be 1 story")
	}
	if l.StructureByLabel("HALL").Stories != 2 {
		t.Fatal("hall should be 2 stories")
	}
}

func TestLocalBiteLeavesNeighborIntact(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("SHED")
	if s == nil {
		t.Fatal("shed")
	}
	cash, broke := s.ApplyDamage(0, 1, 999)
	if !broke || cash <= 0 {
		t.Fatalf("broke=%v cash=%d", broke, cash)
	}
	s.FinishBroken(0, 1)
	neighbor := s.At(0, 2)
	if neighbor.State != lot.Intact {
		t.Fatalf("neighbor state %v", neighbor.State)
	}
	if l.RubbleCount() != 1 {
		t.Fatalf("rubble %d", l.RubbleCount())
	}
}

func TestRubbleAABBInset(t *testing.T) {
	c := lot.Cell{Kind: lot.KindWall, State: lot.Rubble, Mat: lot.MatWood}
	x, y, w, h, ok := c.SolidAABB(32, 48)
	if !ok {
		t.Fatal("expected solid")
	}
	if x != 34 || y != 50 || w != 12 || h != 12 {
		t.Fatalf("aabb %v,%v %vx%v", x, y, w, h)
	}
}

func TestUntouchedBuildingsStable(t *testing.T) {
	l := lot.TestLot()
	for tick := 0; tick < 60*60; tick++ {
		broke := l.CollapseTick()
		if len(broke) > 0 {
			t.Fatalf("untouched broke at tick %d: %+v", tick, broke[0])
		}
	}
	if l.RubbleCount() != 0 {
		t.Fatalf("rubble %d", l.RubbleCount())
	}
}

func TestRoofNotSolidWhileStanding(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	for i := range s.Cells {
		c := &s.Cells[i]
		if c.IsDeck() && c.Solid() {
			lx, ly := s.Index(i)
			t.Fatalf("deck %d,%d should not be solid", lx, ly)
		}
	}
}

func TestCollapseTakesTime(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	for x := 0; x < s.W; x++ {
		s.ApplyDamage(x, s.H-1, 999)
		s.FinishBroken(x, s.H-1)
	}
	brokeTotal := 0
	fallingSeen := false
	for tick := 0; tick < 300; tick++ {
		for i := range s.Cells {
			if s.Cells[i].Falling {
				fallingSeen = true
			}
		}
		brokeTotal += len(l.CollapseTick())
	}
	if brokeTotal < 3 {
		t.Fatalf("expected chain collapse, broke %d cells", brokeTotal)
	}
	if !fallingSeen {
		t.Fatal("expected visible falling stage")
	}

	l2 := lot.TestLot()
	s2 := l2.StructureByLabel("HALL")
	for x := 0; x < s2.W; x++ {
		s2.ApplyDamage(x, s2.H-1, 999)
		s2.FinishBroken(x, s2.H-1)
	}
	early := 0
	for tick := 0; tick < 5; tick++ {
		early += len(l2.CollapseTick())
	}
	if early > 0 {
		t.Fatalf("collapse too instant: early=%d", early)
	}
}

func TestCollapseCashOnce(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	for x := 0; x < s.W; x++ {
		s.ApplyDamage(x, s.H-1, 999)
		s.FinishBroken(x, s.H-1)
	}
	cash := 0
	seen := map[[2]int]bool{}
	for tick := 0; tick < 400; tick++ {
		for _, br := range l.CollapseTick() {
			key := [2]int{br.LX, br.LY}
			if seen[key] {
				t.Fatalf("double break at %v", key)
			}
			seen[key] = true
			cash += br.Cash
		}
	}
	if cash <= 0 || len(seen) == 0 {
		t.Fatalf("cash=%d cells=%d", cash, len(seen))
	}
}

func TestGlassNotLoadBearing(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	// Smash only windows on the south facade.
	for x := 1; x <= 2; x++ {
		c := s.At(x, s.H-1)
		if c.Kind != lot.KindWindow {
			t.Fatalf("expected window at %d", x)
		}
		s.ApplyDamage(x, s.H-1, 999)
		s.FinishBroken(x, s.H-1)
	}
	for tick := 0; tick < 120; tick++ {
		if br := l.CollapseTick(); len(br) > 0 {
			t.Fatalf("glass-only bite collapsed deck: %+v", br[0])
		}
	}
}
