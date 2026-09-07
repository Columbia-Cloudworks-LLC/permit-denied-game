package game

import (
	"testing"
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
	sagged := false
	for i := 0; i < 400; i++ {
		_ = g.Drive(Input{}, Keys{})
		snap := g.Snapshot()
		if snap.Falling > 0 {
			falling = true
		}
		if snap.Sagging > 0 {
			sagged = true
		}
	}
	if !sagged {
		t.Fatal("expected a warning/sag phase before the hall section fell")
	}
	if !falling && g.run.StructCash == 0 {
		t.Fatal("expected falling mass")
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
