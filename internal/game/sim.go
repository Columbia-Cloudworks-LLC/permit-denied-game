package game

import (
	"math"

	"permitdenied/internal/lot"
)

type aabb struct {
	x, y, w, h float64
}

func (g *Game) stepPlay(in Input) {
	g.run.Tick++
	if g.run.Tick >= BuzzerTick {
		g.endRun("buzzer")
		return
	}

	if g.dozer.IFrames > 0 {
		g.dozer.IFrames--
	}

	g.integrateDozer(in)
	if in.BladeToggle {
		g.dozer.BladeDown = !g.dozer.BladeDown
	}

	solids := g.collectSolids()
	stalled, overlapping := g.resolveDozer(solids)

	bx, by, bw, bh := bladeAABBW(g.dozer.X, g.dozer.Y, g.dozer.Heading, g.dozer.BladeDown, BladeW)
	bladeHitSolid := false
	deepRubble := false
	for _, s := range solids {
		if aabbOverlap(bx, by, bw, bh, s.x, s.y, s.w, s.h) {
			bladeHitSolid = true
		}
	}
	for _, s := range g.lot.CollectSolids() {
		if s.Rubble && s.W*s.H >= DeepRubbleA*0.25 {
			if _, _, _, hit := CircleAABB(g.dozer.X, g.dozer.Y, DozerBodyR, s.X, s.Y, s.W, s.H); hit {
				deepRubble = true
			}
		}
	}

	if g.dozer.BladeDown {
		g.glanceLatch = false
		eating := g.wreckWithBlade()
		if g.audio != nil {
			g.audio.DuckWreck(eating)
		}
	} else {
		g.glanceCells()
		if g.audio != nil {
			g.audio.DuckWreck(false)
		}
	}

	for _, br := range g.lot.CollapseTick() {
		g.onCellBreak(br)
	}
	g.stepCollapseWarn()

	g.stepHeat(stalled, overlapping, bladeHitSolid, deepRubble)
	g.stepCruiser(bx, by, bw, bh)

	if g.checkDeath() {
		return
	}
	g.stepImmobilize(stalled, overlapping)
	if g.run.Over {
		return
	}

	g.fx.Step(Dt, ShakeDecay)
}

func (g *Game) integrateDozer(in Input) {
	turn := TurnRateBladeUp
	if g.dozer.BladeDown {
		turn = TurnRateBladeDown
	}
	g.dozer.Heading = wrapHeading(g.dozer.Heading + in.Steer*turn*Dt)

	max := SpeedFwdUp
	if in.Throttle < 0 {
		max = SpeedRevUp
		if g.dozer.BladeDown {
			max = SpeedRevDown
		}
	} else if g.dozer.BladeDown {
		max = SpeedFwdDown
	}
	target := max * in.Throttle
	g.dozer.Speed = g.approachSpeed(g.dozer.Speed, target)

	fx, fy := Forward(g.dozer.Heading)
	g.dozer.X += fx * g.dozer.Speed * Dt
	g.dozer.Y += fy * g.dozer.Speed * Dt
}

func (g *Game) approachSpeed(cur, target float64) float64 {
	if target > cur {
		cur += AccelFwd * Dt
		if cur > target {
			cur = target
		}
		return cur
	}
	if target < cur {
		rate := AccelBrake
		if target < 0 || cur < 0 {
			rate = AccelRev
		}
		cur -= rate * Dt
		if cur < target {
			cur = target
		}
		return cur
	}
	return cur
}

func (g *Game) collectSolids() []aabb {
	raw := g.lot.CollectSolids()
	out := make([]aabb, 0, len(raw))
	for _, s := range raw {
		out = append(out, aabb{s.X, s.Y, s.W, s.H})
	}
	if g.cruiser.Alive {
		out = append(out, aabb{
			g.cruiser.X - CruiserRadius, g.cruiser.Y - CruiserRadius,
			CruiserRadius * 2, CruiserRadius * 2,
		})
	}
	return out
}

