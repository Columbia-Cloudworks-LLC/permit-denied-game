import type { Town } from "./town";
import { pointOnRoad } from "./roads";
import { terrainTraversalAt } from "./terrainFeatures";

const TRACK_CAP = 48;
const TRACK_GAP = 0.72;

/** Presentation marks. They never change movement, payout, or layout. Ice and pavement stay unmarked. */
export function leaveSeasonalTrack(town: Town, x: number, y: number, heading: number): void {
  if (town.weatherDetail === "off") return;
  if (pointOnRoad(town.network, x, y)) return;
  if (terrainTraversalAt(town.features, x, y, town.surface) === "water") return;
  const tracks = town.marks.filter((mark) => mark.kind === "season-track");
  const last = tracks[tracks.length - 1];
  if (last && Math.hypot(last.x - x, last.y - y) < TRACK_GAP) return;
  if (tracks.length >= TRACK_CAP) {
    const index = town.marks.findIndex((mark) => mark.kind === "season-track");
    if (index >= 0) town.marks.splice(index, 1);
  }
  town.marks.push({
    x,
    y,
    w: 0.55,
    d: 0.16,
    heading,
    kind: "season-track",
    material: "concrete",
    seed: (tracks.length * 17) ^ (town.seed & 255),
    alpha: 0.55,
  });
}
