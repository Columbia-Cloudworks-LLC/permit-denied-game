package render

import (
	"fmt"
	"image/color"
	"math"
	"sort"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/text/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"golang.org/x/image/font/basicfont"
	"permitdenied/internal/dozer"
	"permitdenied/internal/fx"
	"permitdenied/internal/lot"
	"permitdenied/internal/threats"
)

const (
	screenW = 320
	screenH = 224
)

var hudFace = text.NewGoXFace(basicfont.Face7x13)

type View struct {
	CamX, CamY, ShakeX, ShakeY float64
	Tick                       int
	Dozer                      dozer.Dozer
	Lot                        lot.Lot
	Cruiser                    threats.Cruiser
	Dollars                    []fx.Dollar
	Bursts                     []fx.Burst
	Frags                      []fx.Fragment
	Dusts                      []fx.Dust
	Flashes                    []fx.Flash
	Scars                      []fx.Scar
	Detritus                   []fx.Detritus
	Banner                     string
	BannerT                    float64
	StructCash, VehicleCash    int
	Heat                       float64
	Plates                     int
	BladeDown                  bool
	Speed                      float64
	Debug                      bool
	Time                       float64
	HideStance                 bool
	MapW, MapH                 float64
	DollarLife                 float64
	DollarRise                 float64
	HeatVent                   float64
	HeatPulse                  float64
	Impacts                    []lot.Impact
	LabDebug                   bool
}

type Tally struct {
	T           float64
	Death       string
	StructCash  int
	VehicleCash int
	Time        float64
	Total       int
	Roll        float64
}

type drawItem struct {
	y     float64
	draw  func(dst *ebiten.Image)
}

func world(v View, x, y float64) (float64, float64) {
	return x - v.CamX + v.ShakeX, y - v.CamY + v.ShakeY
}

func DrawWorld(dst *ebiten.Image, v View) {
	a, err := ensureAtlas()
	if err != nil || a == nil {
		dst.Fill(ColBG)
		return
	}
	dst.Fill(ColBG)
	drawGround(dst, v, a)
	drawBuildingShadows(dst, v)
	drawScars(dst, v, a)
	drawDetritus(dst, v, a)
	drawCollapsedFloors(dst, v)
	drawRubbleCells(dst, v, a)

	items := collectSorted(v, a)
	sort.SliceStable(items, func(i, j int) bool { return items[i].y < items[j].y })
	for _, it := range items {
		it.draw(dst)
	}

	drawFragments(dst, v, a)
	drawDust(dst, v, a)
	drawFlashes(dst, v)
	drawBursts(dst, v, a)
	drawDollars(dst, v)
	drawStructureSpill(dst, v)
	if v.Banner != "" && v.BannerT > 0 {
		drawText(dst, v.Banner, 8, 40, ColHUD)
	}
	if v.Debug {
		drawDebug(dst, v)
		if v.LabDebug {
			drawLabDebug(dst, v)
		}
	}
}

func drawGround(dst *ebiten.Image, v View, a *atlas) {
	for ty := range v.Lot.Ground {
		for tx, id := range v.Lot.Ground[ty] {
			if id <= 0 || id >= tileCount {
				continue
			}
			sx, sy := world(v, float64(tx*tileSize), float64(ty*tileSize))
			if sx > screenW || sy > screenH || sx+tileSize < 0 || sy+tileSize < 0 {
				continue
			}
			op := &ebiten.DrawImageOptions{}
			op.GeoM.Translate(sx, sy)
			op.Filter = ebiten.FilterNearest
			dst.DrawImage(a.tileImg[id], op)
		}
	}
}

func blitBuilding(dst *ebiten.Image, a *atlas, name string, sx, sy float64) {
	img, _, ok := a.building(name)
	if !ok {
		vector.DrawFilledRect(dst, float32(sx), float32(sy), tileSize, tileSize, ColBuilding, false)
		return
	}
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(sx, sy)
	op.Filter = ebiten.FilterNearest
	dst.DrawImage(img, op)
}

func blitRubble(dst *ebiten.Image, a *atlas, name string, sx, sy float64) {
	// Dark pit under the pile so missing structure reads clearly.
	vector.DrawFilledRect(dst, float32(sx+1), float32(sy+1), tileSize-2, tileSize-2, ColShadow, false)
	blitBuilding(dst, a, name, sx, sy)
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
			sx, sy := world(v, wx, wy)
			blitRubble(dst, a, c.Rubble, sx, sy)
		}
	}
}

