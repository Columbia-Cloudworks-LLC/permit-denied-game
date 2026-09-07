package render

import (
	"image/color"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"permitdenied/internal/lot"
)

var colCavity = color.RGBA{0x1C, 0x1A, 0x16, 0xFF}
var colCavityFloor = color.RGBA{0x2E, 0x2A, 0x24, 0xFF}
var colCavityDust = color.RGBA{0x3A, 0x36, 0x30, 0xFF}

func drawBuildingShadows(dst *ebiten.Image, v View) {
	for si := range v.Lot.Structures {
		s := &v.Lot.Structures[si]
		stories := s.Stories
		if stories < 1 {
			stories = 1
		}
		ox := float64(3 + stories*2)
		oy := float64(3 + stories*2)
		for i := range s.Cells {
			c := &s.Cells[i]
			if !c.Present() || c.State == lot.Rubble || c.State == lot.Empty {
				continue
			}
			if !c.IsDeck() && !c.IsSupport() && c.Kind != lot.KindWindow {
				continue
			}
			lx, ly := s.Index(i)
			wx, wy := s.WorldXY(lx, ly)
			sx, sy := world(v, wx+ox, wy+oy)
			vector.DrawFilledRect(dst, float32(sx), float32(sy), tileSize, tileSize,
				color.RGBA{0, 0, 0, shadowAlpha}, false)
		}
	}
}

func drawMergedCavities(dst *ebiten.Image, v View) {
	for si := range v.Lot.Structures {
		s := &v.Lot.Structures[si]
		seen := make([]bool, len(s.Cells))
		for i := range s.Cells {
			lx, ly := s.Index(i)
			if seen[i] || !s.Cavity(lx, ly) {
				continue
			}
			comp := floodCavity(s, i, seen)
			drawCavityRegion(dst, v, s, comp)
		}
	}
}

func floodCavity(s *lot.Structure, start int, seen []bool) []int {
	var comp []int
	q := []int{start}
	seen[start] = true
	for len(q) > 0 {
		i := q[0]
		q = q[1:]
		comp = append(comp, i)
		lx, ly := s.Index(i)
		for _, d := range [][2]int{{0, 1}, {0, -1}, {1, 0}, {-1, 0}} {
			n := s.At(lx+d[0], ly+d[1])
			if n == nil {
				continue
			}
			ni := (ly+d[1])*s.W + (lx + d[0])
			if ni < 0 || ni >= len(seen) || seen[ni] {
				continue
			}
			if !s.Cavity(lx+d[0], ly+d[1]) {
				continue
			}
			seen[ni] = true
			q = append(q, ni)
		}
	}
	return comp
}

func drawCavityRegion(dst *ebiten.Image, v View, s *lot.Structure, comp []int) {
	if len(comp) == 0 {
		return
	}
	in := map[[2]int]bool{}
	for _, i := range comp {
		lx, ly := s.Index(i)
		in[[2]int{lx, ly}] = true
		wx, wy := s.WorldXY(lx, ly)
		sx, sy := world(v, wx, wy)
		// One floor color across the whole opening — no per-cell inset pit.
		fillRect(dst, sx, sy, tileSize, tileSize, colCavityFloor)
	}
	for _, i := range comp {
		lx, ly := s.Index(i)
		wx, wy := s.WorldXY(lx, ly)
		sx, sy := world(v, wx, wy)
		drawCavityEdge(dst, s, lx, ly, sx, sy)
		// Sparse dust specks, hashed so they do not repeat every 16px.
		h := lot.CellHash(lx+s.TX, ly+s.TY, 4)
		if h%2 == 0 {
			fillRect(dst, sx+float64(2+(h%11)), sy+float64(3+((h>>3)%9)), 2, 1, colCavityDust)
		}
	}
}

func drawCavityEdge(dst *ebiten.Image, s *lot.Structure, lx, ly int, sx, sy float64) {
	type edge struct {
		dx, dy       int
		ox, oy, w, h float64
	}
	edges := []edge{
		{0, -1, 0, 0, tileSize, 3},           // north
		{0, 1, 0, tileSize - 3, tileSize, 3}, // south
		{-1, 0, 0, 0, 3, tileSize},           // west
		{1, 0, tileSize - 3, 0, 3, tileSize}, // east
	}
	for ei, e := range edges {
		n := s.At(lx+e.dx, ly+e.dy)
		if n != nil && s.Cavity(lx+e.dx, ly+e.dy) {
			continue // merge: no wall between these holes
		}
		remnant := matFacadeColor(lot.MatConcrete)
		if n != nil && n.Present() {
			remnant = matFacadeColor(n.Mat)
		} else {
			c := s.At(lx, ly)
			if c != nil && c.WasMat != 0 {
				remnant = matFacadeColor(c.WasMat)
			} else if c != nil {
				remnant = matFacadeColor(c.Mat)
			}
		}
		// Partial remnant along the standing neighbor / outer rim.
		for i := 0; i < int(e.w+e.h); i++ {
			if lot.CellHash(lx, ly, ei*30+i)%3 == 0 {
				continue
			}
			if e.w >= e.h {
				fillRect(dst, sx+e.ox+float64(i), sy+e.oy, 1, e.h, shadeRGBA(remnant, -40))
			} else {
				fillRect(dst, sx+e.ox, sy+e.oy+float64(i), e.w, 1, shadeRGBA(remnant, -40))
			}
		}
		// Chip the standing neighbor's shared edge (drawn here as cavity-side nibble).
		for i := 0; i < tileSize; i++ {
			if lot.CellHash(lx, ly, 200+ei*16+i)%4 != 0 {
				continue
			}
			switch ei {
			case 0:
				fillRect(dst, sx+float64(i), sy, 1, 2, remnant)
			case 1:
				fillRect(dst, sx+float64(i), sy+tileSize-2, 1, 2, remnant)
			case 2:
				fillRect(dst, sx, sy+float64(i), 2, 1, remnant)
			default:
				fillRect(dst, sx+tileSize-2, sy+float64(i), 2, 1, remnant)
			}
		}
	}
}