func (g *Game) resolveDozer(solids []aabb) (stalled, overlapping bool) {
	overlapping = false
	for iter := 0; iter < 3; iter++ {
		hitAny := false
		for _, s := range solids {
			nx, ny, pen, hit := CircleAABB(g.dozer.X, g.dozer.Y, DozerBodyR, s.x, s.y, s.w, s.h)
			if !hit {
				continue
			}
			hitAny = true
			overlapping = true
			g.dozer.X += nx * pen
			g.dozer.Y += ny * pen
			fx, fy := Forward(g.dozer.Heading)
			along := g.dozer.Speed * (fx*nx + fy*ny)
			if along > 0 {
				g.dozer.Speed -= along
			}
		}
		if !hitAny {
			break
		}
	}
	g.dozer.X = clamp(g.dozer.X, DozerBodyR, LotW-DozerBodyR)
	g.dozer.Y = clamp(g.dozer.Y, DozerBodyR, LotH-DozerBodyR)
	stalled = overlapping && math.Abs(g.dozer.Speed) < StallSpeed
	return stalled, overlapping
}

func (g *Game) stepHeat(stalled, overlapping, bladeHit, deepRubble bool) {
	d := &g.dozer
	if d.BladeDown && (bladeHit || deepRubble) {
		d.Heat += HeatCookPush * Dt
	} else if stalled {
		d.Heat += HeatCookStall * Dt
	} else if !d.BladeDown && !overlapping {
		d.Heat -= HeatCoolAsphalt * Dt
	} else {
		d.Heat -= HeatCoolIdle * Dt
	}
	d.Heat = clamp(d.Heat, 0, HeatMax)
}

func (g *Game) checkDeath() bool {
	if g.dozer.Heat >= HeatMax {
		g.endRun("cooked")
		return true
	}
	if g.dozer.Plates <= 0 {
		g.endRun("track")
		return true
	}
	return false
}

func (g *Game) stepImmobilize(stalled, overlapping bool) {
	if stalled && !g.dozer.BladeDown && overlapping {
		g.stallTicks++
		if g.stallTicks > int(2.5*TPS) {
			g.endRun("pinned")
		}
	} else {
		g.stallTicks = 0
	}
}

func (g *Game) endRun(reason string) {
	g.run.Over = true
	g.run.Death = deathLabel(reason)
	g.run.TimeAlive = g.run.Time()
	g.scene = SceneTally
	g.fx.TallyT = 0
	if g.audio != nil {
		g.audio.Stop()
	}
}

func deathLabel(reason string) string {
	switch reason {
	case "cooked":
		return "ENGINE COOKED"
	case "track":
		return "TRACK THROWN"
	case "buzzer":
		return "COUNTY CLOCK"
	case "pinned":
		return "PINNED"
	default:
		return reason
	}
}

func (g *Game) peel() {
	if g.dozer.IFrames > 0 {
		return
	}
	g.dozer.Plates--
	g.dozer.IFrames = IFramesPeel
	g.fx.Shake = ShakeOnBreak
	if g.audio != nil {
		g.audio.Peel()
	}
}

// wreckWithBlade damages cells overlapped by the oriented blade OBB.
func (g *Game) wreckWithBlade() bool {
	eating := false
	pose := BladePose{
		X: g.dozer.X, Y: g.dozer.Y, Heading: g.dozer.Heading,
		Width: BladeW, Thick: BladeHDown, Reach: BladeReach,
	}
	var all []lot.Impact
	for si := range g.lot.Structures {
		s := &g.lot.Structures[si]
		imps := QueryBlade(pose, s, g.dozer.Speed)
		if len(imps) == 0 {
			continue
		}
		eating = true
		all = append(all, imps...)
		for _, im := range imps {
			c := s.At(im.Col, im.Row)
			if c != nil && c.State == lot.Cracked {
				wx, wy := s.WorldXY(im.Col, im.Row)
				g.fx.SpawnSpark(wx+8, wy+8)
			}
		}
		for _, br := range s.ApplyImpacts(imps) {
			cb := lot.CellBreak{
				Struct: si, LX: br.Col, LY: br.Row,
				WX: br.X, WY: br.Y,
				Mat: br.Mat, Kind: br.Kind, Cash: br.Cash,
				FromBlade: true, DirX: br.DirX, DirY: br.DirY,
			}
			if cb.WX == 0 && cb.WY == 0 {
				wx, wy := s.WorldXY(br.Col, br.Row)
				cb.WX, cb.WY = wx+lot.Tile/2, wy+lot.Tile/2
			}
			g.onCellBreak(cb)
		}
	}
	g.labImpacts = all
	return eating
}