func collectSorted(v View, a *atlas) []drawItem {
	var items []drawItem
	for si := range v.Lot.Structures {
		s := &v.Lot.Structures[si]
		stories := s.Stories
		if stories < 1 {
			stories = 1
		}
		fh := facadeH(stories)
		for i := range s.Cells {
			c := &s.Cells[i]
			if !c.Present() || c.State == lot.Rubble {
				continue
			}
			if c.Kind == lot.KindInterior {
				continue
			}
			lx, ly := s.Index(i)
			wx, wy := s.WorldXY(lx, ly)
			name := c.Frame()
			if c.State == lot.Broken {
				name = c.Tile + "_crack"
			}
			cx, cy := wx, wy
			nm := name
			st := stories
			mat := c.Mat
			isDeck := c.IsDeck()
			lift := c.LiftDrawY(stories)
			southFace := ly == s.H-1 && !isDeck && c.State != lot.Broken
			// Depth: footprint south edge. Elevated decks sort above same-row walls.
			cellY := wy + tileSize
			if isDeck {
				cellY += float64(st)*2 + 1
			}
			items = append(items, drawItem{
				y: cellY,
				draw: func(dst *ebiten.Image) {
					sx, sy := world(v, cx, cy)
					if southFace {
						fc := matFacadeColor(mat)
						// Full-height south elevation.
						fillRect(dst, sx, sy-fh, tileSize, fh, fc)
						fillRect(dst, sx, sy-fh, tileSize, 2, shadeRGBA(fc, 40))
						fillRect(dst, sx, sy-2, tileSize, 2, shadeRGBA(fc, -45))
						// Story divider + upper window band.
						if st >= 2 {
							mid := sy - fh/2
							fillRect(dst, sx, mid-1, tileSize, 2, shadeRGBA(fc, -25))
							fillRect(dst, sx+3, sy-fh+3, tileSize-6, 4, color.RGBA{0x2A, 0x4A, 0x5A, 0xFF})
							fillRect(dst, sx+4, sy-fh+4, tileSize-8, 2, color.RGBA{0x6A, 0xC0, 0xD8, 0xAA})
						}
						// Roof overhang lip sitting on the façade top.
						lip := shadeRGBA(fc, 55)
						fillRect(dst, sx-1, sy-fh-3, tileSize+2, 3, lip)
						fillRect(dst, sx-1, sy-fh-3, tileSize+2, 1, color.RGBA{0, 0, 0, 0x55})
					}
					shade := float32(1)
					if isDeck && lift > 0 {
						// Soft top shading so elevated roofs read as mass.
						shade = 1.05
					}
					blitBuildingShaded(dst, a, nm, sx, sy, lift, shade)
					// Roof lip over south façade when deck still stands behind it.
					if southFace && fh > 0 {
						vector.StrokeLine(dst,
							float32(sx), float32(sy-fh),
							float32(sx+tileSize), float32(sy-fh),
							1, color.RGBA{0, 0, 0, 0x66}, false)
					}
				},
			})
		}
	}
	if v.Cruiser.Alive {
		cx, cy := v.Cruiser.X, v.Cruiser.Y
		items = append(items, drawItem{
			y: cy + 8,
			draw: func(dst *ebiten.Image) {
				drawCruiser(dst, v, a, cx, cy)
			},
		})
	}
	dx, dy := v.Dozer.X, v.Dozer.Y
	items = append(items, drawItem{
		y: dy + 14,
		draw: func(dst *ebiten.Image) {
			drawDozer(dst, v, a, dx, dy)
		},
	})
	return items
}

func materialPrefix(m lot.Material) string {
	switch m {
	case lot.MatWood:
		return "wood"
	case lot.MatBrick:
		return "brick"
	case lot.MatConcrete:
		return "conc"
	default:
		return "conc"
	}
}

func facingName(prefix string, heading float64) string {
	idx := facingIndex(heading)
	return fmt.Sprintf("%s_%02d", prefix, idx)
}

func facingIndex(heading float64) int {
	const step = 2 * math.Pi / 16
	h := math.Mod(heading+step/2, 2*math.Pi)
	if h < 0 {
		h += 2 * math.Pi
	}
	return int(h / step)
}

