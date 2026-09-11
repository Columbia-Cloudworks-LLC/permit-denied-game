import type { Building } from "../structure/types";

/** Counts original structural members, never the empty interior grid or loose rubble. */
export class DemolitionJob {
  readonly members;
  paid = false;
  choiceEarned = false;
  readonly payout = 1200;

  constructor(readonly target: Building) {
    this.members = target.cells.filter(c => c.state !== "gone");
  }

  status() {
    const standing = this.members.filter(c => c.state !== "gone" && c.state !== "falling");
    const unsettled = this.members.some(c => c.state === "falling") ||
      this.target.roofs.some(r => r.state === "falling" || r.state === "sagging") ||
      this.target.floorTiles?.some(t => t.state === "falling");
    const removed = this.members.filter(c => c.state === "gone").length;
    const progress = Math.min(1, removed / Math.max(1, Math.ceil(this.members.length * .9)));
    const sides = { north: 0, south: 0, east: 0, west: 0 };
    for (const c of standing) {
      if (c.gy === 0) sides.north++;
      else if (c.gy === this.target.d - 1) sides.south++;
      else if (c.gx === 0) sides.west++;
      else sides.east++;
    }
    const side = Object.entries(sides).sort((a, b) => b[1] - a[1])[0]![0];
    return { progress, remaining: standing.length, ready: progress >= 1 && !unsettled,
      instruction: unsettled ? "Stand clear — sections settling" :
        removed === 0 ? "Breach the brick frontage. Hold W + SPACE." :
        `Attack the ${side} side · ${standing.length} structural sections remain` };
  }

  /** Contract reward is separate from (and never reissues) the existing building bonus. */
  settle(): number {
    if (this.paid || !this.status().ready) return 0;
    this.paid = true;
    this.choiceEarned = true;
    return this.payout;
  }

  takeChoice(): boolean {
    if (!this.choiceEarned) return false;
    this.choiceEarned = false;
    return true;
  }
}
