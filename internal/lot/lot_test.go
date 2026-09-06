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
	}
	for _, want := range []string{"SHED", "STORE", "HALL"} {
		if !labels[want] {
			t.Fatalf("missing %s", want)
		}
	}
}

func TestLocalBiteLeavesNeighborIntact(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("SHED")
	if s == nil {
		t.Fatal("shed")
	}
	// Damage one wall cell only.
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

func TestCollapseTakesTime(t *testing.T) {
	l := lot.TestLot()
	s := l.StructureByLabel("HALL")
	// Kill a stretch of southern wall to undercut roof support.
	for x := 1; x < s.W-1; x++ {
		s.ApplyDamage(x, s.H-1, 999)
		s.FinishBroken(x, s.H-1)
	}
	brokeTotal := 0
	for tick := 0; tick < 90; tick++ {
		brokeTotal += len(l.CollapseTick())
	}
	if brokeTotal < 3 {
		t.Fatalf("expected chain collapse, broke %d cells", brokeTotal)
	}
	// Should not finish entire roof in the first few ticks.
	l2 := lot.TestLot()
	s2 := l2.StructureByLabel("HALL")
	for x := 1; x < s2.W-1; x++ {
		s2.ApplyDamage(x, s2.H-1, 999)
		s2.FinishBroken(x, s2.H-1)
	}
	early := 0
	for tick := 0; tick < 5; tick++ {
		early += len(l2.CollapseTick())
	}
	if early > brokeTotal {
		t.Fatalf("collapse too instant: early=%d total=%d", early, brokeTotal)
	}
}
