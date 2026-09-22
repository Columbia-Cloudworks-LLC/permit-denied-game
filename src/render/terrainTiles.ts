import { Assets, Container, Graphics, Mesh, MeshGeometry, Texture } from "pixi.js";
import { drawWorldPoly } from "./drawIso";
import { worldToScreen } from "../world/iso";
import {
  SURFACE_CHUNK,
  SURFACE_FROM_ID,
  SURFACE_ID,
  type SurfaceGrid,
  type TerrainSurface,
} from "../world/terrain";
import type { GroundCondition } from "../world/groundCondition";

function validBlobMask(mask: number): boolean {
  const n = (mask & 1) !== 0;
  const ne = (mask & 2) !== 0;
  const e = (mask & 4) !== 0;
  const se = (mask & 8) !== 0;
  const s = (mask & 16) !== 0;
  const sw = (mask & 32) !== 0;
  const w = (mask & 64) !== 0;
  const nw = (mask & 128) !== 0;
  if (ne && !(n && e)) return false;
  if (se && !(s && e)) return false;
  if (sw && !(s && w)) return false;
  if (nw && !(n && w)) return false;
  return true;
}

const BLOB47_MASKS: number[] = (() => {
  const masks: number[] = [];
  for (let mask = 0; mask < 256; mask++) {
    if (validBlobMask(mask)) masks.push(mask);
  }
  return masks;
})();

const BLOB47_INDEX = (() => {
  const table = new Int16Array(256);
  table.fill(-1);
  BLOB47_MASKS.forEach((mask, i) => {
    table[mask] = i;
  });
  return table;
})();

/** Cardinal-only 3×3 (N/E/S/W match, corners off) compact 47-index. */
export const BLOB_CARDINAL_INDEX = blobIndexFromBits(true, false, true, false, true, false, true, false);
/** Fully surrounded 3×3 compact 47-index. */
export const BLOB_FULL_INDEX = blobIndexFromBits(true, true, true, true, true, true, true, true);

export function blob47Masks(): readonly number[] {
  return BLOB47_MASKS;
}

export function blobIndex47(
  n: boolean,
  ne: boolean,
  e: boolean,
  se: boolean,
  s: boolean,
  sw: boolean,
  w: boolean,
  nw: boolean,
): number {
  return blobIndexFromBits(n, ne, e, se, s, sw, w, nw);
}

export function blobIndexFromBits(
  n: boolean,
  ne: boolean,
  e: boolean,
  se: boolean,
  s: boolean,
  sw: boolean,
  w: boolean,
  nw: boolean,
): number {
  const NE = ne && n && e;
  const SE = se && s && e;
  const SW = sw && s && w;
  const NW = nw && n && w;
  const mask =
    (n ? 1 : 0) |
    (NE ? 2 : 0) |
    (e ? 4 : 0) |
    (SE ? 8 : 0) |
    (s ? 16 : 0) |
    (SW ? 32 : 0) |
    (w ? 64 : 0) |
    (NW ? 128 : 0);
  const index = BLOB47_INDEX[mask]!;
  return index < 0 ? 0 : index;
}

const SOLID_SURFACES: readonly TerrainSurface[] = [
  "grass",
  "scrub",
  "dirt",
  "prairie",
  "duff",
  "leaf-litter",
  "gravel",
  "forest-floor",
  "field",
  "wet-edge",
  "water",
];

const DIRT_FROM: readonly TerrainSurface[] = ["grass", "prairie", "leaf-litter", "duff", "scrub"];
const FIELD_TO: readonly TerrainSurface[] = ["grass", "prairie", "dirt"];

const ATLAS_URL = "/terrain/ground.json";

