package game

import (
	"math"

	"permitdenied/internal/lot"
)

// BladePose is the oriented blade rectangle in world space.
type BladePose struct {
	X, Y, Heading, Width, Thick, Reach float64
}

// BladeCorners returns the four world corners of the blade OBB
// (same construction as bladeAABBW, without the world AABB collapse).
func BladeCorners(p BladePose) [4][2]float64 {
	if p.Width <= 0 {
		p.Width = BladeW
	}
	if p.Thick <= 0 {
		p.Thick = BladeHDown
	}
	if p.Reach <= 0 {
		p.Reach = BladeReach
	}
	fx, fy := Forward(p.Heading)
	rx, ry := Right(p.Heading)
	var out [4][2]float64
	i := 0
	for _, sr := range []float64{-p.Width / 2, p.Width / 2} {
		for _, sf := range []float64{p.Reach - p.Thick/2, p.Reach + p.Thick/2} {
			out[i][0] = p.X + rx*sr + fx*sf
			out[i][1] = p.Y + ry*sr + fy*sf
			i++
		}
	}
	return out
}

// OBBOverlapsAABB tests an oriented blade against a cell AABB via SAT.
// depth is penetration along the best separating axis, divided by blade thick, clamped 0..1.
func OBBOverlapsAABB(corners [4][2]float64, x, y, w, h float64) (hit bool, depth float64) {
	// AABB corners.
	aabb := [4][2]float64{
		{x, y},
		{x + w, y},
		{x + w, y + h},
		{x, y + h},
	}
	axes := [4][2]float64{
		{1, 0},
		{0, 1},
		normalize2(corners[1][0]-corners[0][0], corners[1][1]-corners[0][1]),
		normalize2(corners[2][0]-corners[0][0], corners[2][1]-corners[0][1]),
	}
	// Prefer blade edge axes; if corners are degenerate fall back to world axes only.
	if axes[2][0] == 0 && axes[2][1] == 0 {
		axes[2] = [2]float64{1, 0}
	}
	if axes[3][0] == 0 && axes[3][1] == 0 {
		axes[3] = [2]float64{0, 1}
	}
	minOverlap := math.Inf(1)
	for _, axis := range axes {
		minA, maxA := projectCorners(corners[:], axis[0], axis[1])
		minB, maxB := projectCorners(aabb[:], axis[0], axis[1])
		if maxA < minB || maxB < minA {
			return false, 0
		}
		overlap := math.Min(maxA, maxB) - math.Max(minA, minB)
		if overlap < minOverlap {
			minOverlap = overlap
		}
	}
	// Approximate thick from corner span along forward-ish axis.
	thick := hypot(corners[1][0]-corners[0][0], corners[1][1]-corners[0][1])
	if thick < 1e-6 {
		thick = BladeHDown
	}
	d := minOverlap / thick
	if d > 1 {
		d = 1
	}
	if d < 0 {
		d = 0
	}
	return true, d
}

func projectCorners(pts [][2]float64, ax, ay float64) (min, max float64) {
	min = math.Inf(1)
	max = math.Inf(-1)
	for _, p := range pts {
		v := p[0]*ax + p[1]*ay
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}
	return min, max
}

func normalize2(x, y float64) [2]float64 {
	l := math.Hypot(x, y)
	if l < 1e-8 {
		return [2]float64{0, 0}
	}
	return [2]float64{x / l, y / l}
}

// QueryBlade returns one Impact per solid cell overlapped by the oriented blade.
func QueryBlade(p BladePose, s *lot.Structure, speed float64) []lot.Impact {
	if s == nil {
		return nil
	}
	corners := BladeCorners(p)
	fx, fy := Forward(p.Heading)
	rx, ry := Right(p.Heading)
	dirX, dirY := fx, fy
	if speed < 0 {
		dirX, dirY = -fx, -fy
	}
	// Front edge segment at Reach+Thick/2.
	thick := p.Thick
	if thick <= 0 {
		thick = BladeHDown
	}
	width := p.Width
	if width <= 0 {
		width = BladeW
	}
	reach := p.Reach
	if reach <= 0 {
		reach = BladeReach
	}
	front := reach + thick/2
	x0 := p.X + rx*(-width/2) + fx*front
	y0 := p.Y + ry*(-width/2) + fy*front
	x1 := p.X + rx*(width/2) + fx*front
	y1 := p.Y + ry*(width/2) + fy*front

	// Broadphase: structure footprint padded by blade diagonal.
	pad := width + thick + reach
	sx0 := float64(s.TX * lot.Tile)
	sy0 := float64(s.TY * lot.Tile)
	sx1 := float64((s.TX + s.W) * lot.Tile)
	sy1 := float64((s.TY + s.H) * lot.Tile)
	minx, miny := math.Inf(1), math.Inf(1)
	maxx, maxy := math.Inf(-1), math.Inf(-1)
	for _, c := range corners {
		if c[0] < minx {
			minx = c[0]
		}
		if c[1] < miny {
			miny = c[1]
		}
		if c[0] > maxx {
			maxx = c[0]
		}
		if c[1] > maxy {
			maxy = c[1]
		}
	}
	if maxx < sx0-pad || minx > sx1+pad || maxy < sy0-pad || miny > sy1+pad {
		return nil
	}

	speedTerm := 1.0
	if math.Abs(speed) >= StallSpeed {
		speedTerm = 1 + math.Abs(speed)/SpeedFwdDown
	}

	var out []lot.Impact
	for i := range s.Cells {
		c := &s.Cells[i]
		if !c.Solid() || c.State == lot.Rubble {
			continue
		}
		lx, ly := s.Index(i)
		wx, wy := s.WorldXY(lx, ly)
		hit, depth := OBBOverlapsAABB(corners, wx, wy, lot.Tile, lot.Tile)
		if !hit {
			continue
		}
		ccx, ccy := wx+lot.Tile/2, wy+lot.Tile/2
		cx, cy, onEdge := closestOnSegment(x0, y0, x1, y1, ccx, ccy)
		if !onEdge {
			// Fallback: overlap centroid approximation = cell center clamped into blade AABB envelope.
			cx, cy = ccx, ccy
		}
		// BladeT along right axis of front segment.
		bladeT := 0.5
		segLen := math.Hypot(x1-x0, y1-y0)
		if segLen > 1e-6 {
			bladeT = clamp(((cx-x0)*(x1-x0)+(cy-y0)*(y1-y0))/(segLen*segLen), 0, 1)
		}
		force := WreckRateDown * Dt * (0.5 + 0.5*depth) * speedTerm
		out = append(out, lot.Impact{
			Col: lx, Row: ly,
			X: cx, Y: cy,
			DirX: dirX, DirY: dirY,
			Heading: p.Heading,
			Speed:   speed,
			Force:   force,
			BladeT:  bladeT,
			Depth:   depth,
		})
	}
	return out
}

func closestOnSegment(x0, y0, x1, y1, px, py float64) (cx, cy float64, onSeg bool) {
	vx, vy := x1-x0, y1-y0
	l2 := vx*vx + vy*vy
	if l2 < 1e-12 {
		return x0, y0, false
	}
	t := ((px-x0)*vx + (py-y0)*vy) / l2
	onSeg = t >= 0 && t <= 1
	t = clamp(t, 0, 1)
	return x0 + t*vx, y0 + t*vy, onSeg
}
