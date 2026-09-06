package game

import "math"

// Forward returns the Ebiten-native forward vector for heading.
// heading 0 = north (0, -1); heading increases clockwise.
func Forward(heading float64) (fx, fy float64) {
	return math.Sin(heading), -math.Cos(heading)
}

// Right is the vehicle-right vector. At heading 0: (1, 0) = east.
func Right(heading float64) (rx, ry float64) {
	return math.Cos(heading), math.Sin(heading)
}

// FacingIndex snaps a continuous heading to 16 facings (draw only).
// 0 = north, 4 = east, 8 = south, 12 = west.
func FacingIndex(heading float64) int {
	const step = 2 * math.Pi / 16
	h := math.Mod(heading+step/2, 2*math.Pi)
	if h < 0 {
		h += 2 * math.Pi
	}
	return int(h / step)
}

func wrapHeading(h float64) float64 {
	h = math.Mod(h, 2*math.Pi)
	if h < 0 {
		h += 2 * math.Pi
	}
	return h
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func hypot(x, y float64) float64 {
	return math.Hypot(x, y)
}

func aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh float64) bool {
	return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by
}

func pointInAABB(px, py, x, y, w, h float64) bool {
	return px >= x && px <= x+w && py >= y && py <= y+h
}

// CircleAABB: closest-point clamp, push out along the vector. Spec §13.
func CircleAABB(cx, cy, r, x, y, w, h float64) (nx, ny, pen float64, hit bool) {
	inside := cx > x && cx < x+w && cy > y && cy < y+h
	if inside {
		dl := cx - x
		dr := x + w - cx
		dt := cy - y
		db := y + h - cy
		m := dl
		nx, ny = -1, 0
		if dr < m {
			m = dr
			nx, ny = 1, 0
		}
		if dt < m {
			m = dt
			nx, ny = 0, -1
		}
		if db < m {
			m = db
			nx, ny = 0, 1
		}
		return nx, ny, r + m, true
	}
	closestX := clamp(cx, x, x+w)
	closestY := clamp(cy, y, y+h)
	dx, dy := cx-closestX, cy-closestY
	d2 := dx*dx + dy*dy
	if d2 >= r*r {
		return 0, 0, 0, false
	}
	d := math.Sqrt(d2)
	if d < 1e-6 {
		return 0, -1, r, true
	}
	return dx / d, dy / d, r - d, true
}

func distPointSeg(px, py, x0, y0, x1, y1 float64) float64 {
	vx, vy := x1-x0, y1-y0
	l2 := vx*vx + vy*vy
	t := 0.0
	if l2 > 1e-8 {
		t = clamp(((px-x0)*vx+(py-y0)*vy)/l2, 0, 1)
	}
	dx, dy := px-(x0+t*vx), py-(y0+t*vy)
	return math.Hypot(dx, dy)
}

func bladeAABB(x, y, heading float64, down bool) (bx, by, bw, bh float64) {
	return bladeAABBW(x, y, heading, down, BladeW)
}

func bladeAABBW(x, y, heading float64, down bool, bladeW float64) (bx, by, bw, bh float64) {
	bhBlade := BladeHUp
	if down {
		bhBlade = BladeHDown
	}
	if bladeW <= 0 {
		bladeW = BladeW
	}
	fx, fy := Forward(heading)
	rx, ry := Right(heading)
	minx, miny := math.Inf(1), math.Inf(1)
	maxx, maxy := math.Inf(-1), math.Inf(-1)
	for _, sr := range []float64{-bladeW / 2, bladeW / 2} {
		for _, sf := range []float64{BladeReach - bhBlade/2, BladeReach + bhBlade/2} {
			px := x + rx*sr + fx*sf
			py := y + ry*sr + fy*sf
			if px < minx {
				minx = px
			}
			if py < miny {
				miny = py
			}
			if px > maxx {
				maxx = px
			}
			if py > maxy {
				maxy = py
			}
		}
	}
	return minx, miny, maxx - minx, maxy - miny
}
