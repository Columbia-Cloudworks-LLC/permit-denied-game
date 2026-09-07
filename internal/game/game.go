package game

import (
	"github.com/hajimehoshi/ebiten/v2"
	"permitdenied/internal/audio"
	"permitdenied/internal/dozer"
	"permitdenied/internal/fx"
	"permitdenied/internal/lot"
	"permitdenied/internal/render"
	"permitdenied/internal/run"
	"permitdenied/internal/threats"
)

type Scene int

const (
	ScenePlay Scene = iota
	SceneTally
	SceneLab
)

type Game struct {
	scene Scene
	run   run.Run
	dozer dozer.Dozer
	lot   lot.Lot
	fx    fx.FX

	cruiser threats.Cruiser

	stallTicks int

	outsideW, outsideH int
	debug              bool
	audio              *audio.Audio

	throttleID ebiten.TouchID
	throttleOn bool
	throttleY0 float64
	taps       map[ebiten.TouchID]tapInfo

	harness *harnessFrame

	glanceLatch bool

	labImpacts   []lot.Impact
	labPaused    bool
	labSlow      bool
	labSlowPhase bool
}

func New() *Game {
	g := &Game{audio: &audio.Audio{}}
	g.reset()
	return g
}

func (g *Game) reset() {
	g.scene = ScenePlay
	g.run = run.New()
	g.dozer = dozer.Spawn(SpawnX, SpawnY)
	g.lot = lot.TestLot()
	g.fx = fx.FX{}
	g.cruiser = threats.SpawnCruiser(340, 220)
	g.stallTicks = 0
	g.glanceLatch = false
	g.labImpacts = nil
	g.labPaused = false
	g.labSlow = false
	if g.audio != nil {
		g.audio.StartChase()
	}
}

func (g *Game) Layout(outsideWidth, outsideHeight int) (int, int) {
	g.outsideW = outsideWidth
	g.outsideH = outsideHeight
	return ScreenW, ScreenH
}

func (g *Game) Update() error {
	in := g.readInput()
	if g.keyJust(ebiten.KeyF2) {
		g.debug = !g.debug
	}
	if g.keyJust(ebiten.KeyF4) {
		g.startLab()
		return nil
	}
	if g.keyJust(ebiten.KeyM) {
		if g.audio != nil {
			g.audio.ToggleMute()
		}
	}

	switch g.scene {
	case SceneLab:
		g.handleLabKeys()
		if g.scene != SceneLab {
			return nil
		}
		if g.fx.HitStop > 0 {
			g.fx.HitStop--
			g.run.Tick++
			g.fx.Step(Dt, ShakeDecay)
			return nil
		}
		g.stepLab(in)
	case ScenePlay:
		if g.keyJust(ebiten.KeyR) {
			g.reset()
			return nil
		}
		if g.fx.HitStop > 0 {
			g.fx.HitStop--
			g.run.Tick++
			g.fx.Step(Dt, ShakeDecay)
			return nil
		}
		g.stepPlay(in)
	case SceneTally:
		g.fx.TallyT += Dt
		if g.audio != nil {
			g.audio.Duck(true)
		}
		if in.BladeToggle || in.Confirm || g.keyJust(ebiten.KeyR) {
			if g.audio != nil {
				g.audio.Duck(false)
			}
			g.reset()
		}
	}
	return nil
}

func (g *Game) Draw(screen *ebiten.Image) {
	camX, camY := g.camera()
	sx, sy := g.fx.Offsets(g.run.Tick)
	v := render.View{
		CamX: camX, CamY: camY, ShakeX: sx, ShakeY: sy,
		Tick:        g.run.Tick,
		Dozer:       g.dozer,
		Lot:         g.lot,
		Cruiser:     g.cruiser,
		Dollars:     g.fx.Dollars,
		Bursts:      g.fx.Bursts,
		Frags:       g.fx.Frags,
		Dusts:       g.fx.Dusts,
		Flashes:     g.fx.Flashes,
		Scars:       g.fx.Scars,
		Detritus:    g.fx.Detritus,
		Banner:      g.fx.Banner,
		BannerT:     g.fx.BannerT,
		StructCash:  g.run.StructCash,
		VehicleCash: g.run.VehicleCash,
		Heat:        g.dozer.Heat,
		Plates:      g.dozer.Plates,
		BladeDown:   g.dozer.BladeDown,
		Speed:       g.dozer.Speed,
		Debug:       g.debug,
		Time:        g.run.Time(),
		HideStance:  g.scene == SceneTally,
		MapW:        LotW,
		MapH:        LotH,
		DollarLife:  DollarLife,
		DollarRise:  DollarRise,
		HeatVent:    HeatVent,
		HeatPulse:   HeatPulse,
		Impacts:     g.labImpacts,
		LabDebug:    g.scene == SceneLab,
	}
	render.DrawWorld(screen, v)
	render.DrawHUD(screen, v)
	if g.scene == SceneTally {
		render.DrawTally(screen, render.Tally{
			T:           g.fx.TallyT,
			Death:       g.run.Death,
			StructCash:  g.run.StructCash,
			VehicleCash: g.run.VehicleCash,
			Time:        g.run.TimeAlive,
			Total:       g.run.Final(),
			Roll:        TallyRoll,
		})
	}
}

func (g *Game) worldW() float64 { return LotW }
func (g *Game) worldH() float64 { return LotH }
