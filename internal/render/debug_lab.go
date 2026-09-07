package render

import (
	"fmt"
	"image/color"
	"math"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"permitdenied/internal/lot"
)

func drawLabDebug(dst *ebiten.Image, v View) {
	fx := math.Sin(v.Dozer.Heading)
	fy := -math.Cos(v.Dozer.Heading)
	rx := math.Cos(v.Dozer.Heading)
	ry := math.Sin(v.Dozer.Heading)
	const bladeW, thick, reach = 32.0, 10.0, 18.0
	var corners [4][2]float64
	i := 0
	for _, sr := range []float64{-bladeW / 2, bladeW / 2} {
		for _, sf := range []float64{reach - thick/2, reach + thick/2} {
			corners[i][0] = v.Dozer.X + rx*sr + fx*sf
			corners[i][1] = v.Dozer.Y + ry*sr + fy*sf
			i++
		}
	}
	obbCol := color.RGBA{0xF8, 0xE0, 0x70, 0xFF}
	drawWorldLine(dst, v, corners[0][0], corners[0][1], corners[1][0], corners[1][1], obbCol)
	drawWorldLine(dst, v, corners[1][0], corners[1][1], corners[3][0], corners[3][1], obbCol)
	drawWorldLine(dst, v, corners[3][0], corners[3][1], corners[2][0], corners[2][1], obbCol)
	drawWorldLine(dst, v, corners[2][0], corners[2][1], corners[0][0], corners[0][1], obbCol)

	hitCol := color.RGBA{0xC0, 0x40, 0x40, 0xFF}
	for _, im := range v.Impacts {
		for si := range v.Lot.Structures {
			s := &v.Lot.Structures[si]
			wx, wy := s.WorldXY(im.Col, im.Row)
			sx, sy := world(v, wx, wy)
			vector.StrokeRect(dst, float32(sx), float32(sy), lot.Tile, lot.Tile, 1, hitCol, false)
			drawWorldLine(dst, v, im.X, im.Y, im.X+im.DirX*16, im.Y+im.DirY*16, hitCol)
		}
	}

	for si := range v.Lot.Structures {
		s := &v.Lot.Structures[si]
		for i := range s.Cells {
			c := &s.Cells[i]
			lx, ly := s.Index(i)
			wx, wy := s.WorldXY(lx, ly)
			sx, sy := world(v, wx, wy)
			if c.CollapseIn > 0 {
				drawText(dst, fmt.Sprintf("%d", c.CollapseIn), sx+2, sy+2, ColHUD)
			}
			if c.SupportsRoof() {
				vector.StrokeRect(dst, float32(sx+2), float32(sy+2), lot.Tile-4, lot.Tile-4, 1,
					color.RGBA{0x3A, 0x6F, 0xBF, 0xFF}, false)
			}
		}
		if s.ImpactDirX != 0 || s.ImpactDirY != 0 {
			cx := float64(s.TX*lot.Tile) + float64(s.W*lot.Tile)/2
			cy := float64(s.TY*lot.Tile) + float64(s.H*lot.Tile)/2
			drawWorldLine(dst, v, cx, cy, cx+s.ImpactDirX*24, cy+s.ImpactDirY*24,
				color.RGBA{0x70, 0xC0, 0xF8, 0xFF})
		}
	}

	line := fmt.Sprintf("LAB impacts=%d", len(v.Impacts))
	drawText(dst, line, 4, 40, ColHUD)
	drawText(dst, "R reset 1-4 poses P pause O slow", 4, 52, ColHUD)
}

func drawWorldLine(dst *ebiten.Image, v View, x0, y0, x1, y1 float64, col color.RGBA) {
	sx0, sy0 := world(v, x0, y0)
	sx1, sy1 := world(v, x1, y1)
	vector.StrokeLine(dst, float32(sx0), float32(sy0), float32(sx1), float32(sy1), 1, col, false)
}