func (g *Game) glanceCells() {
	if g.glanceLatch {
		return
	}
	dmg := WreckRateUp * Dt
	hit := false
	for si := range g.lot.Structures {
		s := &g.lot.Structures[si]
		for i := range s.Cells {
			c := &s.Cells[i]
			if !c.Solid() || c.State == lot.Rubble {
				continue
			}
			lx, ly := s.Index(i)
			wx, wy := s.WorldXY(lx, ly)
			if _, _, _, ok := CircleAABB(g.dozer.X, g.dozer.Y, DozerBodyR, wx, wy, lot.Tile, lot.Tile); !ok {
				continue
			}
			hit = true
			s.ApplyDamage(lx, ly, dmg)
			g.dozer.Speed *= 0.85
			g.fx.SpawnSpark(wx+8, wy+8)
		}
	}
	g.glanceLatch = hit
}

func (g *Game) onCellBreak(br lot.CellBreak) {
	g.run.StructCash += br.Cash
	g.run.Hunting = true
	collapse := br.Collapse || (!br.FromBlade && (br.Kind == lot.KindRoof || br.Kind == lot.KindEdge))
	tr, tg, tb := dustTint(br.Mat)
	spread := float64(br.LX) * 0.3
	if br.DirX != 0 || br.DirY != 0 {
		spread = math.Atan2(br.DirY, br.DirX)
	}
	if collapse {
		g.fx.HitStop = HitStopCollapse
		g.fx.Shake = ShakeOnCollapse
		g.fx.SpawnDollar(br.WX, br.WY, br.Cash, DollarLife)
		g.fx.SpawnDustTinted(br.WX, br.WY, 2.6, tr, tg, tb, 36)
		g.fx.SpawnDustTinted(br.WX+6, br.WY-4, 1.8, tr, tg, tb, 28)
		g.fx.SpawnFlash(br.WX, br.WY)
		g.fx.SpawnBoom(br.WX, br.WY)
		n := fragCount(br.Mat) + 4
		g.fx.SpawnFragmentsScale(br.WX, br.WY, int(br.Mat), n, spread, 1.7)
		g.fx.SpawnScar(br.WX, br.WY, 1)
		if g.audio != nil {
			g.audio.Collapse()
		}
		return
	}
	g.fx.HitStop = HitStopTicks
	g.fx.Shake = ShakeOnBreak
	g.fx.SpawnDollar(br.WX, br.WY, br.Cash, DollarLife)
	scale := 1.0
	frags := fragCount(br.Mat)
	switch br.Mat {
	case lot.MatGlass:
		scale = 0.85
		frags += 3
		g.fx.SpawnDustTinted(br.WX, br.WY, 1.0, tr, tg, tb, 16)
	case lot.MatWood:
		g.fx.SpawnDustTinted(br.WX, br.WY, 1.15, tr, tg, tb, 20)
	case lot.MatSteel:
		g.fx.SpawnSpark(br.WX, br.WY)
		g.fx.SpawnDustTinted(br.WX, br.WY, 0.9, tr, tg, tb, 14)
	default:
		g.fx.SpawnDustTinted(br.WX, br.WY, 1.2, tr, tg, tb, 22)
	}
	g.fx.SpawnFlash(br.WX, br.WY)
	if br.Mat != lot.MatGlass {
		g.fx.SpawnBoom(br.WX, br.WY)
	} else {
		g.fx.SpawnSpark(br.WX, br.WY)
	}
	g.fx.SpawnFragmentsScale(br.WX, br.WY, int(br.Mat), frags, spread, scale)
	scarKind := 1
	if br.Mat == lot.MatGlass {
		scarKind = 2
	}
	g.fx.SpawnScar(br.WX, br.WY, scarKind)
	if g.audio != nil {
		g.audio.WreckMat(int(br.Mat))
	}
}

