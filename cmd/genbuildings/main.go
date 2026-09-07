// Command genbuildings writes assets/usable/buildings.png and buildings.json
// with authored SNES-style structure tiles. Run from repo root:
//
//	go run ./cmd/genbuildings
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
)

const tile = 16
const cols = 8

var (
	colWood     = color.RGBA{0x8A, 0x5A, 0x32, 0xFF}
	colWoodDk   = color.RGBA{0x5A, 0x3A, 0x20, 0xFF}
	colWoodLt   = color.RGBA{0xB0, 0x7A, 0x48, 0xFF}
	colBrick    = color.RGBA{0xA4, 0x4A, 0x3A, 0xFF}
	colBrickDk  = color.RGBA{0x6E, 0x2E, 0x24, 0xFF}
	colBrickLt  = color.RGBA{0xC0, 0x6A, 0x55, 0xFF}
	colMort     = color.RGBA{0xC8, 0xB4, 0x9A, 0xFF}
	colConc     = color.RGBA{0x6E, 0x7A, 0x84, 0xFF}
	colConcDk   = color.RGBA{0x4A, 0x52, 0x58, 0xFF}
	colConcLt   = color.RGBA{0x9A, 0xA4, 0xAC, 0xFF}
	colGlass    = color.RGBA{0x6A, 0xC0, 0xD8, 0xFF}
	colGlassDk  = color.RGBA{0x3A, 0x6F, 0xBF, 0xFF}
	colSteel    = color.RGBA{0x5A, 0x68, 0x74, 0xFF}
	colSteelLt  = color.RGBA{0x8A, 0x98, 0xA4, 0xFF}
	colInterior = color.RGBA{0x3A, 0x32, 0x28, 0xFF}
	colFloor    = color.RGBA{0x4A, 0x40, 0x36, 0xFF}
	colCrack    = color.RGBA{0x2A, 0x2A, 0x28, 0xFF}
	colRubble   = color.RGBA{0x4A, 0x40, 0x36, 0xFF}
	colRubbleLt = color.RGBA{0x6A, 0x5A, 0x48, 0xFF}
	colShadow   = color.RGBA{0x1B, 0x1B, 0x22, 0xFF}
	transparent = color.RGBA{0, 0, 0, 0}
)

type slot struct {
	Name  string
	Paint func(*image.NRGBA, int, int)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "genbuildings: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	slots := allSlots()
	rows := (len(slots) + cols - 1) / cols
	w, h := cols*tile, rows*tile
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{transparent}, image.Point{}, draw.Src)

	frames := map[string]map[string]any{}
	for i, s := range slots {
		x := (i % cols) * tile
		y := (i / cols) * tile
		s.Paint(img, x, y)
		frames[s.Name] = map[string]any{"x": x, "y": y, "w": tile, "h": tile}
	}

	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		return err
	}
	doc := map[string]any{"frames": frames}
	js, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	dir := "assets/usable"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "buildings.png"), pngBuf.Bytes(), 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "buildings.json"), append(js, '\n'), 0o644)
}

