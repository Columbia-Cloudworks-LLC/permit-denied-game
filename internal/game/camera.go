package game

func (g *Game) camera() (camX, camY float64) {
	camX = clamp(g.dozer.X-ScreenW/2, 0, LotW-ScreenW)
	camY = clamp(g.dozer.Y-ScreenH/2, 0, LotH-ScreenH)
	return camX, camY
}
