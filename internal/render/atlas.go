package render

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/png"
	"sync"

	"github.com/hajimehoshi/ebiten/v2"
	"permitdenied/assets"
)

const (
	tilesetCols = 8
	tileCount   = 19
	tileSize    = 16
)

type frame struct {
	X, Y, W, H int
	AnchorX    float64
	AnchorY    float64
}

type atlas struct {
	tileset   *ebiten.Image
	sprites   *ebiten.Image
	buildings *ebiten.Image
	frames    map[string]frame
	bframes   map[string]frame
	tileImg   [tileCount]*ebiten.Image
}

var (
	atlasOnce sync.Once
	atlasInst *atlas
	atlasErr  error
)

func ensureAtlas() (*atlas, error) {
	atlasOnce.Do(func() {
		atlasInst, atlasErr = loadAtlas()
	})
	return atlasInst, atlasErr
}

func loadAtlas() (*atlas, error) {
	a := &atlas{
		frames:  make(map[string]frame),
		bframes: make(map[string]frame),
	}
	tilesetImg, err := decodePNG("usable/tileset.png")
	if err != nil {
		return nil, err
	}
	a.tileset = ebiten.NewImageFromImage(tilesetImg)

	spritesImg, err := decodePNG("usable/sprites.png")
	if err != nil {
		return nil, err
	}
	a.sprites = ebiten.NewImageFromImage(spritesImg)

	buildImg, err := decodePNG("usable/buildings.png")
	if err != nil {
		return nil, err
	}
	a.buildings = ebiten.NewImageFromImage(buildImg)

	if err := a.loadFrames("usable/sprites.json", a.frames); err != nil {
		return nil, err
	}
	if err := a.loadFrames("usable/buildings.json", a.bframes); err != nil {
		return nil, err
	}
	a.cacheTiles()
	return a, nil
}

func decodePNG(path string) (image.Image, error) {
	b, err := assets.FS.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	return img, nil
}

type spritesJSON struct {
	Frames map[string]struct {
		X      int       `json:"x"`
		Y      int       `json:"y"`
		W      int       `json:"w"`
		H      int       `json:"h"`
		Anchor []float64 `json:"anchor"`
	} `json:"frames"`
}

func (a *atlas) loadFrames(path string, into map[string]frame) error {
	b, err := assets.FS.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	var doc spritesJSON
	if err := json.Unmarshal(b, &doc); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	for name, f := range doc.Frames {
		fr := frame{X: f.X, Y: f.Y, W: f.W, H: f.H}
		if len(f.Anchor) >= 2 {
			fr.AnchorX = f.Anchor[0]
			fr.AnchorY = f.Anchor[1]
		} else {
			fr.AnchorX = float64(f.W) / 2
			fr.AnchorY = float64(f.H) / 2
		}
		into[name] = fr
	}
	return nil
}

func (a *atlas) cacheTiles() {
	for id := 0; id < tileCount; id++ {
		tx := (id % tilesetCols) * tileSize
		ty := (id / tilesetCols) * tileSize
		a.tileImg[id] = a.tileset.SubImage(image.Rect(tx, ty, tx+tileSize, ty+tileSize)).(*ebiten.Image)
	}
}

func (a *atlas) sprite(name string) (*ebiten.Image, frame, bool) {
	f, ok := a.frames[name]
	if !ok {
		return nil, frame{}, false
	}
	sub := a.sprites.SubImage(image.Rect(f.X, f.Y, f.X+f.W, f.Y+f.H)).(*ebiten.Image)
	return sub, f, true
}

func (a *atlas) building(name string) (*ebiten.Image, frame, bool) {
	f, ok := a.bframes[name]
	if !ok {
		return nil, frame{}, false
	}
	sub := a.buildings.SubImage(image.Rect(f.X, f.Y, f.X+f.W, f.Y+f.H)).(*ebiten.Image)
	return sub, f, true
}
