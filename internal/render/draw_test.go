package render_test

import (
	"testing"

	"github.com/hajimehoshi/ebiten/v2"
	"permitdenied/internal/dozer"
	"permitdenied/internal/lot"
	"permitdenied/internal/render"
	"permitdenied/internal/threats"
)

func TestDrawWorldSmoke(t *testing.T) {
	dst := ebiten.NewImage(320, 224)
	v := render.View{
		Lot:     lot.TestLot(),
		Dozer:   dozer.Spawn(lot.SpawnX, lot.SpawnY),
		Cruiser: threats.SpawnCruiser(340, 220),
		MapW:    400,
		MapH:    288,
	}
	render.DrawWorld(dst, v)
	render.DrawHUD(dst, v)
}