func allSlots() []slot {
	base := []struct {
		prefix                                                string
		wall, roof, edge, corner, door, win, interior, rubble func(*image.NRGBA, int, int)
	}{
		{"wood", paintWoodWall, paintWoodRoof, paintWoodEdge, paintWoodCorner, paintWoodDoor, paintWoodWindow, paintWoodInterior, paintWoodRubble},
		{"brick", paintBrickWall, paintBrickRoof, paintBrickEdge, paintBrickCorner, paintBrickDoor, paintBrickWindow, paintBrickInterior, paintBrickRubble},
		{"conc", paintConcWall, paintConcRoof, paintConcEdge, paintConcCorner, paintConcDoor, paintConcWindow, paintConcInterior, paintConcRubble},
	}
	var out []slot
	for _, b := range base {
		kinds := []struct {
			suf   string
			paint func(*image.NRGBA, int, int)
		}{
			{"wall", b.wall},
			{"roof", b.roof},
			{"edge", b.edge},
			{"corner", b.corner},
			{"door", b.door},
			{"window", b.win},
			{"interior", b.interior},
			{"rubble", b.rubble},
		}
		for _, k := range kinds {
			name := b.prefix + "_" + k.suf
			paint := k.paint
			out = append(out, slot{Name: name, Paint: paint})
			if k.suf != "rubble" && k.suf != "interior" {
				p := paint
				out = append(out, slot{
					Name: name + "_crack",
					Paint: func(img *image.NRGBA, x, y int) {
						p(img, x, y)
						paintCracks(img, x, y)
					},
				})
			}
		}
	}
	// Shared glass/steel rubble.
	out = append(out,
		slot{Name: "glass_rubble", Paint: paintGlassRubble},
		slot{Name: "steel_rubble", Paint: paintSteelRubble},
		slot{Name: "dust_0", Paint: func(img *image.NRGBA, x, y int) { paintDust(img, x, y, 0) }},
		slot{Name: "dust_1", Paint: func(img *image.NRGBA, x, y int) { paintDust(img, x, y, 1) }},
		slot{Name: "dust_2", Paint: func(img *image.NRGBA, x, y int) { paintDust(img, x, y, 2) }},
		slot{Name: "dust_3", Paint: func(img *image.NRGBA, x, y int) { paintDust(img, x, y, 3) }},
		slot{Name: "frag_wood", Paint: func(img *image.NRGBA, x, y int) { paintFrag(img, x, y, colWood, colWoodDk) }},
		slot{Name: "frag_brick", Paint: func(img *image.NRGBA, x, y int) { paintFrag(img, x, y, colBrick, colBrickDk) }},
		slot{Name: "frag_conc", Paint: func(img *image.NRGBA, x, y int) { paintFrag(img, x, y, colConc, colConcDk) }},
		slot{Name: "frag_glass", Paint: func(img *image.NRGBA, x, y int) { paintFrag(img, x, y, colGlass, colGlassDk) }},
		slot{Name: "frag_steel", Paint: func(img *image.NRGBA, x, y int) { paintFrag(img, x, y, colSteel, colSteelLt) }},
		slot{Name: "scar_ash", Paint: paintScarAsh},
		slot{Name: "scar_glass", Paint: paintScarGlass},
	)
	return out
}

func fill(img *image.NRGBA, x, y, w, h int, c color.RGBA) {
	for dy := 0; dy < h; dy++ {
		for dx := 0; dx < w; dx++ {
			img.Set(x+dx, y+dy, c)
		}
	}
}

func px(img *image.NRGBA, x, y int, c color.RGBA) {
	if x < img.Bounds().Min.X || y < img.Bounds().Min.Y || x >= img.Bounds().Max.X || y >= img.Bounds().Max.Y {
		return
	}
	img.Set(x, y, c)
}

func paintCracks(img *image.NRGBA, x, y int) {
	for i := 1; i < 15; i++ {
		px(img, x+i, y+2+i/2, colCrack)
		px(img, x+i, y+3+i/2, colShadow)
		px(img, x+15-i, y+4+i/3, colCrack)
		px(img, x+i, y+12-i/4, colCrack)
	}
	fill(img, x+6, y+6, 3, 2, colCrack)
}

func paintWoodWall(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colWood)
	for row := 0; row < 4; row++ {
		yy := y + row*4
		fill(img, x, yy, tile, 1, colWoodDk)
		for i := 0; i < tile; i += 4 {
			px(img, x+i, yy+1, colWoodLt)
		}
	}
}

func paintWoodRoof(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colWoodLt)
	for yy := 2; yy < tile-1; yy += 2 {
		fill(img, x+1, y+yy, tile-2, 1, colWood)
	}
	fill(img, x, y, tile, 2, colWoodDk)
	fill(img, x, y+tile-1, tile, 1, colWoodDk)
	px(img, x+2, y+4, colWoodDk)
	px(img, x+9, y+7, colWoodDk)
}

func paintWoodEdge(img *image.NRGBA, x, y int) {
	paintWoodRoof(img, x, y)
	fill(img, x, y+tile-3, tile, 3, colWoodDk)
}

func paintWoodCorner(img *image.NRGBA, x, y int) {
	paintWoodWall(img, x, y)
	fill(img, x, y, 3, tile, colWoodDk)
	fill(img, x, y, tile, 3, colWoodDk)
}