interface AtlasFrame {
  name: string;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface TerrainAtlas {
  texture: Texture;
  frames: Map<string, AtlasFrame>;
  revision: number;
}

let atlasPromise: Promise<TerrainAtlas | null> | null = null;
let loadedAtlas: TerrainAtlas | null = null;
let atlasRevision = 0;

export function terrainAtlasRevision(): number {
  return atlasRevision;
}

export function ensureTerrainAtlas(): Promise<TerrainAtlas | null> {
  if (loadedAtlas) return Promise.resolve(loadedAtlas);
  if (atlasPromise) return atlasPromise;
  atlasPromise = loadAtlas().then((atlas) => {
    loadedAtlas = atlas;
    if (atlas) atlasRevision++;
    return atlas;
  });
  return atlasPromise;
}

async function loadAtlas(): Promise<TerrainAtlas | null> {
  try {
    const sheet = await Assets.load(ATLAS_URL);
    const source = (sheet?.texture as Texture | undefined) ?? Texture.WHITE;
    const frames = new Map<string, AtlasFrame>();
    const textures = (sheet?.textures ?? {}) as Record<string, Texture>;
    const width = source.width || source.source?.width || 1;
    const height = source.height || source.source?.height || 1;
    for (const [name, tex] of Object.entries(textures)) {
      const frame = tex.frame;
      frames.set(name, {
        name,
        u0: frame.x / width,
        v0: frame.y / height,
        u1: (frame.x + frame.width) / width,
        v1: (frame.y + frame.height) / height,
      });
    }
    if (!frames.size) return fallbackAtlas();
    return { texture: source, frames, revision: atlasRevision + 1 };
  } catch {
    return fallbackAtlas();
  }
}

function fallbackAtlas(): TerrainAtlas {
  const texture = Texture.WHITE;
  const frames = new Map<string, AtlasFrame>();
  const dummy: AtlasFrame = { name: "white", u0: 0, v0: 0, u1: 1, v1: 1 };
  for (const surface of SOLID_SURFACES) {
    for (let v = 0; v < 3; v++) {
      frames.set(`${surface}-${v}`, dummy);
      frames.set(`snow-${surface}-${v}`, dummy);
    }
  }
  frames.set("wet-edge__any-0", dummy);
  frames.set("water__wet-edge-0", dummy);
  return { texture, frames, revision: 0 };
}

export function chunkCount(grid: SurfaceGrid): { chunks: number; cells: number } {
  const chunksX = Math.ceil(grid.cols / SURFACE_CHUNK);
  const chunksY = Math.ceil(grid.rows / SURFACE_CHUNK);
  return { chunks: chunksX * chunksY, cells: grid.cols * grid.rows };
}

export function buildTerrainChunks(
  parent: Container,
  grid: SurfaceGrid,
  atlas?: TerrainAtlas | null,
  condition: GroundCondition = "clear",
): number {
  parent.removeChildren().forEach((child) => {
    child.destroy({ children: true });
  });
  paintTerrainSkirt(parent, grid);
  const sheet = atlas ?? loadedAtlas ?? fallbackAtlas();
  const chunksX = Math.ceil(grid.cols / SURFACE_CHUNK);
  const chunksY = Math.ceil(grid.rows / SURFACE_CHUNK);
  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const mesh = buildChunkMesh(grid, cx, cy, sheet, condition);
      if (mesh) parent.addChild(mesh);
    }
  }
  return chunksX * chunksY;
}

function paintTerrainSkirt(parent: Container, grid: SurfaceGrid): void {
  const g = new Graphics();
  const pad = 8;
  const x0 = grid.ox - pad;
  const y0 = grid.oy - pad;
  const x1 = grid.ox + grid.cols + pad;
  const y1 = grid.oy + grid.rows + pad;
  drawWorldPoly(g, [
    { x: x0, y: y0, z: -0.04 },
    { x: x1, y: y0, z: -0.04 },
    { x: x1, y: y1, z: -0.04 },
    { x: x0, y: y1, z: -0.04 },
  ], 0x243218, 1);
  drawWorldPoly(g, [
    { x: grid.ox, y: grid.oy, z: -0.02 },
    { x: grid.ox + grid.cols, y: grid.oy, z: -0.02 },
    { x: grid.ox + grid.cols, y: grid.oy + grid.rows, z: -0.02 },
    { x: grid.ox, y: grid.oy + grid.rows, z: -0.02 },
  ], 0x5a7340, 1);
  parent.addChild(g);
}

