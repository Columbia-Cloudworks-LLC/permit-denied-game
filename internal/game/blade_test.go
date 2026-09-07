package game

import (
	"math"
	"testing"

	"permitdenied/internal/lot"
)

func TestBladeCornersCardinal(t *testing.T) {
	p := BladePose{X: 100, Y: 100, Heading: 0, Width: BladeW, Thick: BladeHDown, Reach: BladeReach}
	c := BladeCorners(p)
	// Heading 0 = north: blade is north of body, width along X.
	var minx, maxx, miny, maxy float64
	minx, maxx = c[0][0], c[0][0]
	miny, maxy = c[0][1], c[0][1]
	for _, pt := range c {
		if pt[0] < minx {
			minx = pt[0]
		}
		if pt[0] > maxx {
			maxx = pt[0]
		}
		if pt[1] < miny {
			miny = pt[1]
		}
		if pt[1] > maxy {
			maxy = pt[1]
		}
	}
	if math.Abs((maxx-minx)-BladeW) > 0.5 {
		t.Fatalf("north blade width %v want ~%v", maxx-minx, BladeW)
	}
	if maxy > 100 {
		t.Fatalf("north blade should be above (south-of) body in -Y; maxy=%v", maxy)
	}
}

func TestQueryBladeHitsSouthWallOnly(t *testing.T) {
	s := lot.LabBrickMunicipal()
	// Pose south of building, heading north into south façade.
	wx, wy := s.WorldXY(2, s.H-1)
	p := BladePose{
		X: wx + lot.Tile/2, Y: wy + lot.Tile + BladeReach,
		Heading: 0, Width: BladeW, Thick: BladeHDown, Reach: BladeReach,
	}
	hits := QueryBlade(p, &s, SpeedFwdDown)
	if len(hits) == 0 {
		t.Fatal("expected south-wall hits")
	}
	for _, h := range hits {
		if h.Row != s.H-1 {
			t.Fatalf("hit non-south cell %d,%d", h.Col, h.Row)
		}
	}
}

func TestDiagonalOBBDoesNotOverSelect(t *testing.T) {
	// One solid wall cell at tile (0,0) world origin; decoy cell far NE that world-AABB would catch.
	cells := make([]lot.Cell, 4)
	cells[0] = lot.Cell{Kind: lot.KindWall, Mat: lot.MatBrick, HP: 10, MaxHP: 10, State: lot.Intact}
	cells[1] = lot.Cell{Kind: lot.KindWall, Mat: lot.MatBrick, HP: 10, MaxHP: 10, State: lot.Intact}
	cells[2] = lot.Cell{Kind: lot.KindNone, State: lot.Empty}
	cells[3] = lot.Cell{Kind: lot.KindNone, State: lot.Empty}
	s := lot.Structure{Label: "T", TX: 0, TY: 0, W: 2, H: 2, Cells: cells}

	// Blade at 45°, positioned to touch only cell (0,0).
	heading := math.Pi / 4
	p := BladePose{
		X: 8, Y: 8 + BladeReach, Heading: heading,
		Width: BladeW, Thick: BladeHDown, Reach: BladeReach,
	}
	// Place dozer so OBB grazes (0,0) only: south-west of cell.
	p.X = -4
	p.Y = 20
	p.Heading = 0 // first prove cardinal: heading north from south of cell 0,0 only
	hits := QueryBlade(p, &s, 0)
	for _, h := range hits {
		if h.Col == 1 && h.Row == 0 {
			t.Fatalf("cardinal over-selected decoy %v", hits)
		}
	}

	// Diagonal: build world AABB and OBB against a single cell at origin and a far cell.
	p = BladePose{X: 8, Y: 22, Heading: math.Pi / 4, Width: 32, Thick: 10, Reach: 18}
	corners := BladeCorners(p)
	obbHit0, _ := OBBOverlapsAABB(corners, 0, 0, 16, 16)
	obbHitFar, _ := OBBOverlapsAABB(corners, 48, 0, 16, 16)

	bx, by, bw, bh := bladeAABBW(p.X, p.Y, p.Heading, true, p.Width)
	aabbHit0 := aabbOverlap(bx, by, bw, bh, 0, 0, 16, 16)
	aabbHitFar := aabbOverlap(bx, by, bw, bh, 48, 0, 16, 16)

	if !obbHit0 {
		// May miss depending on pose; require the inequality vs AABB at least once.
		t.Logf("obb missed origin cell; aabb0=%v", aabbHit0)
	}
	// Critical: when AABB over-selects the far cell, OBB must not.
	if aabbHitFar && obbHitFar {
		t.Fatalf("both AABB and OBB hit far cell — pose does not demonstrate over-select")
	}
	if aabbHitFar && !obbHitFar {
		return // success: world AABB over-selected, OBB did not
	}
	if aabbHit0 && !obbHit0 {
		t.Fatal("OBB missed a cell the AABB hit at the contact pose")
	}
	// Reposition until we find a diagonal pose where AABB hits far and OBB does not.
	found := false
	for _, ox := range []float64{0, 8, 16, 24, 32} {
		for _, oy := range []float64{16, 20, 24, 28, 32} {
			p = BladePose{X: ox, Y: oy, Heading: math.Pi / 4, Width: 32, Thick: 10, Reach: 18}
			corners = BladeCorners(p)
			obb0, _ := OBBOverlapsAABB(corners, 0, 0, 16, 16)
			obbF, _ := OBBOverlapsAABB(corners, 40, -8, 16, 16)
			bx, by, bw, bh = bladeAABBW(p.X, p.Y, p.Heading, true, p.Width)
			a0 := aabbOverlap(bx, by, bw, bh, 0, 0, 16, 16)
			aF := aabbOverlap(bx, by, bw, bh, 40, -8, 16, 16)
			if aF && !obbF && (a0 || obb0) {
				found = true
				break
			}
			_ = a0
			_ = obb0
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("could not find diagonal pose where world AABB over-selects vs OBB")
	}
}

func TestScrapeVsRamCellCount(t *testing.T) {
	s := lot.LabBrickMunicipal()
	wx, wy := s.WorldXY(0, s.H-1) // SW corner wall
	// Scrape: blade barely overlapping west edge of south wall, heading north.
	scrape := BladePose{
		X: wx - 4, Y: wy + lot.Tile + BladeReach,
		Heading: 0, Width: BladeW, Thick: BladeHDown, Reach: BladeReach,
	}
	scrapeHits := QueryBlade(scrape, &s, SpeedFwdDown)

	// Ram: centered on south façade.
	cx, _ := s.WorldXY(s.W/2, s.H-1)
	ram := BladePose{
		X: cx + lot.Tile/2, Y: wy + lot.Tile + BladeReach,
		Heading: 0, Width: BladeW, Thick: BladeHDown, Reach: BladeReach,
	}
	ramHits := QueryBlade(ram, &s, SpeedFwdDown)
	if len(ramHits) <= len(scrapeHits) {
		t.Fatalf("ram hits %d should exceed scrape hits %d", len(ramHits), len(scrapeHits))
	}
}
