package game

import (
	"math"
	"testing"

	"permitdenied/internal/lot"
)

func TestForwardVector(t *testing.T) {
	cases := []struct {
		h      float64
		fx, fy float64
	}{
		{0, 0, -1},
		{math.Pi / 2, 1, 0},
		{math.Pi, 0, 1},
		{3 * math.Pi / 2, -1, 0},
	}
	for _, c := range cases {
		fx, fy := Forward(c.h)
		if math.Abs(fx-c.fx) > 1e-9 || math.Abs(fy-c.fy) > 1e-9 {
			t.Fatalf("heading %v → (%v,%v) want (%v,%v)", c.h, fx, fy, c.fx, c.fy)
		}
	}
}

func TestSpawnInPlay(t *testing.T) {
	g := New()
	g.Silence()
	s := g.Snapshot()
	if s.Scene != "play" {
		t.Fatalf("scene %s", s.Scene)
	}
	if s.Title != WindowTitle {
		t.Fatalf("title %q", s.Title)
	}
	if math.Abs(s.X-SpawnX) > 0.1 || math.Abs(s.Y-SpawnY) > 0.1 {
		t.Fatalf("spawn %v,%v", s.X, s.Y)
	}
}

func TestSpawnWOneSecond(t *testing.T) {
	g := New()
	g.Silence()
	for i := 0; i < TPS; i++ {
		if err := g.Drive(Input{Throttle: 1}, Keys{}); err != nil {
			t.Fatal(err)
		}
	}
	if g.dozer.Y >= SpawnY-20 {
		t.Fatalf("expected north progress, y=%v", g.dozer.Y)
	}
}

func TestSpawnAHalfSecond(t *testing.T) {
	g := New()
	g.Silence()
	for i := 0; i < TPS/2; i++ {
		if err := g.Drive(Input{Steer: -1}, Keys{}); err != nil {
			t.Fatal(err)
		}
	}
	if g.dozer.Heading >= 0 && g.dozer.Heading < 0.1 {
		t.Fatalf("expected west-of-north heading, got %v", g.dozer.Heading)
	}
	// A = vehicle left = heading decreases → negative / near 2π.
	h := g.dozer.Heading
	if h > math.Pi {
		// wrapped
	} else if h >= 0 {
		t.Fatalf("heading should decrease from 0, got %v", h)
	}
}

func TestBladeDownBitesLocalCells(t *testing.T) {
	g := New()
	g.Silence()
	g.dozer.BladeDown = true
	// Park against shed south door (tile 2,10 shed; door at local 1,2 → world ~48,192).
	shed := g.lot.StructureByLabel("SHED")
	wx, wy := shed.WorldXY(1, 2)
	g.dozer.X = wx + 8
	g.dozer.Y = wy + 24
	g.dozer.Heading = 0 // north into door
	intactBefore := g.lot.IntactSolidCount()
	for i := 0; i < TPS*2; i++ {
		_ = g.Drive(Input{Throttle: 1}, Keys{})
		if g.fx.HitStop > 0 {
			continue
		}
	}
	if g.run.StructCash <= 0 {
		t.Fatalf("expected cash from wreck, got %d", g.run.StructCash)
	}
	if g.lot.IntactSolidCount() >= intactBefore {
		t.Fatalf("expected fewer intact solids")
	}
	// Neighbor cells should still exist as non-rubble somewhere on shed.
	intactNeighbors := 0
	for i := range shed.Cells {
		c := &shed.Cells[i]
		if c.Present() && c.State == lot.Intact {
			intactNeighbors++
		}
	}
	if intactNeighbors < 1 {
		t.Fatal("local bite should leave some shed cells intact")
	}
}

func TestRestartResetsLot(t *testing.T) {
	g := New()
	g.Silence()
	g.run.StructCash = 99
	g.lot.StructureByLabel("SHED").ApplyDamage(0, 1, 999)
	_ = g.Drive(Input{}, Keys{R: true})
	s := g.Snapshot()
	if s.StructCash != 0 {
		t.Fatalf("cash %d", s.StructCash)
	}
	if s.Rubble != 0 {
		t.Fatalf("rubble %d", s.Rubble)
	}
	if s.Scene != "play" {
		t.Fatalf("scene %s", s.Scene)
	}
}