function buildChunkMesh(
  grid: SurfaceGrid,
  cx: number,
  cy: number,
  atlas: TerrainAtlas,
  condition: GroundCondition,
): Mesh | null {
  const x0 = cx * SURFACE_CHUNK;
  const y0 = cy * SURFACE_CHUNK;
  const x1 = Math.min(grid.cols, x0 + SURFACE_CHUNK);
  const y1 = Math.min(grid.rows, y0 + SURFACE_CHUNK);
  const quads: { x: number; y: number; frame: AtlasFrame }[] = [];
  for (let iy = y0; iy < y1; iy++) {
    for (let ix = x0; ix < x1; ix++) {
      const cell = describeCell(grid, ix, iy, condition);
      if (!cell) continue;
      const wx = grid.ox + ix;
      const wy = grid.oy + iy;
      const base = atlas.frames.get(cell.base) ?? atlas.frames.get("grass-0");
      if (base) quads.push({ x: wx, y: wy, frame: base });
      if (cell.overlay) {
        const over = atlas.frames.get(cell.overlay) ?? atlas.frames.get(`${cell.overlay.replace(/-\d+$/, "-0")}`);
        if (over) quads.push({ x: wx, y: wy, frame: over });
      }
    }
  }
  if (!quads.length) return null;
  const positions = new Float32Array(quads.length * 8);
  const uvs = new Float32Array(quads.length * 8);
  const indices = new Uint32Array(quads.length * 6);
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i]!;
    const a = worldToScreen(q.x, q.y);
    const b = worldToScreen(q.x + 1, q.y);
    const c = worldToScreen(q.x + 1, q.y + 1);
    const d = worldToScreen(q.x, q.y + 1);
    const o = i * 8;
    positions[o] = a.x;
    positions[o + 1] = a.y;
    positions[o + 2] = b.x;
    positions[o + 3] = b.y;
    positions[o + 4] = c.x;
    positions[o + 5] = c.y;
    positions[o + 6] = d.x;
    positions[o + 7] = d.y;
    const f = q.frame;
    uvs[o] = f.u0;
    uvs[o + 1] = f.v0;
    uvs[o + 2] = f.u1;
    uvs[o + 3] = f.v0;
    uvs[o + 4] = f.u1;
    uvs[o + 5] = f.v1;
    uvs[o + 6] = f.u0;
    uvs[o + 7] = f.v1;
    const io = i * 6;
    const vo = i * 4;
    indices[io] = vo;
    indices[io + 1] = vo + 1;
    indices[io + 2] = vo + 2;
    indices[io + 3] = vo;
    indices[io + 4] = vo + 2;
    indices[io + 5] = vo + 3;
  }
  const geometry = new MeshGeometry({ positions, uvs, indices });
  return new Mesh({ geometry, texture: atlas.texture });
}

export function describeCell(
  grid: SurfaceGrid,
  ix: number,
  iy: number,
  condition: GroundCondition = "clear",
): { base: string; overlay?: string } | null {
  const i = iy * grid.cols + ix;
  const id = grid.surface[i]!;
  const variant = grid.variant[i] ?? 0;
  const surface = SURFACE_FROM_ID[id] ?? "grass";
  if (surface === "developed") {
    return { base: terrainSolidFrame("gravel", variant, condition) };
  }
  if (surface === "forest-core" || surface === "forest-floor") {
    return { base: terrainSolidFrame("duff", variant, condition) };
  }
  const baseKind = baseSurface(surface);
  const base = terrainSolidFrame(baseKind, variant, condition);
  if (condition === "snow" && surface !== "water") {
    return { base };
  }
  const overlay = pickOverlay(grid, ix, iy, surface);
  return overlay ? { base, overlay } : { base };
}

