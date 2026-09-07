// Command capture-elevated writes proof PNGs for elevated buildings / collapse.
// Run under a display (Xvfb): go run ./cmd/capture-elevated --out DIR
package main

import (
	"flag"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"

	"github.com/hajimehoshi/ebiten/v2"
	"permitdenied/internal/dozer"
	"permitdenied/internal/lot"
	"permitdenied/internal/render"
	"permitdenied/internal/threats"
)

func main() {
	out := flag.String("out", "artifacts/elevated_capture", "output directory")
	flag.Parse()
	if err := os.MkdirAll(*out, 0o755); err != nil {
		fatal(err)
	}
	h := &capturer{out: *out}
	ebiten.SetWindowSize(320*4, 224*4)
	ebiten.SetWindowTitle("PERMIT DENIED capture")
	ebiten.SetTPS(60)
	if err := ebiten.RunGameWithOptions(h, &ebiten.RunGameOptions{InitUnfocused: true}); err != nil && err != ebiten.Termination {
		fatal(err)
	}
	if h.err != nil {
		fatal(h.err)
	}
	fmt.Printf("{\"ok\":true,\"out\":%q,\"frames\":%d}\n", *out, h.frames)
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "capture-elevated: %v\n", err)
	os.Exit(1)
}

type capturer struct {
	out    string
	phase  int
	wait   int
	l      lot.Lot
	err    error
	frames int
	done   bool
}

func (h *capturer) Layout(int, int) (int, int) { return 320, 224 }

func (h *capturer) Update() error {
	if h.err != nil || h.done {
		return ebiten.Termination
	}
	if h.wait > 0 {
		h.wait--
		if h.phase >= 4 && h.phase <= 7 {
			_ = h.l.CollapseTick()
		}
		return nil
	}
	switch h.phase {
	case 0:
		h.l = lot.TestLot()
		h.phase = 1
		h.wait = 1 // draw intact
	case 1:
		// 60s untouched
		for i := 0; i < 60*60; i++ {
			if br := h.l.CollapseTick(); len(br) > 0 {
				h.err = fmt.Errorf("untouched broke at %d", i)
				return ebiten.Termination
			}
		}
		h.phase = 2
		h.wait = 1
	case 2:
		// Localized SW breach — walls only, minimal collapse ticks.
		h.l = lot.TestLot()
		s := h.l.StructureByLabel("HALL")
		for _, p := range [][2]int{{0, 5}, {1, 5}, {2, 5}} {
			s.ApplyDamage(p[0], p[1], 999)
			s.FinishBroken(p[0], p[1])
		}
		h.phase = 3
		h.wait = 1
	case 3:
		// Full south — capture warning sag before tiles drop.
		h.l = lot.TestLot()
		s := h.l.StructureByLabel("HALL")
		for x := 0; x < s.W; x++ {
			s.ApplyDamage(x, s.H-1, 999)
			s.FinishBroken(x, s.H-1)
		}
		s.ImpactDirX, s.ImpactDirY = 0, -1
		h.phase = 4
		h.wait = 12 // sag / warning
	case 4:
		h.phase = 5
		h.wait = 22 // falling begins ~tick 20+
	case 5:
		h.phase = 6
		h.wait = 40
	case 6:
		h.phase = 7
		h.wait = 220
	case 7:
		// East attack contrast lot
		h.l = lot.TestLot()
		s := h.l.StructureByLabel("HALL")
		for y := 1; y < s.H-1; y++ {
			s.ApplyDamage(s.W-1, y, 999)
			s.FinishBroken(s.W-1, y)
		}
		s.BreachLX, s.BreachLY = s.W-1, s.H/2
		s.ImpactDirX, s.ImpactDirY = -1, 0
		for i := 0; i < 120; i++ {
			h.l.CollapseTick()
		}
		h.phase = 8
		h.wait = 1
	case 8:
		h.done = true
		return ebiten.Termination
	}
	return nil
}

func (h *capturer) Draw(screen *ebiten.Image) {
	if h.err != nil || h.phase == 0 {
		return
	}
	name := ""
	switch h.phase {
	case 1:
		if h.wait == 0 {
			name = "A_intact_hall"
		}
	case 2:
		if h.wait == 0 {
			name = "A_after_60s"
		}
	case 3:
		if h.wait == 0 {
			name = "B_localized_breach"
		}
	case 4:
		if h.wait == 0 {
			name = "D_sag"
		}
	case 5:
		if h.wait == 0 {
			name = "D_falling"
		}
	case 6:
		if h.wait == 0 {
			name = "D_collapsing"
		}
	case 7:
		if h.wait == 0 {
			name = "D_settled"
		}
	case 8:
		if h.wait == 0 {
			name = "C_east_aftermath"
		}
	}
	if name == "" {
		h.drawLot(screen)
		return
	}
	h.drawLot(screen)
	path := filepath.Join(h.out, name+".png")
	if err := writePNG(screen, path); err != nil {
		h.err = err
		return
	}
	if err := writeScaled(screen, filepath.Join(h.out, name+"_4x.png"), 4); err != nil {
		h.err = err
		return
	}
	h.frames++
}

func (h *capturer) drawLot(screen *ebiten.Image) {
	hall := h.l.StructureByLabel("HALL")
	camX, camY := 0.0, 0.0
	if hall != nil {
		camX = float64(hall.TX*lot.Tile) - 24
		camY = float64(hall.TY*lot.Tile) - 8
		if camX < 0 {
			camX = 0
		}
		if camY < 0 {
			camY = 0
		}
	}
	dz := dozer.Spawn(200, 180)
	v := render.View{
		CamX: camX, CamY: camY,
		Lot: h.l, Dozer: dz,
		Cruiser: threats.SpawnCruiser(340, 220),
		MapW:    h.l.W, MapH: h.l.H,
		BladeDown:  true,
		StructCash: 0,
	}
	// Approximate cash from rubble for HUD flavor on later phases.
	for si := range h.l.Structures {
		for i := range h.l.Structures[si].Cells {
			c := &h.l.Structures[si].Cells[i]
			if c.Paid {
				v.StructCash += c.Value
			}
		}
	}
	render.DrawWorld(screen, v)
	render.DrawHUD(screen, v)
}

func writePNG(screen *ebiten.Image, path string) error {
	w, ht := screen.Bounds().Dx(), screen.Bounds().Dy()
	pix := make([]byte, 4*w*ht)
	screen.ReadPixels(pix)
	nrgba := image.NewNRGBA(image.Rect(0, 0, w, ht))
	copy(nrgba.Pix, pix)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, nrgba)
}

func writeScaled(screen *ebiten.Image, path string, scale int) error {
	w, ht := screen.Bounds().Dx(), screen.Bounds().Dy()
	pix := make([]byte, 4*w*ht)
	screen.ReadPixels(pix)
	dst := image.NewNRGBA(image.Rect(0, 0, w*scale, ht*scale))
	for y := 0; y < ht; y++ {
		for x := 0; x < w; x++ {
			i := 4 * (y*w + x)
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					oi := ((y*scale+dy)*w*scale + (x*scale + dx)) * 4
					dst.Pix[oi] = pix[i]
					dst.Pix[oi+1] = pix[i+1]
					dst.Pix[oi+2] = pix[i+2]
					dst.Pix[oi+3] = pix[i+3]
				}
			}
		}
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, dst)
}