func paintWoodDoor(img *image.NRGBA, x, y int) {
	paintWoodWall(img, x, y)
	fill(img, x+4, y+2, 8, 14, colWoodDk)
	fill(img, x+5, y+3, 6, 12, colShadow)
	px(img, x+10, y+9, colWoodLt)
}

func paintWoodWindow(img *image.NRGBA, x, y int) {
	paintWoodWall(img, x, y)
	fill(img, x+3, y+3, 10, 8, colGlassDk)
	fill(img, x+4, y+4, 8, 6, colGlass)
	px(img, x+8, y+3, colWoodDk)
	px(img, x+3, y+7, colWoodDk)
}

func paintWoodInterior(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colInterior)
	for i := 0; i < tile; i += 2 {
		px(img, x+i, y+tile-1, colFloor)
	}
}

func paintWoodRubble(img *image.NRGBA, x, y int) {
	px(img, x+2, y+7, colShadow)
	fill(img, x+1, y+8, 6, 4, colWoodDk)
	fill(img, x+6, y+9, 7, 5, colWood)
	fill(img, x+3, y+12, 5, 2, colWoodLt)
	px(img, x+10, y+8, colWoodLt)
	px(img, x+12, y+11, colWoodDk)
	px(img, x+4, y+10, colCrack)
}

func paintBrickWall(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colBrick)
	for row := 0; row < 4; row++ {
		yy := y + row*4
		fill(img, x, yy+3, tile, 1, colMort)
		off := 0
		if row%2 == 1 {
			off = 2
		}
		for bx := off; bx < tile; bx += 4 {
			fill(img, x+bx, yy, 1, 3, colMort)
			px(img, x+bx+1, yy+1, colBrickLt)
		}
	}
}

func paintBrickRoof(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colBrickDk)
	for yy := 2; yy < tile-2; yy += 3 {
		for xx := 1; xx < tile-1; xx += 3 {
			px(img, x+xx, y+yy, colBrick)
			px(img, x+xx+1, y+yy+1, colBrickLt)
		}
	}
	fill(img, x, y, tile, 2, colShadow)
	fill(img, x, y+tile-1, tile, 1, colBrick)
}

func paintBrickEdge(img *image.NRGBA, x, y int) {
	paintBrickRoof(img, x, y)
	fill(img, x, y+tile-2, tile, 2, colMort)
}

func paintBrickCorner(img *image.NRGBA, x, y int) {
	paintBrickWall(img, x, y)
	fill(img, x, y, 2, tile, colBrickDk)
	fill(img, x, y, tile, 2, colBrickDk)
}

func paintBrickDoor(img *image.NRGBA, x, y int) {
	paintBrickWall(img, x, y)
	fill(img, x+4, y+1, 8, 15, colSteel)
	fill(img, x+5, y+2, 6, 13, colShadow)
	px(img, x+10, y+9, colSteelLt)
}

func paintBrickWindow(img *image.NRGBA, x, y int) {
	paintBrickWall(img, x, y)
	fill(img, x+2, y+2, 12, 9, colSteel)
	fill(img, x+3, y+3, 10, 7, colGlass)
	fill(img, x+3, y+3, 5, 3, colGlassDk)
	px(img, x+8, y+2, colSteel)
	px(img, x+2, y+6, colSteel)
}

func paintBrickInterior(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colInterior)
	fill(img, x+2, y+4, 4, 6, colBrickDk)
	fill(img, x, y+tile-2, tile, 2, colFloor)
}

func paintBrickRubble(img *image.NRGBA, x, y int) {
	fill(img, x+2, y+8, 4, 3, colBrick)
	fill(img, x+7, y+7, 5, 4, colBrickDk)
	fill(img, x+5, y+11, 7, 3, colMort)
	px(img, x+11, y+10, colBrickLt)
	px(img, x+3, y+12, colBrickDk)
	px(img, x+8, y+9, colCrack)
}

func paintConcWall(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colConc)
	for i := 0; i < tile; i += 3 {
		px(img, x+i, y+i%7, colConcLt)
		px(img, x+(i+5)%tile, y+10, colConcDk)
	}
	fill(img, x, y, tile, 1, colConcDk)
	fill(img, x, y+tile-1, tile, 1, colConcDk)
}

