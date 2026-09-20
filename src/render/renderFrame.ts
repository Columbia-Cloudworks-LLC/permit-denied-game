import type { DebugView } from "../debug/view";
import type { ParticlePool } from "../fx/particles";
import type { Bird } from "../structure/types";
import type { Dozer } from "../vehicle/dozer";
import type { GroundCondition } from "../world/groundCondition";
import type { SurfaceGrid } from "../world/terrain";
import type { Town } from "../world/town";

/** Mutable counters shared across named WorldRenderer draw passes. */
export interface RenderFrame {
  town: Town;
  dozer: Dozer;
  particles: ParticlePool;
  birds: Bird[];
  dt: number;
  showPlayer: boolean;
  view: DebugView;
  total: number;
  visible: number;
  occluded: boolean;
  groundRebuilds: number;
  surfaceGeometry: number;
  hideDressing: boolean;
  viewSig: string;
  condition: GroundCondition;
  surface: SurfaceGrid;
  terrainCounts: { chunks: number; cells: number };
}

export type RenderPassName =
  | "yard"
  | "terrain"
  | "ground"
  | "sites"
  | "marks"
  | "nhood"
  | "buildings"
  | "props"
  | "garnish"
  | "dynamics"
  | "effects"
  | "submit";

/** Draw order for WorldRenderer.draw(). Terrain and sites stay on dedicated layers; later passes enqueue depth-sorted commands. */
export const DRAW_PASSES: readonly RenderPassName[] = [
  "yard",
  "terrain",
  "ground",
  "sites",
  "marks",
  "nhood",
  "buildings",
  "props",
  "garnish",
  "dynamics",
  "effects",
  "submit",
];

