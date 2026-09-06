package main

import (
	"encoding/json"
	"fmt"
	"os"
	"permitdenied/internal/game"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "doctor":
		err = doctor()
	case "drive":
		err = drive(os.Args[2:])
	case "cleanup":
		err = cleanup(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "control-permitdenied: %v\n", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `usage:
  control-permitdenied doctor
  control-permitdenied drive --out DIR SCRIPT
  control-permitdenied cleanup --out DIR
`)
}

func doctor() error {
	g := game.New()
	g.Silence()
	s := g.Snapshot()
	ok := s.Scene == "play" && s.Title == game.WindowTitle
	out := map[string]any{
		"ok":         ok,
		"module":     "permitdenied",
		"title":      s.Title,
		"scene":      s.Scene,
		"screen":     fmt.Sprintf("%dx%d", game.ScreenW, game.ScreenH),
		"spawn":      []float64{game.SpawnX, game.SpawnY},
		"tps":        game.TPS,
		"instance":   "in-process",
		"player_exe": "not used",
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("doctor: scene=%s title=%q", s.Scene, s.Title)
	}
	return nil
}

func cleanup(args []string) error {
	out := flagOut(args)
	if out == "" {
		return fmt.Errorf("cleanup requires --out DIR")
	}
	if _, err := os.Stat(out); err != nil {
		return fmt.Errorf("cleanup: %w", err)
	}
	fmt.Printf("{\"ok\":true,\"out\":%q,\"removed\":\"none\",\"kept\":\"all artifacts under --out\"}\n", out)
	return nil
}