func paintConcRoof(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colConcLt)
	for yy := 3; yy < 13; yy += 3 {
		for xx := 2; xx < 14; xx += 3 {
			px(img, x+xx, y+yy, colConc)
		}
	}
	fill(img, x, y, tile, 2, colConcDk)
	fill(img, x, y+tile-2, tile, 2, colConc)
	// Hatch reads as a flat top plane, not vertical siding.
	for i := 1; i < tile-1; i += 2 {
		px(img, x+i, y+1, colConc)
	}
}

func paintConcEdge(img *image.NRGBA, x, y int) {
	paintConcRoof(img, x, y)
	fill(img, x, y+tile-3, tile, 3, colSteel)
}

func paintConcCorner(img *image.NRGBA, x, y int) {
	paintConcWall(img, x, y)
	fill(img, x, y, 3, tile, colConcDk)
	fill(img, x, y, tile, 3, colConcDk)
	px(img, x+1, y+1, colSteelLt)
}

func paintConcDoor(img *image.NRGBA, x, y int) {
	paintConcWall(img, x, y)
	fill(img, x+3, y+1, 10, 15, colSteel)
	fill(img, x+4, y+2, 8, 13, colShadow)
	fill(img, x+5, y+3, 6, 2, colSteelLt)
	px(img, x+11, y+9, colSteelLt)
}

func paintConcWindow(img *image.NRGBA, x, y int) {
	paintConcWall(img, x, y)
	fill(img, x+2, y+3, 12, 8, colSteel)
	fill(img, x+3, y+4, 10, 6, colGlassDk)
	fill(img, x+4, y+5, 4, 3, colGlass)
}

func paintConcInterior(img *image.NRGBA, x, y int) {
	fill(img, x, y, tile, tile, colFloor)
	fill(img, x+1, y+1, 6, 5, colConcDk)
	fill(img, x+9, y+8, 5, 5, colInterior)
}

func paintConcRubble(img *image.NRGBA, x, y int) {
	fill(img, x+2, y+8, 5, 4, colConc)
	fill(img, x+8, y+7, 5, 5, colConcDk)
	fill(img, x+4, y+12, 8, 3, colConcLt)
	px(img, x+12, y+10, colSteel)
	px(img, x+3, y+11, colCrack)
	px(img, x+9, y+9, colCrack)
}

func paintGlassRubble(img *image.NRGBA, x, y int) {
	for i := 0; i < 8; i++ {
		px(img, x+3+(i*2)%10, y+6+i%5, colGlass)
		px(img, x+4+(i*3)%9, y+8+i%4, colGlassDk)
	}
	fill(img, x+5, y+10, 6, 3, colRubble)
}

func paintSteelRubble(img *image.NRGBA, x, y int) {
	fill(img, x+3, y+6, 10, 7, colSteel)
	fill(img, x+4, y+7, 3, 2, colSteelLt)
	fill(img, x+8, y+9, 4, 3, colShadow)
}

func paintDust(img *image.NRGBA, x, y int, frame int) {
	c := color.RGBA{0x6E, 0x6A, 0x60, uint8(180 - frame*40)}
	r := 3 + frame*2
	cx, cy := x+8, y+8
	for dy := -r; dy <= r; dy++ {
		for dx := -r; dx <= r; dx++ {
			if dx*dx+dy*dy <= r*r {
				px(img, cx+dx, cy+dy, c)
			}
		}
	}
}

func paintFrag(img *image.NRGBA, x, y int, a, b color.RGBA) {
	fill(img, x+5, y+5, 6, 5, a)
	fill(img, x+6, y+6, 3, 2, b)
	px(img, x+10, y+7, a)
}

func paintScarAsh(img *image.NRGBA, x, y int) {
	for i := 0; i < 10; i++ {
		px(img, x+3+i, y+8+(i%3)-1, colRubble)
		px(img, x+4+i%8, y+10, colShadow)
	}
}

func paintScarGlass(img *image.NRGBA, x, y int) {
	for i := 0; i < 6; i++ {
		px(img, x+5+i, y+7+i%2, colGlassDk)
		px(img, x+6+i, y+9, colGlass)
	}
}
