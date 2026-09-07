package render_test

import (
	"testing"

	"github.com/hajimehoshi/ebiten/v2"
	"permitdenied/internal/dozer"
	"permitdenied/internal/lot"
	"permitdenied/internal/render"
	"permitdenied/internal/threats"
)

// TestElevatedDrawSmoke ensures elevated buildings draw without panic.
func TestElevatedDrawSmoke(t *testing.T) {
	l := lot.TestLot()
	hall := l.StructureByLabel("HALL")
	if hall.Stories != 2 {
		t.Fatal("hall stories")
	}
	dst := ebiten.NewImage(320, 224)
	v := render.View{
		CamX: float64(hall.TX*lot.Tile) - 24,
		CamY: float64(hall.TY * lot.Tile),
		Lot:  l, Dozer: dozer.Spawn(lot.SpawnX, lot.SpawnY),
		Cruiser: threats.SpawnCruiser(340, 220),
		MapW: l.W, MapH: l.H,
	}
	render.DrawWorld(dst, v)
	render.DrawHUD(dst, v)

	// Local breach still has elevated deck.
	for _, p := range [][2]int{{0, 5}, {1, 5}, {2, 5}} {
		hall.ApplyDamage(p[0], p[1], 999)
		hall.FinishBroken(p[0], p[1])
	}
	render.DrawWorld(dst, v)

	// Force a falling cell and draw mid-fall.
	for i := range hall.Cells {
		c := &hall.Cells[i]
		if c.IsDeck() && c.State == lot.Intact {
			c.Falling = true
			c.FallY = hall.LiftPx() / 2
			break
		}
	}
	render.DrawWorld(dst, v)
}