func drawNeighborChips(dst *ebiten.Image, v View, s *lot.Structure, lx, ly int, sx, sy float64) {
	c := s.At(lx, ly)
	if c == nil || !c.Present() || c.State == lot.Rubble {
		return
	}
	dark := colCavity
	try := func(dx, dy int, alongX bool, ox, oy float64) {
		if !s.Cavity(lx+dx, ly+dy) {
			return
		}
		for i := 0; i < tileSize; i++ {
			h := lot.CellHash(lx, ly, dx*17+dy*13+i)
			if h%3 != 0 {
				continue
			}
			depth := 1 + int(h%3)
			if alongX {
				fillRect(dst, sx+float64(i), sy+oy, 1, float64(depth), dark)
			} else {
				fillRect(dst, sx+ox, sy+float64(i), float64(depth), 1, dark)
			}
		}
	}
	try(0, -1, true, 0, 0)
	try(0, 1, true, 0, tileSize-3)
	try(-1, 0, false, 0, 0)
	try(1, 0, false, tileSize-3, 0)
}

func drawRubbleCells(dst *ebiten.Image, v View, a *atlas) {
	for si := range v.Lot.Structures {
		s := &v.Lot.Structures[si]
		for i := range s.Cells {
			c := &s.Cells[i]
			if c.State != lot.Rubble {
				continue
			}
			lx, ly := s.Index(i)
			wx, wy := s.WorldXY(lx, ly)
			h := lot.CellHash(lx, ly, 8)
			ox := float64(int(h%5) - 2)
			oy := float64(int((h>>3)%4) - 1)
			sx, sy := world(v, wx+ox, wy+oy)
			blitBuilding(dst, a, c.Rubble, sx, sy)
			// Extra irregular lumps so piles do not read as one sprite per grid cell.
			if h%2 == 0 {
				blitBuilding(dst, a, c.Rubble, sx+3, sy+2)
			}
		}
	}
}

func drawStructureSpill(dst *ebiten.Image, v View) {
	for si := range v.Lot.Structures {
		for _, r := range v.Lot.Structures[si].Spill {
			sx, sy := world(v, r.X, r.Y)
			drawSpillBlob(dst, sx, sy, r.W, r.H, r.Mat, int(r.X)+int(r.Y))
		}
	}
}

func drawSpillBlob(dst *ebiten.Image, x, y, w, h float64, mat lot.Material, salt int) {
	base := ColRubble
	lt := shadeRGBA(base, 25)
	dk := shadeRGBA(base, -25)
	switch mat {
	case lot.MatWood:
		base, lt, dk = color.RGBA{0x6A, 0x42, 0x24, 0xFF}, color.RGBA{0x8A, 0x5A, 0x32, 0xFF}, color.RGBA{0x4A, 0x2E, 0x18, 0xFF}
	case lot.MatBrick:
		base, lt, dk = color.RGBA{0x7A, 0x32, 0x28, 0xFF}, color.RGBA{0xA4, 0x4A, 0x3A, 0xFF}, color.RGBA{0x5A, 0x22, 0x1C, 0xFF}
	case lot.MatGlass:
		base, lt, dk = color.RGBA{0x4A, 0x70, 0x78, 0xFF}, color.RGBA{0x6A, 0xC0, 0xD8, 0xFF}, color.RGBA{0x3A, 0x5A, 0x6A, 0xFF}
	case lot.MatSteel:
		base, lt, dk = color.RGBA{0x5A, 0x68, 0x74, 0xFF}, color.RGBA{0x8A, 0x98, 0xA4, 0xFF}, color.RGBA{0x3A, 0x42, 0x48, 0xFF}
	case lot.MatConcrete:
		base, lt, dk = color.RGBA{0x5A, 0x60, 0x66, 0xFF}, color.RGBA{0x8A, 0x92, 0x98, 0xFF}, color.RGBA{0x3A, 0x40, 0x44, 0xFF}
	}
	fillRect(dst, x+1, y+2, w-2, h-2, dk)
	fillRect(dst, x, y, w-3, h-3, base)
	n := 3 + salt%3
	for i := 0; i < n; i++ {
		hh := lot.CellHash(salt, i, 12)
		px := x + float64(hh%uint32(w+1))
		py := y + float64((hh>>4)%uint32(h+1))
		rw := 2 + float64((hh>>8)%4)
		rh := 2 + float64((hh>>12)%3)
		fillRect(dst, px, py, rw, rh, lt)
	}
	vector.StrokeRect(dst, float32(x), float32(y), float32(w-1), float32(h-1), 1, dk, false)
}
