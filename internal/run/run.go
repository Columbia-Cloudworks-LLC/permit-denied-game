package run

// Run is one sandbox attempt.
type Run struct {
	Tick        int
	Over        bool
	Death       string // "", "cooked", "track", "buzzer", "pinned"
	StructCash  int
	VehicleCash int
	TimeAlive   float64
	Hunting     bool // cruiser starts hunting after first wreck
}

func New() Run {
	return Run{}
}

func (r *Run) Time() float64 {
	return float64(r.Tick) / 60.0
}

func (r *Run) Raw() int {
	return r.StructCash + r.VehicleCash + int(r.TimeAlive)
}

func (r *Run) Final() int {
	return r.Raw()
}
