package game

import (
	"fmt"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/inpututil"
	"permitdenied/internal/lot"
)

const WindowTitle = "PERMIT DENIED"

type Keys struct {
	Enter, Escape, F1, F2, F3, F4, R bool
}

type Snapshot struct {
	Title       string  `json:"title"`
	Scene       string  `json:"scene"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Heading     float64 `json:"heading"`
	Speed       float64 `json:"speed"`
	BladeDown   bool    `json:"blade_down"`
	Stance      string  `json:"stance"`
	Plates      int     `json:"plates"`
	Heat        float64 `json:"heat"`
	Tick        int     `json:"tick"`
	Time        float64 `json:"time"`
	Clock       string  `json:"clock"`
	Death       string  `json:"death"`
	Over        bool    `json:"over"`
	StructCash  int     `json:"struct_cash"`
	VehicleCash int     `json:"vehicle_cash"`
	Rubble      int     `json:"rubble"`
	Intact      int     `json:"intact_solids"`
	Hunting     bool    `json:"hunting"`
	Debug       bool    `json:"debug"`
	Banner      string  `json:"banner"`
	OpenCells   int     `json:"open_cells"`
	SpillCount  int     `json:"spill_count"`
	Falling     int     `json:"falling_deck"`
	Sagging     int     `json:"sagging_deck"`
	DeckIntact  int     `json:"deck_intact"`
}

type harnessFrame struct {
	in   Input
	keys Keys
}

func (g *Game) Silence() {
	g.audio = nil
}

func (g *Game) Drive(in Input, keys Keys) error {
	g.harness = &harnessFrame{in: in, keys: keys}
	err := g.Update()
	g.harness = nil
	return err
}

func (g *Game) Snapshot() Snapshot {
	open, spill, falling, sagging, deckIntact := 0, 0, 0, 0, 0
	for si := range g.lot.Structures {
		s := &g.lot.Structures[si]
		spill += len(s.Spill)
		for i := range s.Cells {
			c := &s.Cells[i]
			if c.Kind == lot.KindNone || c.State == lot.Empty {
				open++
			}
			if c.IsDeck() {
				if c.Falling {
					falling++
				}
				if c.Sag > 0 && !c.Falling && c.State == lot.Intact {
					sagging++
				}
				if c.State == lot.Intact || c.State == lot.Cracked {
					deckIntact++
				}
			}
		}
	}
	s := Snapshot{
		Title:       WindowTitle,
		Scene:       g.sceneName(),
		Debug:       g.debug,
		X:           g.dozer.X,
		Y:           g.dozer.Y,
		Heading:     g.dozer.Heading,
		Speed:       g.dozer.Speed,
		BladeDown:   g.dozer.BladeDown,
		Stance:      stanceLabel(g.dozer.BladeDown),
		Plates:      g.dozer.Plates,
		Heat:        g.dozer.Heat,
		Tick:        g.run.Tick,
		Time:        g.run.Time(),
		Clock:       clockLabel(g.run.Tick),
		Death:       g.run.Death,
		Over:        g.run.Over,
		StructCash:  g.run.StructCash,
		VehicleCash: g.run.VehicleCash,
		Rubble:      g.lot.RubbleCount(),
		Intact:      g.lot.IntactSolidCount(),
		Hunting:     g.run.Hunting,
		Banner:      g.fx.Banner,
		OpenCells:   open,
		SpillCount:  spill,
		Falling:     falling,
		Sagging:     sagging,
		DeckIntact:  deckIntact,
	}
	return s
}

func (g *Game) sceneName() string {
	switch g.scene {
	case ScenePlay:
		return "play"
	case SceneTally:
		return "tally"
	case SceneLab:
		return "lab"
	default:
		return "unknown"
	}
}

func (g *Game) keyJust(k ebiten.Key) bool {
	if g.harness != nil {
		switch k {
		case ebiten.KeyEnter:
			return g.harness.keys.Enter
		case ebiten.KeyEscape:
			return g.harness.keys.Escape
		case ebiten.KeyF1:
			return g.harness.keys.F1
		case ebiten.KeyF2:
			return g.harness.keys.F2
		case ebiten.KeyF3:
			return g.harness.keys.F3
		case ebiten.KeyF4:
			return g.harness.keys.F4
		case ebiten.KeyR:
			return g.harness.keys.R
		case ebiten.KeySpace:
			return g.harness.in.BladeToggle
		}
		return false
	}
	return inpututil.IsKeyJustPressed(k)
}

func stanceLabel(down bool) string {
	if down {
		return "BLADE DOWN"
	}
	return "BLADE UP"
}

func clockLabel(tick int) string {
	elapsed := tick / TPS
	if elapsed < 0 {
		elapsed = 0
	}
	return fmt.Sprintf("%d:%02d", elapsed/60, elapsed%60)
}
