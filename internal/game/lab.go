package game

import (
	"math"

	"github.com/hajimehoshi/ebiten/v2"
	"permitdenied/internal/dozer"
	"permitdenied/internal/fx"
	"permitdenied/internal/lot"
	"permitdenied/internal/run"
	"permitdenied/internal/threats"
)

// startLab boots the destruction laboratory (one brick municipal, no cruiser).
func (g *Game) startLab() {
	g.scene = SceneLab
	g.run = run.New()
	g.fx = fx.FX{}
	g.lot = lot.NewLabLot()
	g.cruiser = threats.Cruiser{}
	g.stallTicks = 0
	g.glanceLatch = false
	g.labImpacts = nil
	g.labPaused = false
	g.labSlow = false
	g.labSlowPhase = false
	g.poseLabSouth()
}

func (g *Game) resetLab() {
	blade := true
	if g.scene == SceneLab {
		blade = g.dozer.BladeDown
	}
	g.startLab()
	g.dozer.BladeDown = blade
}

func (g *Game) poseLabSouth() {
	s := g.labStructure()
	if s == nil {
		return
	}
	wx, wy := s.WorldXY(s.W/2, s.H-1)
	g.dozer = dozer.Spawn(wx+lot.Tile/2, wy+lot.Tile+DozerBodyR+BladeReach+4)
	g.dozer.Heading = 0
	g.dozer.BladeDown = true
}

func (g *Game) poseLabNorth() {
	s := g.labStructure()
	if s == nil {
		return
	}
	wx, wy := s.WorldXY(s.W/2, 0)
	g.dozer = dozer.Spawn(wx+lot.Tile/2, wy-DozerBodyR-BladeReach-4)
	g.dozer.Heading = math.Pi
	g.dozer.BladeDown = true
}

func (g *Game) poseLabEast() {
	s := g.labStructure()
	if s == nil {
		return
	}
	wx, wy := s.WorldXY(s.W-1, s.H/2)
	g.dozer = dozer.Spawn(wx+lot.Tile+DozerBodyR+BladeReach+4, wy+lot.Tile/2)
	g.dozer.Heading = wrapHeading(-math.Pi / 2)
	g.dozer.BladeDown = true
}

func (g *Game) poseLabWest() {
	s := g.labStructure()
	if s == nil {
		return
	}
	wx, wy := s.WorldXY(0, s.H/2)
	g.dozer = dozer.Spawn(wx-DozerBodyR-BladeReach-4, wy+lot.Tile/2)
	g.dozer.Heading = math.Pi / 2
	g.dozer.BladeDown = true
}

func (g *Game) labStructure() *lot.Structure {
	if len(g.lot.Structures) == 0 {
		return nil
	}
	return &g.lot.Structures[0]
}

func (g *Game) stepLab(in Input) {
	if g.labPaused {
		return
	}
	if g.labSlow {
		g.labSlowPhase = !g.labSlowPhase
		if !g.labSlowPhase {
			g.run.Tick++
			return
		}
	}

	g.run.Tick++
	if in.BladeToggle {
		g.dozer.BladeDown = !g.dozer.BladeDown
	}
	g.integrateDozer(in)

	solids := g.collectSolids()
	_, _ = g.resolveDozer(solids)

	g.labImpacts = nil
	if g.dozer.BladeDown {
		g.wreckWithBlade()
	}
	for _, br := range g.lot.CollapseTick() {
		g.onCellBreak(br)
	}
	g.stepCollapseWarn()
	g.dozer.Heat = 0
	g.fx.Step(Dt, ShakeDecay)
}

func (g *Game) handleLabKeys() {
	if g.keyJust(ebiten.KeyR) {
		g.resetLab()
		return
	}
	if g.keyJust(ebiten.Key1) {
		g.resetLab()
		g.poseLabSouth()
	}
	if g.keyJust(ebiten.Key2) {
		g.resetLab()
		g.poseLabNorth()
	}
	if g.keyJust(ebiten.Key3) {
		g.resetLab()
		g.poseLabEast()
	}
	if g.keyJust(ebiten.Key4) {
		g.resetLab()
		g.poseLabWest()
	}
	if g.keyJust(ebiten.KeyP) {
		g.labPaused = !g.labPaused
	}
	if g.keyJust(ebiten.KeyO) {
		g.labSlow = !g.labSlow
	}
	if g.keyJust(ebiten.KeyPeriod) && g.labPaused {
		g.labPaused = false
		g.stepLab(Input{})
		g.labPaused = true
	}
}
