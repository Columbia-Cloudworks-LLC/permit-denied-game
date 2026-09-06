package fx

func (b Burst) FrameName() string {
	if b.Kind == 1 {
		return "spark_0" + string(rune('0'+b.Age))
	}
	return "boom_0" + string(rune('0'+b.Age))
}