func dustTint(m lot.Material) (float32, float32, float32) {
	switch m {
	case lot.MatWood:
		return 0.75, 0.55, 0.35
	case lot.MatBrick:
		return 0.85, 0.45, 0.38
	case lot.MatGlass:
		return 0.70, 0.85, 0.90
	case lot.MatSteel:
		return 0.65, 0.70, 0.75
	default:
		return 0.72, 0.72, 0.68
	}
}

func (g *Game) stepCollapseWarn() {
	for si := range g.lot.Structures {
		s := &g.lot.Structures[si]
		for _, p := range s.FallStarts {
			c := s.At(p[0], p[1])
			if c == nil {
				continue
			}
			wx, wy := s.WorldXY(p[0], p[1])
			tr, tg, tb := dustTint(c.Mat)
			g.fx.Shake = math.Max(g.fx.Shake, ShakeOnWarn*2)
			g.fx.SpawnDustTinted(wx+8, wy+8, 1.6, tr, tg, tb, 22)
			if g.audio != nil {
				g.audio.Groan()
			}
		}
		if g.run.Tick%10 != 0 {
			continue
		}
		for i := range s.Cells {
			c := &s.Cells[i]
			if !c.IsDeck() || c.Sag <= 0 || c.Falling {
				continue
			}
			lx, ly := s.Index(i)
			wx, wy := s.WorldXY(lx, ly)
			tr, tg, tb := dustTint(c.Mat)
			g.fx.SpawnDustTinted(wx+8, wy+4, 0.7, tr, tg, tb, 14)
			if g.fx.Shake < ShakeOnWarn {
				g.fx.Shake = ShakeOnWarn
			}
		}
	}
}

func fragCount(m lot.Material) int {
	switch m {
	case lot.MatWood:
		return FragCountWood
	case lot.MatBrick:
		return FragCountBrick
	case lot.MatConcrete:
		return FragCountConcrete
	case lot.MatGlass:
		return FragCountGlass
	case lot.MatSteel:
		return FragCountSteel
	default:
		return 5
	}
}

func (g *Game) stepCruiser(bx, by, bw, bh float64) {
	c := &g.cruiser
	if !c.Alive {
		return
	}
	if !g.run.Hunting {
		return
	}
	dx := g.dozer.X - c.X
	dy := g.dozer.Y - c.Y
	dist := math.Hypot(dx, dy)
	if dist > 1 {
		c.Heading = math.Atan2(dx, -dy)
		c.X += math.Sin(c.Heading) * CruiserSpeed * Dt
		c.Y += -math.Cos(c.Heading) * CruiserSpeed * Dt
	}
	c.X = clamp(c.X, CruiserRadius, LotW-CruiserRadius)
	c.Y = clamp(c.Y, CruiserRadius, LotH-CruiserRadius)

	if g.dozer.BladeDown && aabbOverlap(bx, by, bw, bh, c.X-CruiserRadius, c.Y-CruiserRadius, CruiserRadius*2, CruiserRadius*2) {
		c.Alive = false
		g.run.VehicleCash += CruiserKillCash
		g.fx.SpawnDollar(c.X, c.Y, CruiserKillCash, DollarLife)
		g.fx.SpawnBoom(c.X, c.Y)
		g.fx.HitStop = HitStopTicks
		g.fx.Shake = ShakeOnBreak
		if g.audio != nil {
			g.audio.Burst()
		}
		return
	}

	if g.dozer.IFrames > 0 {
		return
	}
	if _, _, _, hit := CircleAABB(g.dozer.X, g.dozer.Y, DozerBodyR, c.X-CruiserRadius, c.Y-CruiserRadius, CruiserRadius*2, CruiserRadius*2); !hit {
		return
	}
	fx, fy := Forward(g.dozer.Heading)
	along := (c.X-g.dozer.X)*fx + (c.Y-g.dozer.Y)*fy
	if along > FrontAlong && g.dozer.BladeDown {
		return // frontal brace
	}
	if !g.dozer.BladeDown {
		g.peel()
	}
}
