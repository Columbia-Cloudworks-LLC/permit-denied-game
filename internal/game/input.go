package game

import (
	"math"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/inpututil"
)

type Input struct {
	Throttle    float64 // -1 reverse … +1 forward
	Steer       float64 // -1 vehicle-left … +1 vehicle-right
	BladeToggle bool    // edge, once per press
	Confirm     bool    // Enter
	Back        bool    // Esc
}

type Probe struct {
	Heading, X, Y, Speed float64
	BladeDown            bool
	Plates               int
	Heat                 float64
}

type tapInfo struct {
	x, y  int
	tick  int
	moved float64
}

func (g *Game) probe() Probe {
	return Probe{
		Heading:   g.dozer.Heading,
		X:         g.dozer.X,
		Y:         g.dozer.Y,
		Speed:     g.dozer.Speed,
		BladeDown: g.dozer.BladeDown,
		Plates:    g.dozer.Plates,
		Heat:      g.dozer.Heat,
	}
}

func (g *Game) readInput() Input {
	if g.harness != nil {
		in := g.harness.in
		in.Confirm = in.Confirm || g.harness.keys.Enter
		in.Back = in.Back || g.harness.keys.Escape
		return in
	}
	var in Input
	left := ebiten.IsKeyPressed(ebiten.KeyA)
	right := ebiten.IsKeyPressed(ebiten.KeyD)
	fwd := ebiten.IsKeyPressed(ebiten.KeyW)
	rev := ebiten.IsKeyPressed(ebiten.KeyS)
	keys := left || right || fwd || rev || inpututil.IsKeyJustPressed(ebiten.KeySpace)

	if left && !right {
		in.Steer = -1
	} else if right && !left {
		in.Steer = 1
	}
	if fwd && !rev {
		in.Throttle = 1
	} else if rev && !fwd {
		in.Throttle = -1
	}
	if inpututil.IsKeyJustPressed(ebiten.KeySpace) {
		in.BladeToggle = true
	}
	if inpututil.IsKeyJustPressed(ebiten.KeyEnter) {
		in.Confirm = true
	}
	if inpututil.IsKeyJustPressed(ebiten.KeyEscape) {
		in.Back = true
	}
	_ = ebiten.KeyR // restart handled in Update via keyJust
	if keys || in.Confirm || in.Back {
		return in
	}
	g.mergeTouch(&in)
	return in
}

func (g *Game) toLogical(px, py int) (float64, float64) {
	ow, oh := g.outsideW, g.outsideH
	if ow < 1 {
		ow = ScreenW
	}
	if oh < 1 {
		oh = ScreenH
	}
	return float64(px) * ScreenW / float64(ow), float64(py) * ScreenH / float64(oh)
}

func (g *Game) mergeTouch(in *Input) {
	ids := ebiten.AppendTouchIDs(nil)
	live := make(map[ebiten.TouchID]struct{}, len(ids))
	for _, id := range ids {
		live[id] = struct{}{}
		x, y := ebiten.TouchPosition(id)
		lx, ly := g.toLogical(x, y)

		if g.taps == nil {
			g.taps = map[ebiten.TouchID]tapInfo{}
		}
		if prev, ok := g.taps[id]; ok {
			dx := float64(x - prev.x)
			dy := float64(y - prev.y)
			moved := prev.moved + math.Hypot(dx, dy)
			g.taps[id] = tapInfo{x: x, y: y, tick: prev.tick, moved: moved}
		} else {
			g.taps[id] = tapInfo{x: x, y: y, tick: g.run.Tick, moved: 0}
		}

		// Tiller: x < 140, y > 80. Vector from pad center to finger = desired heading.
		if lx < 140 && ly > 80 {
			const padX, padY = 70.0, 152.0
			dx, dy := lx-padX, ly-padY
			if math.Hypot(dx, dy) >= TillerDeadzone {
				desired := math.Atan2(dx, -dy)
				err := desired - g.dozer.Heading
				for err > math.Pi {
					err -= 2 * math.Pi
				}
				for err < -math.Pi {
					err += 2 * math.Pi
				}
				in.Steer = clamp(err/0.6, -1, 1)
			}
			continue
		}

		// Throttle: x > 180, y > 80. Finger Y relative to touch-down.
		if lx > 180 && ly > 80 {
			if !g.throttleOn || g.throttleID != id {
				g.throttleOn = true
				g.throttleID = id
				g.throttleY0 = ly
			}
			if g.throttleID == id {
				delta := g.throttleY0 - ly // up (smaller Y) = forward
				in.Throttle = clamp(delta/ThrottleTravel, -1, 1)
			}
		}
	}

	// Release: throttle 0. Blade tap: right zone, move < 12 px and duration < 200 ms.
	if g.throttleOn {
		if _, ok := live[g.throttleID]; !ok {
			info := g.taps[g.throttleID]
			dur := float64(g.run.Tick-info.tick) * Dt
			lx, _ := g.toLogical(info.x, info.y)
			if info.moved < TapMoveMax && dur < TapDurMax && dur >= 0 && lx > 180 {
				in.BladeToggle = true
			}
			g.throttleOn = false
		}
	}
	for id := range g.taps {
		if _, ok := live[id]; !ok {
			delete(g.taps, id)
		}
	}
}
