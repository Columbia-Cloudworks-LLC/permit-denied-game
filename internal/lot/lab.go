package lot

// LabBrickMunicipal is a 6×5 brick municipal for directional destruction tests.
// Perimeter walls, interior KindCorner supports at (2,1)/(3,1), roofs inside.
func LabBrickMunicipal() Structure {
	const w, h = 6, 5
	cells := emptyGrid(w, h)
	wall := makeCell(KindWall, MatBrick, "brick_wall", "brick_rubble")
	roof := makeCell(KindRoof, MatBrick, "brick_roof", "brick_rubble")
	corner := makeCell(KindCorner, MatBrick, "brick_corner", "brick_rubble")

	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			border := x == 0 || x == w-1 || y == 0 || y == h-1
			if !border {
				// Supports near the north so a south bite undercuts southern roofs
				// while an east bite undercuts eastern roofs.
				if (x == 2 || x == 3) && y == 1 {
					setCell(cells, w, x, y, corner)
					continue
				}
				setCell(cells, w, x, y, roof)
				continue
			}
			if (x == 0 || x == w-1) && (y == 0 || y == h-1) {
				setCell(cells, w, x, y, corner)
			} else {
				setCell(cells, w, x, y, wall)
			}
		}
	}
	// Centered on the sandbox asphalt pad (25×18 tiles).
	return Structure{
		Label:    "MUNICIPAL",
		TX:       9,
		TY:       6,
		W:        w,
		H:        h,
		Stories:  2,
		Cells:    cells,
		BreachLX: -1,
		BreachLY: -1,
	}
}

// NewLabLot returns a sandbox-sized lot with only the brick municipal.
func NewLabLot() Lot {
	const tw, th = 25, 18
	ground := make([][]int, th)
	for y := 0; y < th; y++ {
		ground[y] = make([]int, tw)
		for x := 0; x < tw; x++ {
			ground[y][x] = 1
		}
	}
	for y := 2; y < th-1; y++ {
		for x := 3; x < tw-3; x++ {
			ground[y][x] = 5
		}
	}
	l := Lot{
		W:          float64(tw * Tile),
		H:          float64(th * Tile),
		Structures: []Structure{LabBrickMunicipal()},
		Ground:     ground,
	}
	l.Structures[0].BindAnchors()
	if err := l.Structures[0].ValidateSupport(); err != nil {
		panic(err)
	}
	return l
}