export function terrainSolidFrame(
  surface: Exclude<TerrainSurface, "developed" | "forest-core">,
  variant: number,
  condition: GroundCondition = "clear",
): string {
  const name = `${surface}-${variant}`;
  return condition === "snow" && surface !== "water" ? `snow-${name}` : name;
}

function baseSurface(surface: TerrainSurface): Exclude<TerrainSurface, "developed" | "forest-core"> {
  switch (surface) {
    case "grass":
    case "scrub":
    case "dirt":
    case "prairie":
    case "duff":
    case "leaf-litter":
    case "gravel":
    case "water":
      return surface;
    case "forest-floor":
    case "forest-core":
      return "duff";
    case "field":
      return "prairie";
    case "wet-edge":
      return "grass";
    case "developed":
      return "gravel";
    default: {
      const _never: never = surface;
      return _never;
    }
  }
}

function pickOverlay(grid: SurfaceGrid, ix: number, iy: number, surface: TerrainSurface): string | undefined {
  if (surface === "water") {
    const idx = neighborBlob(grid, ix, iy, (id) => id === SURFACE_ID.water);
    return `water__wet-edge-${idx}`;
  }
  if (surface === "wet-edge") {
    const idx = neighborBlob(grid, ix, iy, (id) => id === SURFACE_ID["wet-edge"] || id === SURFACE_ID.water);
    return `wet-edge__any-${idx}`;
  }
  if (surface === "field") {
    const to = majorityNeighbor(grid, ix, iy, FIELD_TO) ?? "grass";
    const idx = neighborBlob(grid, ix, iy, (id) => id === SURFACE_ID.field);
    return `field__${to}-${idx}`;
  }
  if (DIRT_FROM.includes(surface) && hasNeighbor(grid, ix, iy, SURFACE_ID.dirt)) {
    const idx = neighborBlob(grid, ix, iy, (id) => id === SURFACE_ID[surface]);
    return `${surface}__dirt-${idx}`;
  }
  return undefined;
}

function majorityNeighbor(grid: SurfaceGrid, ix: number, iy: number, allowed: readonly TerrainSurface[]): TerrainSurface | undefined {
  const counts = new Map<TerrainSurface, number>();
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const j = cellAt(grid, ix + dx, iy + dy);
    if (j < 0) continue;
    const name = SURFACE_FROM_ID[grid.surface[j]!] ?? "grass";
    if (!allowed.includes(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: TerrainSurface | undefined;
  let n = 0;
  for (const [name, c] of counts) {
    if (c > n) {
      n = c;
      best = name;
    }
  }
  return best ?? allowed[0];
}

function hasNeighbor(grid: SurfaceGrid, ix: number, iy: number, id: number): boolean {
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const) {
    const j = cellAt(grid, ix + dx, iy + dy);
    if (j >= 0 && grid.surface[j] === id) return true;
  }
  return false;
}

function neighborBlob(grid: SurfaceGrid, ix: number, iy: number, match: (id: number) => boolean): number {
  const n = matchId(grid, ix, iy - 1, match);
  const e = matchId(grid, ix + 1, iy, match);
  const s = matchId(grid, ix, iy + 1, match);
  const w = matchId(grid, ix - 1, iy, match);
  const ne = matchId(grid, ix + 1, iy - 1, match);
  const se = matchId(grid, ix + 1, iy + 1, match);
  const sw = matchId(grid, ix - 1, iy + 1, match);
  const nw = matchId(grid, ix - 1, iy - 1, match);
  return blobIndexFromBits(n, ne, e, se, s, sw, w, nw);
}

function matchId(grid: SurfaceGrid, ix: number, iy: number, match: (id: number) => boolean): boolean {
  const j = cellAt(grid, ix, iy);
  if (j < 0) return false;
  return match(grid.surface[j]!);
}

function cellAt(grid: SurfaceGrid, ix: number, iy: number): number {
  if (ix < 0 || iy < 0 || ix >= grid.cols || iy >= grid.rows) return -1;
  return iy * grid.cols + ix;
}
