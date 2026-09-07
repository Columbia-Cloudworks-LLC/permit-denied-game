package fx

import "math"

type Dollar struct {
	X, Y float64
	Amt  int
	Life float64
}

type Fragment struct {
	X, Y, VX, VY float64
	Rot, VRot    float64
	Life, Max    float64
	Mat          int // lot.Material as int to avoid import cycle
	Bounce       int
	Scale        float64
}

type Dust struct {
	X, Y       float64
	Age        int
	MaxAge     int
	Scale      float64
	TR, TG, TB float32
}

type Flash struct {
	X, Y float64
	Age  int
	Max  int
}

type Scar struct {
	X, Y float64
	Kind int // 0 skid, 1 ash, 2 glass
}

type Detritus struct {
	X, Y float64
	Mat  int
	Rot  float64
}

type Burst struct {
	X, Y float64
	Kind int // 0 boom, 1 spark
	Age  int
	Max  int
}

func (b Burst) Dead() bool { return b.Age >= b.Max }

type FX struct {
	HitStop  int
	Shake    float64
	Dollars  []Dollar
	Bursts   []Burst
	Frags    []Fragment
	Dusts    []Dust
	Flashes  []Flash
	Scars    []Scar
	Detritus []Detritus
	Banner   string
	BannerT  float64
	TallyT   float64
}

func (f *FX) SpawnDollar(x, y float64, amt int, life float64) {
	f.Dollars = append(f.Dollars, Dollar{X: x, Y: y, Amt: amt, Life: life})
}

func (f *FX) SetBanner(s string, life float64) {
	f.Banner = s
	f.BannerT = life
}

func (f *FX) SpawnBoom(x, y float64) {
	f.Bursts = append(f.Bursts, Burst{X: x, Y: y, Kind: 0, Max: 6})
}

func (f *FX) SpawnSpark(x, y float64) {
	f.Bursts = append(f.Bursts, Burst{X: x, Y: y, Kind: 1, Max: 4})
}

func (f *FX) SpawnFlash(x, y float64) {
	f.Flashes = append(f.Flashes, Flash{X: x, Y: y, Max: 4})
}

func (f *FX) SpawnDust(x, y float64, scale float64) {
	f.SpawnDustTinted(x, y, scale, 1, 1, 1, 24)
}

func (f *FX) SpawnDustTinted(x, y float64, scale float64, r, g, b float32, maxAge int) {
	if r == 0 && g == 0 && b == 0 {
		r, g, b = 1, 1, 1
	}
	if maxAge < 8 {
		maxAge = 8
	}
	f.Dusts = append(f.Dusts, Dust{X: x, Y: y, MaxAge: maxAge, Scale: scale, TR: r, TG: g, TB: b})
}

func (f *FX) SpawnScar(x, y float64, kind int) {
	f.Scars = append(f.Scars, Scar{X: x, Y: y, Kind: kind})
}

func (f *FX) SpawnDetritus(x, y float64, mat int, rot float64) {
	f.Detritus = append(f.Detritus, Detritus{X: x, Y: y, Mat: mat, Rot: rot})
}

// SpawnFragments emits material-colored tumbling chips (draw-only, no collision).
func (f *FX) SpawnFragments(x, y float64, mat int, n int, spread float64) {
	f.SpawnFragmentsScale(x, y, mat, n, spread, 1)
}

func (f *FX) SpawnFragmentsScale(x, y float64, mat int, n int, spread float64, scale float64) {
	if scale <= 0 {
		scale = 1
	}
	for i := 0; i < n; i++ {
		ang := float64(i)/float64(n)*2*math.Pi + spread
		spd := 40 + float64(i%5)*12
		life := 0.7 + float64(i%4)*0.1
		if scale > 1.2 {
			life += 0.35
			spd += 20
		}
		f.Frags = append(f.Frags, Fragment{
			X: x, Y: y,
			VX: math.Cos(ang) * spd, VY: math.Sin(ang)*spd - 30,
			Rot: float64(i) * 0.7, VRot: 4 + float64(i%3),
			Life: life, Max: life + 0.2,
			Mat: mat, Scale: scale,
		})
	}
}

func (f *FX) Step(dt, shakeDecay float64) {
	if f.Shake > 0 {
		f.Shake -= shakeDecay * dt
		if f.Shake < 0 {
			f.Shake = 0
		}
	}
	if f.BannerT > 0 {
		f.BannerT -= dt
		if f.BannerT <= 0 {
			f.BannerT = 0
			f.Banner = ""
		}
	}
	n := 0
	for i := range f.Dollars {
		d := f.Dollars[i]
		d.Life -= dt
		if d.Life <= 0 {
			continue
		}
		f.Dollars[n] = d
		n++
	}
	f.Dollars = f.Dollars[:n]

	bn := 0
	for i := range f.Bursts {
		b := f.Bursts[i]
		b.Age++
		if b.Dead() {
			continue
		}
		f.Bursts[bn] = b
		bn++
	}
	f.Bursts = f.Bursts[:bn]

	fn := 0
	const gravity = 220.0
	for i := range f.Frags {
		p := f.Frags[i]
		p.Life -= dt
		if p.Life <= 0 {
			// Leave a speck of detritus where it died.
			f.SpawnDetritus(p.X, p.Y, p.Mat, p.Rot)
			continue
		}
		p.VY += gravity * dt
		p.X += p.VX * dt
		p.Y += p.VY * dt
		p.Rot += p.VRot * dt
		if p.Y > 0 && p.Bounce < 2 && p.VY > 40 {
			// Soft bounce against an imaginary ground plane relative to spawn — keep simple.
			p.VY *= -0.35
			p.VX *= 0.7
			p.Bounce++
		}
		f.Frags[fn] = p
		fn++
	}
	f.Frags = f.Frags[:fn]

	dn := 0
	for i := range f.Dusts {
		d := f.Dusts[i]
		d.Age++
		if d.Age >= d.MaxAge {
			continue
		}
		f.Dusts[dn] = d
		dn++
	}
	f.Dusts = f.Dusts[:dn]

	fln := 0
	for i := range f.Flashes {
		fl := f.Flashes[i]
		fl.Age++
		if fl.Age >= fl.Max {
			continue
		}
		f.Flashes[fln] = fl
		fln++
	}
	f.Flashes = f.Flashes[:fln]
}

func (f *FX) Offsets(tick int) (sx, sy float64) {
	if f.Shake <= 0 {
		return 0, 0
	}
	t := float64(tick)
	return f.Shake * math.Sin(t*1.7), f.Shake * math.Cos(t*1.9)
}
