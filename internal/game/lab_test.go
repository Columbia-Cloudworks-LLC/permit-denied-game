package game

import (
	"math"
	"testing"

	"permitdenied/internal/lot"
)

func TestLabStartAndReset(t *testing.T) {
	g := New()
	g.Silence()
	g.startLab()
	if g.scene != SceneLab {
		t.Fatalf("scene %v", g.scene)
	}
	if g.Snapshot().Scene != "lab" {
		t.Fatalf("snapshot scene %q", g.Snapshot().Scene)
	}
	if len(g.lot.Structures) != 1 {
		t.Fatal("want one structure")
	}
	x0, y0 := g.dozer.X, g.dozer.Y
	g.dozer.X += 10
	g.resetLab()
	if math.Abs(g.dozer.X-x0) > 1 || math.Abs(g.dozer.Y-y0) > 1 {
		t.Fatalf("reset pose %v,%v want %v,%v", g.dozer.X, g.dozer.Y, x0, y0)
	}
}

func TestLabSouthBiteOpensCells(t *testing.T) {
	g := New()
	g.Silence()
	g.startLab()
	s := g.labStructure()
	g.dozer.BladeDown = true
	g.dozer.Speed = SpeedFwdDown
	for i := 0; i < 180; i++ {
		g.stepLab(Input{Throttle: 1})
	}
	opens := 0
	for i := range s.Cells {
		c := &s.Cells[i]
		if c.Kind == lot.KindNone || c.State == lot.Empty {
			opens++
		}
	}
	if opens == 0 && len(s.Spill) == 0 {
		t.Fatalf("expected openings or spill after ram; solids=%d", g.lot.IntactSolidCount())
	}
	snap := g.Snapshot()
	if snap.OpenCells == 0 && snap.SpillCount == 0 {
		t.Fatalf("snapshot open=%d spill=%d", snap.OpenCells, snap.SpillCount)
	}
}

func TestLabFourPosesDeterministic(t *testing.T) {
	runPose := func(pose func(*Game)) string {
		g := New()
		g.Silence()
		g.startLab()
		pose(g)
		g.dozer.BladeDown = true
		for i := 0; i < 120; i++ {
			g.stepLab(Input{Throttle: 1})
		}
		for i := 0; i < 90; i++ {
			g.stepLab(Input{})
		}
		s := g.labStructure()
		key := ""
		for i := range s.Cells {
			c := &s.Cells[i]
			if c.Kind == lot.KindNone || c.State == lot.Broken || c.State == lot.Rubble || c.State == lot.Empty {
				lx, ly := s.Index(i)
				key += string(rune('a'+lx)) + string(rune('0'+ly)) + ";"
			}
		}
		key += string(rune('0' + len(s.Spill)))
		return key
	}
	s := runPose((*Game).poseLabSouth)
	n := runPose((*Game).poseLabNorth)
	e := runPose((*Game).poseLabEast)
	w := runPose((*Game).poseLabWest)
	keys := []string{s, n, e, w}
	for i := 0; i < 4; i++ {
		for j := i + 1; j < 4; j++ {
			if keys[i] == keys[j] && keys[i] != "" {
				t.Fatalf("poses %d and %d identical key %q", i, j, keys[i])
			}
		}
	}
	s2 := runPose((*Game).poseLabSouth)
	if s != s2 {
		t.Fatalf("south not deterministic\n%s\n%s", s, s2)
	}
}

func TestLabDriveThroughOpening(t *testing.T) {
	g := New()
	g.Silence()
	g.startLab()
	s := g.labStructure()
	for x := 1; x < s.W-1; x++ {
		s.ApplyImpacts([]lot.Impact{{
			Col: x, Row: s.H - 1, DirX: 0, DirY: 1, Force: 999,
		}})
	}
	wx, wy := s.WorldXY(s.W/2, s.H-1)
	g.dozer.X = wx + lot.Tile/2
	g.dozer.Y = wy + lot.Tile/2
	g.dozer.Heading = 0
	g.dozer.BladeDown = false
	solids := g.collectSolids()
	blocked := false
	for _, sol := range solids {
		if _, _, _, hit := CircleAABB(g.dozer.X, g.dozer.Y, DozerBodyR, sol.x, sol.y, sol.w, sol.h); hit {
			if sol.y < wy+lot.Tile && sol.y+sol.h > wy && sol.x < g.dozer.X+1 && sol.x+sol.w > g.dozer.X-1 {
				if sol.w >= lot.Tile-0.1 && sol.h >= lot.Tile-0.1 {
					blocked = true
				}
			}
		}
	}
	if blocked {
		t.Fatal("full wall cell still blocking opening")
	}
}