func drawDozer(dst *ebiten.Image, v View, a *atlas, x, y float64) {
	prefix := "dozer_up"
	if v.Dozer.BladeDown {
		prefix = "dozer_down"
	}
	name := facingName(prefix, v.Dozer.Heading)
	img, f, ok := a.sprite(name)
	sx, sy := world(v, x, y)
	if !ok {
		vector.DrawFilledRect(dst, float32(sx-12), float32(sy-12), 24, 24, ColPaint, false)
		return
	}
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(-f.AnchorX, -f.AnchorY)
	op.GeoM.Translate(sx, sy)
	op.Filter = ebiten.FilterNearest
	pc := PlateColor(v.Plates)
	op.ColorScale.Scale(float32(pc.R)/255, float32(pc.G)/255, float32(pc.B)/255, 1)
	if v.Heat > v.HeatVent {
		t := (v.Heat - v.HeatVent) / (100 - v.HeatVent)
		op.ColorScale.ScaleWithColor(mix(pc, ColHeat, t))
	}
	dst.DrawImage(img, op)
}

func drawCruiser(dst *ebiten.Image, v View, a *atlas, x, y float64) {
	name := facingName("cruiser", v.Cruiser.Heading)
	img, f, ok := a.sprite(name)
	sx, sy := world(v, x, y)
	if !ok {
		vector.DrawFilledCircle(dst, float32(sx), float32(sy), 8, ColCruiser, false)
		return
	}
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(-f.AnchorX, -f.AnchorY)
	op.GeoM.Translate(sx, sy)
	op.Filter = ebiten.FilterNearest
	dst.DrawImage(img, op)
}

func drawScars(dst *ebiten.Image, v View, a *atlas) {
	for _, s := range v.Scars {
		name := "scar_ash"
		if s.Kind == 2 {
			name = "scar_glass"
		}
		sx, sy := world(v, s.X-8, s.Y-8)
		blitBuilding(dst, a, name, sx, sy)
	}
}

func drawDetritus(dst *ebiten.Image, v View, a *atlas) {
	for _, d := range v.Detritus {
		name := fragName(d.Mat)
		img, f, ok := a.building(name)
		if !ok {
			continue
		}
		sx, sy := world(v, d.X, d.Y)
		op := &ebiten.DrawImageOptions{}
		op.GeoM.Translate(-f.AnchorX, -f.AnchorY)
		op.GeoM.Rotate(d.Rot)
		op.GeoM.Translate(sx, sy)
		op.Filter = ebiten.FilterNearest
		op.ColorScale.Scale(1, 1, 1, 0.85)
		dst.DrawImage(img, op)
	}
}

func fragName(mat int) string {
	switch lot.Material(mat) {
	case lot.MatWood:
		return "frag_wood"
	case lot.MatBrick:
		return "frag_brick"
	case lot.MatConcrete:
		return "frag_conc"
	case lot.MatGlass:
		return "frag_glass"
	case lot.MatSteel:
		return "frag_steel"
	default:
		return "frag_conc"
	}
}

func drawFragments(dst *ebiten.Image, v View, a *atlas) {
	for _, p := range v.Frags {
		name := fragName(p.Mat)
		img, f, ok := a.building(name)
		if !ok {
			continue
		}
		sx, sy := world(v, p.X, p.Y)
		// Short-lived shadow.
		sh := float32(3 + 2*(p.Life/p.Max))
		vector.DrawFilledCircle(dst, float32(sx), float32(sy+4), sh, ColShadow, false)
		op := &ebiten.DrawImageOptions{}
		op.GeoM.Translate(-f.AnchorX, -f.AnchorY)
		op.GeoM.Rotate(p.Rot)
		op.GeoM.Translate(sx, sy)
		op.Filter = ebiten.FilterNearest
		alpha := float32(p.Life / p.Max)
		if alpha < 0 {
			alpha = 0
		}
		op.ColorScale.Scale(1, 1, 1, alpha)
		dst.DrawImage(img, op)
	}
}

func drawDust(dst *ebiten.Image, v View, a *atlas) {
	for _, d := range v.Dusts {
		frame := d.Age * 4 / d.MaxAge
		if frame > 3 {
			frame = 3
		}
		name := fmt.Sprintf("dust_%d", frame)
		sx, sy := world(v, d.X-8, d.Y-8)
		img, _, ok := a.building(name)
		if !ok {
			vector.DrawFilledCircle(dst, float32(sx+8), float32(sy+8), float32(6+d.Age), ColSmoke, false)
			continue
		}
		op := &ebiten.DrawImageOptions{}
		sc := d.Scale * (1 + float64(d.Age)*0.04)
		op.GeoM.Translate(-8, -8)
		op.GeoM.Scale(sc, sc)
		op.GeoM.Translate(sx+8, sy+8)
		op.Filter = ebiten.FilterNearest
		alpha := 1 - float32(d.Age)/float32(d.MaxAge)
		op.ColorScale.Scale(1, 1, 1, alpha*0.85)
		dst.DrawImage(img, op)
	}
}

