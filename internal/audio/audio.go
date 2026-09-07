package audio

import (
	"bytes"
	"io"
	"math"
	"os"
	"sync"

	"github.com/hajimehoshi/ebiten/v2/audio/wav"
	"permitdenied/assets"

	ebitenaudio "github.com/hajimehoshi/ebiten/v2/audio"
)

const oneShotCap = 3

type Audio struct {
	mu        sync.Mutex
	ctx       *ebitenaudio.Context
	chase     *ebitenaudio.Player
	chip      *ebitenaudio.Player
	shots     [oneShotCap]*ebitenaudio.Player
	crunchB   []byte
	wreckB    []byte
	peelB     []byte
	burstB    []byte
	tallyDuck bool
	wreckDuck bool
	musicMute bool
	ready     bool
}

func (a *Audio) ensure() {
	if a == nil || a.ready {
		return
	}
	defer func() {
		_ = recover()
		a.ready = true
	}()
	// Harness / headless environments often have no ALSA device.
	if os.Getenv("PERMITDENIED_SILENT") != "" {
		return
	}
	ctx := ebitenaudio.CurrentContext()
	if ctx == nil {
		ctx = ebitenaudio.NewContext(44100)
	}
	a.ctx = ctx
	a.crunchB = genCrunch(44100)
	a.wreckB = loadSample("wreck.wav")
	a.peelB = loadSample("peel.wav")
	a.burstB = loadSample("burst.wav")
	if len(a.wreckB) == 0 {
		a.wreckB = a.crunchB
	}
	if len(a.peelB) == 0 {
		a.peelB = a.crunchB
	}
	if len(a.burstB) == 0 {
		a.burstB = a.crunchB
	}
	loop := genChase(44100)
	src := ebitenaudio.NewInfiniteLoop(bytes.NewReader(loop), int64(len(loop)))
	p, err := a.ctx.NewPlayer(src)
	if err == nil {
		p.SetVolume(0.35)
		a.chase = p
	}
	if len(a.crunchB) > 0 {
		chipSrc := ebitenaudio.NewInfiniteLoop(bytes.NewReader(a.crunchB), int64(len(a.crunchB)))
		cp, err := a.ctx.NewPlayer(chipSrc)
		if err == nil {
			cp.SetVolume(0.40)
			a.chip = cp
		}
	}
}

func (a *Audio) StartChase() {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.ensure()
	a.wreckDuck = false
	a.applyChaseVol()
	if a.chase != nil {
		_ = a.chase.Rewind()
		a.chase.Play()
	}
}

func (a *Audio) Duck(tally bool) {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tallyDuck = tally
	a.applyChaseVol()
}

func (a *Audio) DuckWreck(active bool) {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.ensure()
	a.wreckDuck = active
	a.applyChaseVol()
	a.setChip(active)
}

func (a *Audio) ChaseVolume() float64 {
	if a == nil {
		return 0
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.chase == nil {
		return 0
	}
	return a.chase.Volume()
}

func (a *Audio) ToggleMute() {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.ensure()
	a.musicMute = !a.musicMute
	a.applyChaseVol()
}

func (a *Audio) MusicMuted() bool {
	if a == nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.musicMute
}

func (a *Audio) applyChaseVol() {
	if a.chase == nil {
		return
	}
	switch {
	case a.musicMute:
		a.chase.SetVolume(0)
	case a.tallyDuck:
		a.chase.SetVolume(0.12)
	case a.wreckDuck:
		a.chase.SetVolume(0.10)
	default:
		a.chase.SetVolume(0.35)
	}
}

func (a *Audio) setChip(on bool) {
	if a.chip == nil {
		return
	}
	if on {
		if !a.chip.IsPlaying() {
			_ = a.chip.Rewind()
			a.chip.Play()
		}
		return
	}
	a.chip.Pause()
}

func (a *Audio) Crunch() { a.play(func(x *Audio) []byte { return x.crunchB }) }

func (a *Audio) Wreck() { a.play(func(x *Audio) []byte { return x.wreckB }) }

func (a *Audio) Peel() { a.play(func(x *Audio) []byte { return x.peelB }) }

func (a *Audio) Burst() { a.play(func(x *Audio) []byte { return x.burstB }) }

func (a *Audio) play(pcm func(*Audio) []byte) {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.ensure()
	b := pcm(a)
	if a.ctx == nil || len(b) == 0 {
		return
	}
	slot := -1
	for i, p := range a.shots {
		if p == nil || !p.IsPlaying() {
			slot = i
			break
		}
	}
	if slot < 0 {
		slot = 0
		if a.shots[0] != nil {
			a.shots[0].Pause()
		}
	}
	p := a.ctx.NewPlayerFromBytes(b)
	p.SetVolume(0.55)
	a.shots[slot] = p
	p.Play()
}

func loadSample(name string) []byte {
	raw, err := assets.FS.ReadFile("usable/sfx/" + name)
	if err != nil {
		return nil
	}
	st, err := wav.DecodeWithSampleRate(44100, bytes.NewReader(raw))
	if err != nil {
		return nil
	}
	out, err := io.ReadAll(st)
	if err != nil {
		return nil
	}
	return out
}

func (a *Audio) Stop() {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.chase != nil {
		a.chase.Pause()
	}
	if a.chip != nil {
		a.chip.Pause()
	}
	a.wreckDuck = false
	for i, p := range a.shots {
		if p != nil {
			p.Pause()
			a.shots[i] = nil
		}
	}
}

func genChase(rate int) []byte {
	// 8-bar square/triangle, ~140 BPM, 16-bit stereo LE.
	const bpm = 140.0
	beats := 32.0 // 8 bars of 4/4
	sec := beats * 60.0 / bpm
	n := int(float64(rate) * sec)
	notes := []float64{110, 110, 146.8, 110, 130.8, 110, 98, 146.8}
	buf := make([]byte, n*4)
	for i := 0; i < n; i++ {
		t := float64(i) / float64(rate)
		beat := t * bpm / 60.0
		ni := int(beat) % len(notes)
		freq := notes[ni]
		phase := t * freq
		sq := 0.12
		if math.Mod(phase, 1) < 0.5 {
			sq = -0.12
		}
		tri := 0.08 * (2*math.Abs(2*(phase-math.Floor(phase+0.5))) - 1)
		// kick-ish click on beats
		frac := beat - math.Floor(beat)
		kick := 0.0
		if frac < 0.08 {
			kick = -0.18 * (1 - frac/0.08)
		}
		v := sq + tri + kick
		s := int16(clamp32(v) * 32767)
		buf[i*4] = byte(s)
		buf[i*4+1] = byte(s >> 8)
		buf[i*4+2] = byte(s)
		buf[i*4+3] = byte(s >> 8)
	}
	return buf
}

func genCrunch(rate int) []byte {
	n := rate * 80 / 1000
	buf := make([]byte, n*4)
	seed := uint32(0xA341316C)
	for i := 0; i < n; i++ {
		seed = seed*1664525 + 1013904223
		noise := float64(int32(seed)>>16) / 32768.0
		env := 1 - float64(i)/float64(n)
		v := noise * 0.55 * env * env
		s := int16(clamp32(v) * 32767)
		buf[i*4] = byte(s)
		buf[i*4+1] = byte(s >> 8)
		buf[i*4+2] = byte(s)
		buf[i*4+3] = byte(s >> 8)
	}
	return buf
}

func clamp32(v float64) float64 {
	if v < -1 {
		return -1
	}
	if v > 1 {
		return 1
	}
	return v
}
