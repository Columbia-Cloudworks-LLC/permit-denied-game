package render

import (
	"image/color"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"permitdenied/internal/lot"
)

const (
	facadePerStory = 12 // matches lot.StoryLiftPx
	shadowAlpha    = 0x77
)

func fillRect(dst *ebiten.Image, x, y, w, h float64, c color.RGBA) {
	if w <= 0 || h <= 0 {
		return
	}
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

func matDustTint(m lot.Material) (r, g, b float32) {
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

func roofFrameName(m lot.Material) string {
	switch m {
	case lot.MatWood:
		return "wood_roof"
	case lot.MatBrick:
		return "brick_roof"
	default:
		return "conc_roof"
	}
}

func blitBuildingShaded(dst *ebiten.Image, a *atlas, name string, sx, sy, lift float64, shade float32) {
	img, _, ok := a.building(name)
	if !ok {
		vector.DrawFilledRect(dst, float32(sx), float32(sy-lift), tileSize, tileSize, ColBuilding, false)
		return
	}
	if lift > 1 {
		sh := color.RGBA{0, 0, 0, 0x55}
		vector.DrawFilledRect(dst, float32(sx+2), float32(sy+2), tileSize-2, tileSize-2, sh, false)
	}
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(sx, sy-lift)
	op.Filter = ebiten.FilterNearest
	if shade != 1 {
		op.ColorScale.Scale(shade, shade, shade, 1)
	}
	dst.DrawImage(img, op)
	if lift > 1 {
		vector.StrokeLine(dst,
			float32(sx), float32(sy-lift),
			float32(sx+tileSize), float32(sy-lift),
			1, color.RGBA{0xFF, 0xFF, 0xFF, 0x40}, false)
		vector.StrokeLine(dst,
			float32(sx), float32(sy-lift+tileSize-1),
			float32(sx+tileSize), float32(sy-lift+tileSize-1),
			1, color.RGBA{0, 0, 0, 0x66}, false)
	}
}

func drawWound(dst *ebiten.Image, sx, sy float64, c *lot.Cell, lx, ly int) {
	if c == nil || !c.Present() {
		return
	}
	w := c.Wound()
	if c.Sag > 0 {
		if w < 0.35 {
			w = 0.35
		}
	}
	if w < 0.12 {
		return
	}
	n := 2 + int(w*8)
	if c.State == lot.Cracked || c.State == lot.Broken {
		n += 3
	}
	col := ColCrack
	if w > 0.6 {
		col = color.RGBA{0x1A, 0x18, 0x16, 0xFF}
	}
	for i := 0; i < n; i++ {
		h := lot.CellHash(lx, ly, 40+i)
		x0 := sx + float64(h%14) + 1
		y0 := sy + float64((h>>4)%13) + 1
		ln := 2 + int((h>>8)%4)
		dir := (h >> 12) & 3
		for k := 0; k < ln; k++ {
			x, y := x0, y0
			switch dir {
			case 0:
				x += float64(k)
				y += float64(k / 2)
			case 1:
				x += float64(k)
			case 2:
				y += float64(k)
			default:
				x -= float64(k / 2)
				y += float64(k)
			}
			fillRect(dst, x, y, 1, 1, col)
		}
	}
	if w > 0.55 {
		// Chipped bite on a hashed edge so the cell does not vanish as a full square.
		edge := int((lot.CellHash(lx, ly, 9)) % 4)
		depth := 1 + int(w*3)
		switch edge {
		case 0:
			for i := 0; i < tileSize; i++ {
				if lot.CellHash(lx, ly, i+20)%3 == 0 {
					fillRect(dst, sx+float64(i), sy, 1, float64(depth), color.RGBA{0x22, 0x20, 0x1C, 0xFF})
				}
			}
		case 1:
			for i := 0; i < tileSize; i++ {
				if lot.CellHash(lx, ly, i+21)%3 == 0 {
					fillRect(dst, sx+float64(tileSize-depth), sy+float64(i), float64(depth), 1, color.RGBA{0x22, 0x20, 0x1C, 0xFF})
				}
			}
		case 2:
			for i := 0; i < tileSize; i++ {
				if lot.CellHash(lx, ly, i+22)%3 == 0 {
					fillRect(dst, sx+float64(i), sy+float64(tileSize-depth), 1, float64(depth), color.RGBA{0x22, 0x20, 0x1C, 0xFF})
				}
			}
		default:
			for i := 0; i < tileSize; i++ {
				if lot.CellHash(lx, ly, i+23)%3 == 0 {
					fillRect(dst, sx, sy+float64(i), float64(depth), 1, color.RGBA{0x22, 0x20, 0x1C, 0xFF})
				}
			}
		}
	}
}

func drawSupportBeam(dst *ebiten.Image, v View, s *lot.Structure, lx, ly int, sx, sy, lift float64) {
	c := s.At(lx, ly)
	if c == nil || !c.IsDeck() || lift < 1 {
		return
	}
	if c.Sag <= 0 && !c.Falling && !deckTouchesCavity(s, lx, ly) {
		return
	}
	flat := ly*s.W + lx
	if flat < 0 || flat >= len(s.Anchors) {
		return
	}
	bc := color.RGBA{0x3A, 0x36, 0x30, 0xCC}
	if c.Mat == lot.MatWood {
		bc = color.RGBA{0x4A, 0x32, 0x1C, 0xCC}
	}
	for _, ai := range s.Anchors[flat] {
		if ai < 0 || ai >= len(s.Cells) || !s.Cells[ai].IsSupport() {
			continue
		}
		ax, ay := s.Index(ai)
		wx, wy := s.WorldXY(ax, ay)
		tsx, tsy := world(v, wx+8, wy+8)
		vector.StrokeLine(dst,
			float32(sx+8), float32(sy-lift+tileSize-1),
			float32(tsx), float32(tsy),
			1, bc, false)
		break
	}
}

func deckTouchesCavity(s *lot.Structure, lx, ly int) bool {
	for _, d := range [][2]int{{0, 1}, {0, -1}, {1, 0}, {-1, 0}} {
		if s.Cavity(lx+d[0], ly+d[1]) {
			return true
		}
	}
	return false
}

func drawSouthFacade(dst *ebiten.Image, v View, s *lot.Structure, lx int, sx, sy, fh float64, stories int) {
	c := s.At(lx, s.H-1)
	if c == nil {
		return
	}
	mat := c.Mat
	if mat == 0 && c.WasMat != 0 {
		mat = c.WasMat
	}
	if c.Kind == lot.KindNone && c.WasMat != 0 {
		mat = c.WasMat
	}
	fc := matFacadeColor(mat)
	standing := c.Present() && c.State != lot.Broken && c.State != lot.Rubble && c.Kind != lot.KindNone
	open := s.Cavity(lx, s.H-1) || c.Kind == lot.KindWindow && c.State != lot.Intact
	if c.Kind == lot.KindWindow && c.State == lot.Intact {
		open = false
	}
	if !standing && !columnHasStandingDeck(s, lx) && !open {
		return
	}

	fillRect(dst, sx, sy-fh, tileSize, fh, fc)
	fillRect(dst, sx, sy-fh, tileSize, 2, shadeRGBA(fc, 40))
	fillRect(dst, sx, sy-2, tileSize, 2, shadeRGBA(fc, -45))
	if stories >= 2 {
		mid := sy - fh/2
		fillRect(dst, sx, mid-1, tileSize, 2, shadeRGBA(fc, -25))
		if standing && c.Kind != lot.KindDoor {
			fillRect(dst, sx+3, sy-fh+3, tileSize-6, 4, color.RGBA{0x2A, 0x4A, 0x5A, 0xFF})
			fillRect(dst, sx+4, sy-fh+4, tileSize-8, 2, color.RGBA{0x6A, 0xC0, 0xD8, 0xAA})
		}
	}

	if standing && c.Kind == lot.KindWindow {
		fillRect(dst, sx+3, sy-fh+fh*0.55, tileSize-6, 5, color.RGBA{0x2A, 0x4A, 0x5A, 0xFF})
		fillRect(dst, sx+4, sy-fh+fh*0.55+1, tileSize-8, 3, color.RGBA{0x6A, 0xC0, 0xD8, 0xAA})
	}

	if open || !standing {
		drawFacadeHole(dst, sx, sy, fh, lx, s.H-1, mat)
	} else if c.Wound() > 0.2 {
		// Superficial / cracked façade scarring, not a vanished cell.
		drawFacadeScars(dst, sx, sy, fh, lx, c)
	}

	if columnHasStandingDeck(s, lx) {
		lip := shadeRGBA(fc, 55)
		fillRect(dst, sx-1, sy-fh-3, tileSize+2, 3, lip)
		fillRect(dst, sx-1, sy-fh-3, tileSize+2, 1, color.RGBA{0, 0, 0, 0x55})
		vector.StrokeLine(dst,
			float32(sx), float32(sy-fh),
			float32(sx+tileSize), float32(sy-fh),
			1, color.RGBA{0, 0, 0, 0x66}, false)
	}
}

func columnHasStandingDeck(s *lot.Structure, lx int) bool {
	for y := 0; y < s.H-1; y++ {
		c := s.At(lx, y)
		if c != nil && c.IsDeck() && c.Present() && c.State != lot.Rubble && c.State != lot.Broken {
			return true
		}
		if s.InteriorSupport(lx, y) {
			col := s.At(lx, y)
			if col != nil && col.Present() && col.State != lot.Rubble {
				return true
			}
		}
	}
	return false
}

func drawFacadeHole(dst *ebiten.Image, sx, sy, fh float64, lx, ly int, mat lot.Material) {
	dark := color.RGBA{0x18, 0x16, 0x14, 0xFF}
	floor := color.RGBA{0x32, 0x2C, 0x24, 0xFF}
	x0 := sx + 2
	w := float64(tileSize - 4)
	// Irregular jambs: nibble 1–3px per scanline.
	for i := 0; i < int(fh)-3; i++ {
		h := lot.CellHash(lx, ly, i+70)
		insetL := 1 + int(h%3)
		insetR := 1 + int((h>>3)%3)
		if i < 2 || i > int(fh)-6 {
			insetL++
			insetR++
		}
		y := sy - fh + 3 + float64(i)
		fillRect(dst, x0+float64(insetL-1), y, w-float64(insetL+insetR-2), 1, dark)
		if i > int(fh)-10 {
			fillRect(dst, x0+float64(insetL), y, w-float64(insetL+insetR), 1, floor)
		}
	}
	// Exposed lintel remnant.
	lintel := matFacadeColor(mat)
	fillRect(dst, sx+1, sy-fh+2, tileSize-2, 2, shadeRGBA(lintel, -20))
	for i := 0; i < tileSize-2; i++ {
		if lot.CellHash(lx, ly, i+90)%4 == 0 {
			fillRect(dst, sx+1+float64(i), sy-fh+1, 1, 2, color.RGBA{0x2A, 0x28, 0x24, 0xFF})
		}
	}
}

func drawFacadeScars(dst *ebiten.Image, sx, sy, fh float64, lx int, c *lot.Cell) {
	n := 2 + int(c.Wound()*6)
	for i := 0; i < n; i++ {
		h := lot.CellHash(lx, int(c.Kind), 50+i)
		span := int(fh) - 6
		if span < 1 {
			span = 1
		}
		x := sx + 2 + float64(h%12)
		y := sy - fh + 4 + float64(int(h>>4)%span)
		fillRect(dst, x, y, 1+float64((h>>8)%3), 1, ColCrack)
	}
}

func drawDeckEdgeFacade(dst *ebiten.Image, s *lot.Structure, lx, ly int, sx, sy, lift float64, c *lot.Cell) {
	if c == nil || !c.IsDeck() || lift < 2 {
		return
	}
	south := s.At(lx, ly+1)
	exposed := south == nil || !south.IsDeck() || south.State == lot.Rubble || south.State == lot.Broken || south.Falling || s.Cavity(lx, ly+1)
	if !exposed {
		return
	}
	fc := matFacadeColor(c.Mat)
	h := 5.0
	if c.Falling {
		h = 4
	}
	fillRect(dst, sx, sy-lift+tileSize-1, tileSize, h, shadeRGBA(fc, -30))
	fillRect(dst, sx, sy-lift+tileSize-1, tileSize, 1, shadeRGBA(fc, 20))
	if s.Cavity(lx, ly+1) {
		for i := 0; i < tileSize; i++ {
			if lot.CellHash(lx, ly, i+3)%3 == 0 {
				fillRect(dst, sx+float64(i), sy-lift+tileSize, 1, 2, color.RGBA{0x22, 0x20, 0x1C, 0xFF})
			}
		}
	}
}
