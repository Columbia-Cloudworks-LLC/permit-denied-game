import type { Graphics } from "pixi.js";
import type { Building } from "../structure/types";
import type { DebugView } from "../debug/view";

export type BuildingLod = "near" | "street" | "overview";

export function debugViewSignature(view: DebugView): string {
  return [
    view.walls ? 1 : 0,
    view.roofs ? 1 : 0,
    view.floors ? 1 : 0,
    view.contents ? 1 : 0,
    view.details ? 1 : 0,
    view.reveal ? 1 : 0,
    view.overview ? 1 : 0,
    view.maxFloor,
  ].join("");
}

export function buildingLod(near: boolean, overview: boolean, zoom: number): BuildingLod {
  if (near) return "near";
  if (overview || zoom < 0.55) return "overview";
  return "street";
}

export function buildingDamaged(building: Building): boolean {
  if (building.coreCollapse && building.coreCollapse.phase !== "standing") return true;
  if (building.cells.some((cell) => cell.state === "falling" || cell.state === "breached" || cell.state === "gone" || cell.cladding?.hp === 0)) {
    return true;
  }
  return building.roofs.some((roof) => roof.state !== "intact");
}

export function buildingNeedsInterior(building: Building, view: DebugView, lod: BuildingLod): boolean {
  if (building.openDecks || building.canopy) return true;
  if (building.construction.skin === "glass") return true;
  if (view.reveal || !view.roofs || !view.walls || view.maxFloor < building.floors - 1) return true;
  if (lod === "near" || buildingDamaged(building)) return true;
  return false;
}

export function buildingNeedsDetails(view: DebugView, lod: BuildingLod): boolean {
  return !!view.details && lod !== "overview";
}

/**
 * Motion the structure step advances without a visualRevision bump: falling cells,
 * sagging or falling roofs, and dropping deck slabs. A wreck holding still between
 * revisions (a core tower in its warning phase, a settled breach) can stay cached.
 */
export function buildingAnimating(building: Building): boolean {
  if (building.cells.some((cell) => cell.state === "falling")) return true;
  if (building.roofs.some((roof) => roof.state !== "gone" && (roof.state !== "intact" || roof.sag > 0))) return true;
  return building.floorTiles.some((tile) => tile.state === "falling");
}

export function buildingIsLive(lod: BuildingLod, animating: boolean): boolean {
  return lod === "near" || animating;
}

export interface ChunkCommand {
  chunk?: string;
  key?: string;
  version?: string | number;
  /** Moves through painter order frame to frame (debris, traffic, particles, dropping floors). */
  mobile?: boolean;
  depth: number;
  run: (g: Graphics) => void;
}

/** Longest merged run of one versioned chunk, so a split never repaints more than this. */
export const CHUNK_SEGMENT = 24;

/** Frames a run stays split after a mover last crossed it, so steady traffic does not flip it. */
export const SPLIT_HOLD_FRAMES = 120;

/** Runs a mover has crossed recently, by run key, with the frame of the last crossing. */
export class ChunkSplitMemory {
  frame = 0;
  readonly lastSplit = new Map<string, number>();
  next(): void {
    this.frame++;
    if (this.frame % SPLIT_HOLD_FRAMES !== 0) return;
    for (const [key, at] of this.lastSplit) if (this.frame - at >= SPLIT_HOLD_FRAMES) this.lastSplit.delete(key);
  }
}

/**
 * Merge same-chunk commands after painter sort. Order inside a run stays intact.
 * Versioned runs are found among the stationary commands only, so their boundaries do not move
 * when traffic or particles do. A run with nothing mobile drawn inside it becomes one command
 * keyed on its end members; a run something mobile is drawn inside falls back to its members'
 * own keys, so the mover costs one repaint entering and one leaving rather than one per frame.
 * With `memory`, a crossed run stays split for SPLIT_HOLD_FRAMES so traffic does not flip it.
 * Unversioned runs repaint every frame anyway, so they key on their ordinal within the chunk
 * and reuse the same Graphics frame to frame.
 */
export function coalesceStaticChunks<T extends ChunkCommand>(cmds: readonly T[], memory?: ChunkSplitMemory): T[] {
  const members = new Map<string, number>();
  const runOf: number[] = [];
  const runs: { first: number; last: number; count: number }[] = [];
  let open = -1, openChunk: string | undefined;
  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i]!;
    if (cmd.mobile) continue;
    if (!cmd.chunk || cmd.version === undefined) { open = -1; continue; }
    const n = members.get(cmd.chunk) ?? 0;
    members.set(cmd.chunk, n + 1);
    if (open >= 0 && openChunk === cmd.chunk && n % CHUNK_SEGMENT !== 0) {
      runs[open]!.last = i;
      runs[open]!.count++;
    } else {
      open = runs.push({ first: i, last: i, count: 1 }) - 1;
      openChunk = cmd.chunk;
    }
    runOf[i] = open;
  }
  const out: T[] = [];
  const ordinals = new Map<string, number>();
  const merge = (run: readonly T[]) => run.length === 1 ? run[0]!.run : (g: Graphics) => {
    for (const cmd of run) cmd.run(g);
  };
  let i = 0;
  while (i < cmds.length) {
    const head = cmds[i]!;
    const r = runOf[i];
    if (r !== undefined) {
      const span = runs[r]!;
      if (span.count > 1 && span.first === i) {
        const last = cmds[span.last]!;
        const key = `chunk:${head.chunk}:${head.key ?? head.depth}:${last.key ?? last.depth}:${span.count}`;
        const crossed = span.last - span.first + 1 !== span.count;
        if (crossed) memory?.lastSplit.set(key, memory.frame);
        const held = memory ? memory.frame - (memory.lastSplit.get(key) ?? -Infinity) < SPLIT_HOLD_FRAMES : crossed;
        if (!held) {
          out.push({ ...head, key, run: merge(cmds.slice(i, span.last + 1)) });
          i = span.last + 1;
          continue;
        }
      }
      out.push(head);
      i++;
      continue;
    }
    if (!head.chunk || head.version !== undefined) {
      out.push(head);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < cmds.length && cmds[j]!.chunk === head.chunk && cmds[j]!.version === undefined) j++;
    const n = ordinals.get(head.chunk) ?? 0;
    ordinals.set(head.chunk, n + 1);
    out.push({ ...head, key: `${head.chunk}:${n}`, run: merge(cmds.slice(i, j)) });
    i = j;
  }
  return out;
}