func drawFlashes(dst *ebiten.Image, v View) {
	for _, fl := range v.Flashes {
		sx, sy := world(v, fl.X, fl.Y)
		alpha := 1 - float64(fl.Age)/float64(fl.Max)
		c := color.RGBA{255, 255, 255, uint8(200 * alpha)}
		vector.DrawFilledCircle(dst, float32(sx), float32(sy), float32(4+fl.Age), c, false)
	}
}

func drawBursts(dst *ebiten.Image, v View, a *atlas) {
	for _, b := range v.Bursts {
		var name string
		if b.Kind == 1 {
			name = fmt.Sprintf("spark_%02d", b.Age)
		} else {
			name = fmt.Sprintf("boom_%02d", b.Age)
		}
		img, f, ok := a.sprite(name)
		if !ok {
			continue
		}
		sx, sy := world(v, b.X, b.Y)
		op := &ebiten.DrawImageOptions{}
		op.GeoM.Translate(-f.AnchorX, -f.AnchorY)
		op.GeoM.Translate(sx, sy)
		op.Filter = ebiten.FilterNearest
		dst.DrawImage(img, op)
	}
}

func drawDollars(dst *ebiten.Image, v View) {
	for _, d := range v.Dollars {
		rise := (v.DollarLife - d.Life) * v.DollarRise
		sx, sy := world(v, d.X, d.Y-rise)
		drawText(dst, fmt.Sprintf("$%d", d.Amt), sx-8, sy, ColMoney)
	}
}

func drawDebug(dst *ebiten.Image, v View) {
	for _, s := range v.Lot.CollectSolids() {
		sx, sy := world(v, s.X, s.Y)
		c := color.RGBA{0, 255, 0, 80}
		if s.Rubble {
			c = color.RGBA{255, 128, 0, 100}
		}
		vector.StrokeRect(dst, float32(sx), float32(sy), float32(s.W), float32(s.H), 1, c, false)
	}
	sx, sy := world(v, v.Dozer.X, v.Dozer.Y)
	vector.StrokeCircle(dst, float32(sx), float32(sy), 14, 1, color.RGBA{255, 255, 0, 180}, false)
}

func DrawHUD(dst *ebiten.Image, v View) {
	cash := v.StructCash + v.VehicleCash
	drawText(dst, fmt.Sprintf("$%d", cash), 8, 8, ColMoney)
	elapsed := int(v.Time)
	drawText(dst, fmt.Sprintf("%d:%02d", elapsed/60, elapsed%60), screenW/2-12, 8, ColHUD)
	if !v.HideStance {
		stance := "BLADE UP"
		sc := ColStanceUp
		if v.BladeDown {
			stance = "BLADE DOWN"
			sc = ColStanceDn
		}
		drawText(dst, stance, screenW-90, 8, sc)
	}
	drawText(dst, "R - AGAIN", 8, screenH-14, ColLabel)
}

func DrawTally(dst *ebiten.Image, t Tally) {
	vector.DrawFilledRect(dst, 40, 40, 240, 140, ColPanel, false)
	drawText(dst, t.Death, 60, 55, ColHeat)
	drawText(dst, fmt.Sprintf("STRUCTURE  $%d", t.StructCash), 60, 80, ColHUD)
	drawText(dst, fmt.Sprintf("VEHICLE    $%d", t.VehicleCash), 60, 96, ColHUD)
	drawText(dst, fmt.Sprintf("TIME       %.0fs", t.Time), 60, 112, ColHUD)
	drawText(dst, fmt.Sprintf("TOTAL      $%d", t.Total), 60, 132, ColMoney)
	drawText(dst, "SPACE / R — AGAIN", 60, 155, ColLabel)
}

func drawText(dst *ebiten.Image, s string, x, y float64, c color.Color) {
	op := &text.DrawOptions{}
	op.GeoM.Translate(x, y)
	op.ColorScale.ScaleWithColor(c)
	text.Draw(dst, s, hudFace, op)
}
