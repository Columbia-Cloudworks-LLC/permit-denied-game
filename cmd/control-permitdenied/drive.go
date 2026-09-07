package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/hajimehoshi/ebiten/v2"
	"permitdenied/internal/game"
)

func drive(args []string) error {
	out, scriptPath, err := parseDriveArgs(args)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	g := game.New()
	g.Silence()
	s := g.Snapshot()
	if s.Scene != "play" || s.Title != game.WindowTitle {
		return fmt.Errorf("doctor failed: scene=%s title=%q", s.Scene, s.Title)
	}
	lines, err := readLines(scriptPath)
	if err != nil {
		return err
	}
	h := &host{g: g, out: out, lines: lines}
	ebiten.SetWindowSize(game.ScreenW*4, game.ScreenH*4)
	ebiten.SetWindowTitle("PERMIT DENIED verify")
	ebiten.SetTPS(240)
	if err := ebiten.RunGameWithOptions(h, &ebiten.RunGameOptions{InitUnfocused: true}); err != nil {
		return err
	}
	if h.err != nil {
		return h.err
	}
	if !h.done {
		return fmt.Errorf("drive ended before the script finished")
	}
	fmt.Printf("{\"ok\":true,\"out\":%q,\"script\":%q,\"scene\":%q}\n", out, scriptPath, g.Snapshot().Scene)
	return nil
}

func readLines(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	return lines, sc.Err()
}

func parseDriveArgs(args []string) (out, script string, err error) {
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--out":
			i++
			if i >= len(args) {
				return "", "", fmt.Errorf("drive --out needs a directory")
			}
			out = args[i]
		case "-h", "--help":
			return "", "", fmt.Errorf("drive --out DIR SCRIPT")
		default:
			if strings.HasPrefix(args[i], "-") {
				return "", "", fmt.Errorf("unknown flag %s", args[i])
			}
			if script != "" {
				return "", "", fmt.Errorf("extra argument %s", args[i])
			}
			script = args[i]
		}
	}
	if out == "" || script == "" {
		return "", "", fmt.Errorf("drive --out DIR SCRIPT")
	}
	return out, script, nil
}

func flagOut(args []string) string {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--out" {
			return args[i+1]
		}
	}
	return ""
}

func keysFor(names []string, edge bool) (game.Input, game.Keys, error) {
	var in game.Input
	var keys game.Keys
	for _, n := range names {
		switch n {
		case "w":
			in.Throttle = 1
		case "s":
			in.Throttle = -1
		case "a":
			in.Steer = -1
		case "d":
			in.Steer = 1
		case "space":
			if edge {
				in.BladeToggle = true
			}
		case "enter":
			if edge {
				keys.Enter = true
			}
		case "esc", "escape":
			if edge {
				keys.Escape = true
			}
		case "f1":
			if edge {
				keys.F1 = true
			}
		case "f2":
			if edge {
				keys.F2 = true
			}
		case "f3":
			if edge {
				keys.F3 = true
			}
		case "r":
			if edge {
				keys.R = true
			}
		default:
			return in, keys, fmt.Errorf("unknown key %s", n)
		}
	}
	return in, keys, nil
}

func writeDump(g *game.Game, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(g.Snapshot())
}

func assertSnap(s game.Snapshot, spec string) error {
	op, key, want, err := parseAssert(spec)
	if err != nil {
		return err
	}
	got, numeric, err := snapField(s, key)
	if err != nil {
		return err
	}
	if !numeric {
		switch op {
		case "=":
			if got != want {
				return fmt.Errorf("assert %s: got %s want %s", key, got, want)
			}
		case "!=":
			if got == want {
				return fmt.Errorf("assert %s: got %s, wanted different", key, got)
			}
		default:
			return fmt.Errorf("assert %s: string fields only support = !=", key)
		}
		return nil
	}
	gv, err := strconv.ParseFloat(got, 64)
	if err != nil {
		return err
	}
	wv, err := strconv.ParseFloat(want, 64)
	if err != nil {
		return fmt.Errorf("assert %s: want number, got %q", key, want)
	}
	ok := false
	switch op {
	case "=":
		ok = gv == wv
	case "!=":
		ok = gv != wv
	case "<":
		ok = gv < wv
	case ">":
		ok = gv > wv
	case "<=":
		ok = gv <= wv
	case ">=":
		ok = gv >= wv
	}
	if !ok {
		return fmt.Errorf("assert %s %s %s: got %s", key, op, want, got)
	}
	return nil
}

func parseAssert(spec string) (op, key, want string, err error) {
	ops := []string{">=", "<=", "!=", "=", ">", "<"}
	for _, o := range ops {
		k, v, ok := strings.Cut(spec, o)
		if !ok {
			continue
		}
		return o, strings.TrimSpace(k), strings.TrimSpace(v), nil
	}
	return "", "", "", fmt.Errorf("assert needs an operator: %s", spec)
}

func snapField(s game.Snapshot, key string) (val string, numeric bool, err error) {
	switch key {
	case "title":
		return s.Title, false, nil
	case "scene":
		return s.Scene, false, nil
	case "stance":
		return s.Stance, false, nil
	case "blade":
		if s.BladeDown {
			return "down", false, nil
		}
		return "up", false, nil
	case "clock":
		return s.Clock, false, nil
	case "death":
		return s.Death, false, nil
	case "banner":
		return s.Banner, false, nil
	case "x":
		return fmt.Sprintf("%v", s.X), true, nil
	case "y":
		return fmt.Sprintf("%v", s.Y), true, nil
	case "heading":
		return fmt.Sprintf("%v", s.Heading), true, nil
	case "speed":
		return fmt.Sprintf("%v", s.Speed), true, nil
	case "plates":
		return fmt.Sprintf("%d", s.Plates), true, nil
	case "heat":
		return fmt.Sprintf("%v", s.Heat), true, nil
	case "tick":
		return fmt.Sprintf("%d", s.Tick), true, nil
	case "time":
		return fmt.Sprintf("%v", s.Time), true, nil
	case "struct_cash":
		return fmt.Sprintf("%d", s.StructCash), true, nil
	case "vehicle_cash":
		return fmt.Sprintf("%d", s.VehicleCash), true, nil
	case "rubble":
		return fmt.Sprintf("%d", s.Rubble), true, nil
	case "intact":
		return fmt.Sprintf("%d", s.Intact), true, nil
	case "falling":
		return fmt.Sprintf("%d", s.Falling), true, nil
	case "sagging":
		return fmt.Sprintf("%d", s.Sagging), true, nil
	case "deck_intact":
		return fmt.Sprintf("%d", s.DeckIntact), true, nil
	case "hunting":
		if s.Hunting {
			return "true", false, nil
		}
		return "false", false, nil
	default:
		return "", false, fmt.Errorf("unknown assert field %s", key)
	}
}
