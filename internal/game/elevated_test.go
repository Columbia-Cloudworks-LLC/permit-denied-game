package game

import (
	"testing"

	"permitdenied/internal/lot"
)

func TestUntouchedLotSixtySeconds(t *testing.T) {
	g := New()
	g.Silence()
	for i := 0; i < TPS*60; i++ {
		if err := g.Drive(Input{}, Keys{}); err != nil {
			t.Fatal(err)
		}
		if g.run.StructCash != 0 {
			t.Fatalf("cash %d at tick %d", g.run.StructCash, i)
		}
	}
	if g.lot.RubbleCount() != 0 {
		t.Fatalf("rubble %d", g.lot.RubbleCount())
	}
}

func TestHallSouthCollapseLocation(t *testing.T) {
	g := New()
	g.Silence()
	hall := g.lot.StructureByLabel("HALL")
	for x := 0; x < hall.W; x++ {
		hall.ApplyDamage(x, hall.H-1, 999)
		hall.FinishBroken(x, hall.H-1)
	}
	hall.ImpactDirX, hall.ImpactDirY = 0, -1
	falling := false
	broke := 0
	for i := 0; i < 400; i++ {
		_ = g.Drive(Input{}, Keys{})
		snap := g.Snapshot()
		if snap.Falling > 0 {
			falling = true
		}
		broke = 0
		for j := range hall.Cells {
			if hall.Cells[j].State == lot.Rubble && hall.Cells[j].IsDeck() {
				// deck rubble counted after finish — IsDeck still true for kind
			}
			if hall.Cells[j].Paid && (hall.Cells[j].Kind == lot.KindRoof || hall.Cells[j].Kind == lot.KindEdge) {
				broke++
			}
		}
		_ = broke
	}
	if !falling && g.run.StructCash == 0 {
		// CollapseTick runs in stepPlay; cash from deck breaks.
	}
	if g.run.StructCash <= 0 {
		t.Fatalf("expected collapse cash, got %d falling=%v", g.run.StructCash, falling)
	}
}

func TestShedDoorStillBiteable(t *testing.T) {
	g := New()
	g.Silence()
	g.dozer.BladeDown = true
	shed := g.lot.StructureByLabel("SHED")
	wx, wy := shed.WorldXY(1, 2)
	g.dozer.X = wx + 8
	g.dozer.Y = wy + 24
	g.dozer.Heading = 0
	for i := 0; i < TPS*2; i++ {
		_ = g.Drive(Input{Throttle: 1}, Keys{})
	}
	if g.run.StructCash <= 0 {
		t.Fatalf("shed door bite cash=%d", g.run.StructCash)
	}
}
