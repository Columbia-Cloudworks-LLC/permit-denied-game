package render

import (
	"image/color"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
)

func drawStructureSpill(dst *ebiten.Image, v View) {
	for si := range v.Lot.Structures {
		for _, r := range v.Lot.Structures[si].Spill {
			sx, sy := world(v, r.X, r.Y)
			fillRect(dst, sx, sy, r.W, r.H, ColRubble)
			vector.StrokeRect(dst, float32(sx), float32(sy), float32(r.W), float32(r.H), 1, shadeRGBA(ColRubble, -30), false)
		}
	}
}

func fillRect(dst *ebiten.Image, x, y, w, h float64, c color.RGBA) {
	vector.DrawFilledRect(dst, float32(x), float32(y), float32(w), float32(h), c, false)
}

func shadeRGBA(c color.RGBA, delta int) color.RGBA {
	clamp8 := func(v int) uint8 {
		if v < 0 {
			return 0
		}
		if v > 255 {
			return 255
		}
		return uint8(v)
	}
	return color.RGBA{
		R: clamp8(int(c.R) + delta),
		G: clamp8(int(c.G) + delta),
		B: clamp8(int(c.B) + delta),
		A: c.A,
	}
}
