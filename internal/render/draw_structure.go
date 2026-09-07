package render

import (
	"image/color"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"permitdenied/internal/lot"
)

const (
	facadePerStory = 8 // visible south-face strip per story (px) — matches StoryLiftPx
	shadowAlpha    = 0x55
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

// drawBuildingShadows casts a soft SE shadow under each structure footprint.
func drawBuildingShadows(dst *ebiten.Image, v View) {
	for si := range v.Lot.Structures {
		s := &v.Lot.Structures[si]
		if !structureStandingMass(s) {
			continue
		}
		stories := s.Stories
		if stories < 1 {
			stories = 1
		}
		ox := float64(2 + stories)
		oy := float64(2 + stories)
		wx0 := float64(s.TX * lot.Tile)
		wy0 := float64(s.TY * lot.Tile)
		ww := float64(s.W * lot.Tile)
		wh := float64(s.H * lot.Tile)
		sx, sy := world(v, wx0+ox, wy0+oy)
		c := color.RGBA{0, 0, 0, shadowAlpha}
		vector.DrawFilledRect(dst, float32(sx), float32(sy), float32(ww), float32(wh), c, false)
	}
}

func structureStandingMass(s *lot.Structure) bool {
	for i := range s.Cells {
		c := &s.Cells[i]
		if !c.Present() || c.State == lot.Rubble || c.State == lot.Empty {
			continue
		}
		if c.IsDeck() || c.IsSupport() || c.Kind == lot.KindWindow {
			return true
		}
	}
	return false
}

// drawCollapsedFloors paints a single dark floor under fallen deck cells
// (no repetitive interior checkerboard).
func drawCollapsedFloors(dst *ebiten.Image, v View) {
	for si := range v.Lot.Structures {
		s := &v.Lot.Structures[si]
		for i := range s.Cells {
			c := &s.Cells[i]
			if !c.IsDeck() {
				continue
			}
			if c.State != lot.Broken && c.State != lot.Rubble {
				continue
			}
			lx, ly := s.Index(i)
			wx, wy := s.WorldXY(lx, ly)
			sx, sy := world(v, wx, wy)
			fillRect(dst, sx+1, sy+1, lot.Tile-2, lot.Tile-2, color.RGBA{0x2A, 0x28, 0x24, 0xFF})
			vector.StrokeRect(dst, float32(sx+1), float32(sy+1), lot.Tile-2, lot.Tile-2, 1,
				color.RGBA{0x1A, 0x18, 0x14, 0xFF}, false)
		}
	}
}

func facadeH(stories int) float64 {
	if stories < 1 {
		stories = 1
	}
	return float64(stories * facadePerStory)
}

func matFacadeColor(m lot.Material) color.RGBA {
	switch m {
	case lot.MatWood:
		return color.RGBA{0x6A, 0x42, 0x24, 0xFF}
	case lot.MatBrick:
		return color.RGBA{0x7A, 0x32, 0x28, 0xFF}
	case lot.MatConcrete, lot.MatSteel:
		return color.RGBA{0x4A, 0x52, 0x58, 0xFF}
	case lot.MatGlass:
		return color.RGBA{0x3A, 0x5A, 0x6A, 0xFF}
	default:
		return ColBuilding
	}
}

func blitBuildingElevated(dst *ebiten.Image, a *atlas, name string, sx, sy, lift float64) {
	img, _, ok := a.building(name)
	if !ok {
		vector.DrawFilledRect(dst, float32(sx), float32(sy-lift), tileSize, tileSize, ColBuilding, false)
		return
	}
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(sx, sy-lift)
	op.Filter = ebiten.FilterNearest
	dst.DrawImage(img, op)
}

func blitBuildingShaded(dst *ebiten.Image, a *atlas, name string, sx, sy, lift float64, shade float32) {
	img, _, ok := a.building(name)
	if !ok {
		vector.DrawFilledRect(dst, float32(sx), float32(sy-lift), tileSize, tileSize, ColBuilding, false)
		return
	}
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(sx, sy-lift)
	op.Filter = ebiten.FilterNearest
	if shade < 1 {
		op.ColorScale.Scale(shade, shade, shade, 1)
	}
	dst.DrawImage(img, op)
}
