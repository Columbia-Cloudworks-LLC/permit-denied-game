import type { Town } from "./town";
import { pointOnRoad } from "./roads";
import { terrainTraversalAt } from "./terrainFeatures";

/** Two treads per stamp, so this holds the last 48 stamps. */
const TRACK_CAP = 96;
const TRACK_GAP = 0.72;
/** Each impression overruns the gap so consecutive stamps join into one compacted tread. */
const TRACK_LENGTH = TRACK_GAP + 0.14;
const TREAD_OFFSET = 0.62;
const TREAD_WIDTH = 0.36;

/** Presentation marks. They never change movement, payout, or layout. Ice and pavement stay unmarked. */
export function leaveSeasonalTrack(town: Town, x: number, y: number, heading: number): void {
  if (town.weatherDetail === "off") return;
  if (pointOnRoad(town.network, x, y)) return;
  if (terrainTraversalAt(town.features, x, y, town.surface) === "water") return;
  const tracks = town.marks.filter((mark) => mark.kind === "season-track");
  const [left, right] = tracks.slice(-2);
  if (left && right && Math.hypot((left.x + right.x) / 2 - x, (left.y + right.y) / 2 - y) < TRACK_GAP) return;
  fadeTreadMarks(town, "season-track");
  const kept = town.marks.filter((mark) => mark.kind === "season-track").length;
  for (let excess = kept + 2 - TRACK_CAP; excess > 0; excess--) {
    const index = town.marks.findIndex((mark) => mark.kind === "season-track");
    if (index >= 0) town.marks.splice(index, 1);
  }
  town.visualRevision++;
  const rx = -Math.sin(heading), ry = Math.cos(heading);
  for (const side of [-1, 1]) {
    town.marks.push({
      x: x + rx * TREAD_OFFSET * side,
      y: y + ry * TREAD_OFFSET * side,
      w: TRACK_LENGTH,
      d: TREAD_WIDTH,
      heading,
      kind: "season-track",
      material: "concrete",
      seed: (tracks.length * 17 + side) ^ (town.seed & 255),
      alpha: 0.55,
    });
  }
}

const TREAD_FADE = 0.992;
const TREAD_GONE = 0.06;

/** Each new tread impression weathers the older ones of its kind; worn-out marks drop. */
export function fadeTreadMarks(town: Town, kind: "tire" | "season-track"): void {
  let write = 0;
  for (const mark of town.marks) {
    if (mark.kind === kind) {
      mark.alpha *= TREAD_FADE;
      if (mark.alpha < TREAD_GONE) continue;
    }
    town.marks[write++] = mark;
  }
  town.marks.length = write;
}
