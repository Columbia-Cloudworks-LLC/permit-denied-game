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

export function buildingIsLive(lod: BuildingLod, damaged: boolean): boolean {
  return lod === "near" || damaged;
}

export interface ChunkCommand {
  chunk?: string;
  key?: string;
  version?: string | number;
  depth: number;
  run: (g: Graphics) => void;
}

/** Merge consecutive same-chunk commands after painter sort. Order inside a run stays intact. */
export function coalesceStaticChunks<T extends ChunkCommand>(cmds: readonly T[]): T[] {
  const out: T[] = [];
  let i = 0;
  while (i < cmds.length) {
    const head = cmds[i]!;
    if (!head.chunk) {
      out.push(head);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < cmds.length && cmds[j]!.chunk === head.chunk) j++;
    if (j === i + 1) {
      out.push(head);
      i = j;
      continue;
    }
    const run = cmds.slice(i, j);
    out.push({
      ...head,
      key: `chunk:${head.chunk}:${run[0]!.depth}:${run[run.length - 1]!.depth}:${run.length}`,
      version: head.version,
      depth: head.depth,
      run: (g) => {
        for (const cmd of run) cmd.run(g);
      },
    });
    i = j;
  }
  return out;
}
