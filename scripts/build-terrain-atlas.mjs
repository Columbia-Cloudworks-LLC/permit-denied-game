import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "terrain");
const TILE_W = 48;
const TILE_H = 26;
const DIA_W = 22;
const DIA_H = 11;

const PAL = {
  grass: 0x5a7340,
  grassDark: 0x3e522c,
  dirt: 0x8a6a40,
  gravel: 0x8a8478,
  water: 0x3a6a8a,
  waterDark: 0x1e3a50,
  forestFloor: 0x283c24,
  fieldMature: 0x365826,
  fieldTilled: 0x7a5430,
  fieldStubble: 0xb08a48,
  planted: 0x3e562c,
};

const SOLIDS = {
  grass: PAL.grass,
  scrub: 0x4a5a30,
  dirt: PAL.dirt,
  prairie: 0x8a8a40,
  duff: 0x3a4224,
  "leaf-litter": 0x6a5a32,
  gravel: PAL.gravel,
  "forest-floor": PAL.forestFloor,
  field: PAL.fieldMature,
  "wet-edge": 0x4a7a62,
  water: PAL.water,
};

const SNOW_SOLIDS = {
  grass: 0xd6e2ee,
  scrub: 0xc8d4e0,
  dirt: 0xc4c8c0,
  prairie: 0xd4dce4,
  duff: 0xb8c4cc,
  "leaf-litter": 0xcac8c0,
  gravel: 0x9aa0a4,
  "forest-floor": 0xb8c4cc,
  field: 0xc8d4dc,
  "wet-edge": 0xb0c8d8,
  water: PAL.water,
};

const DIRT_FROM = ["grass", "prairie", "leaf-litter", "duff", "scrub"];
const FOREST_TO = ["grass", "duff", "leaf-litter"];
const FIELD_TO = ["grass", "prairie", "dirt"];

function validBlobMask(mask) {
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

const BLOB47 = [];
for (let mask = 0; mask < 256; mask++) if (validBlobMask(mask)) BLOB47.push(mask);

function rgb(color) {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

function jitter(color, variant, x, y) {
  const [r, g, b] = rgb(color);
  const n = ((x * 17 + y * 31 + variant * 97) >>> 0) % 13;
  const shift = (variant - 1) * 10 + (n - 6);
  const grain = ((x * 13) ^ (y * 29) ^ (variant * 7)) & 7;
  return [
    clamp(r + shift + grain - 3, 16, 230),
    clamp(g + Math.floor(shift * 0.7) + ((grain * 3) % 5) - 2, 16, 230),
    clamp(b + Math.floor(shift * 0.4) - grain + 1, 12, 220),
  ];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function inDiamond(px, py) {
  const cx = TILE_W * 0.5;
  const cy = TILE_H * 0.5;
  return Math.abs(px - cx) / DIA_W + Math.abs(py - cy) / DIA_H <= 1.02;
}

function wedgeBits(px, py) {
  const cx = TILE_W * 0.5;
  const cy = TILE_H * 0.5;
  const dx = px - cx;
  const dy = py - cy;
  const ang = Math.atan2(dy, dx);
  // Screen wedges mapped to world neighbors: right=+X/E, down-right≈S+E, etc.
  const tau = Math.PI * 2;
  const a = (ang + tau) % tau;
  const slice = Math.floor(((a + Math.PI / 8) % tau) / (Math.PI / 4));
  // 0 = E, 1 = SE, 2 = S, 3 = SW, 4 = W, 5 = NW, 6 = N, 7 = NE
  switch (slice) {
    case 0:
      return { e: true };
    case 1:
      return { se: true, e: true, s: true };
    case 2:
      return { s: true };
    case 3:
      return { sw: true, s: true, w: true };
    case 4:
      return { w: true };
    case 5:
      return { nw: true, n: true, w: true };
    case 6:
      return { n: true };
    default:
      return { ne: true, n: true, e: true };
  }
}

function maskHas(mask, bits) {
  const n = (mask & 1) !== 0;
  const ne = (mask & 2) !== 0;
  const e = (mask & 4) !== 0;
  const se = (mask & 8) !== 0;
  const s = (mask & 16) !== 0;
  const sw = (mask & 32) !== 0;
  const w = (mask & 64) !== 0;
  const nw = (mask & 128) !== 0;
  if (bits.n && n) return true;
  if (bits.ne && ne) return true;
  if (bits.e && e) return true;
  if (bits.se && se) return true;
  if (bits.s && s) return true;
  if (bits.sw && sw) return true;
  if (bits.w && w) return true;
  if (bits.nw && nw) return true;
  return false;
}

function drawSolid(color, variant) {
  const buf = Buffer.alloc(TILE_W * TILE_H * 4);
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const o = (y * TILE_W + x) * 4;
      const [r, g, b] = jitter(color, variant, x, y);
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = 255;
    }
  }
  return buf;
}

function drawBlob(color, mask, variant = 1) {
  const buf = Buffer.alloc(TILE_W * TILE_H * 4);
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const o = (y * TILE_W + x) * 4;
      if (!inDiamond(x + 0.5, y + 0.5)) continue;
      const bits = wedgeBits(x + 0.5, y + 0.5);
      if (!maskHas(mask, bits)) continue;
      const [r, g, b] = jitter(color, variant, x, y);
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = 220;
    }
  }
  return buf;
}

const frames = [];
for (const [name, color] of Object.entries(SOLIDS)) {
  for (let v = 0; v < 3; v++) frames.push({ name: `${name}-${v}`, buf: drawSolid(color, v) });
}
for (const [name, color] of Object.entries(SNOW_SOLIDS)) {
  for (let v = 0; v < 3; v++) frames.push({ name: `snow-${name}-${v}`, buf: drawSolid(color, v) });
}
for (const from of DIRT_FROM) {
  for (let i = 0; i < BLOB47.length; i++) {
    frames.push({ name: `${from}__dirt-${i}`, buf: drawBlob(SOLIDS.dirt, BLOB47[i]) });
  }
}
for (const to of FOREST_TO) {
  for (let i = 0; i < BLOB47.length; i++) {
    frames.push({ name: `forest-floor__${to}-${i}`, buf: drawBlob(SOLIDS["forest-floor"], BLOB47[i]) });
  }
}
for (const to of FIELD_TO) {
  for (let i = 0; i < BLOB47.length; i++) {
    frames.push({ name: `field__${to}-${i}`, buf: drawBlob(SOLIDS.field, BLOB47[i]) });
  }
}
for (let i = 0; i < BLOB47.length; i++) {
  frames.push({ name: `wet-edge__any-${i}`, buf: drawBlob(SOLIDS["wet-edge"], BLOB47[i]) });
  frames.push({ name: `water__wet-edge-${i}`, buf: drawBlob(SOLIDS.water, BLOB47[i], 2) });
}

const COLS = 32;
const ROWS = Math.ceil(frames.length / COLS);
const ATLAS_W = COLS * TILE_W;
const ATLAS_H = ROWS * TILE_H;
const atlas = Buffer.alloc(ATLAS_W * ATLAS_H * 4);
const jsonFrames = {};

for (let i = 0; i < frames.length; i++) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const ox = col * TILE_W;
  const oy = row * TILE_H;
  const src = frames[i].buf;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const si = (y * TILE_W + x) * 4;
      if (!src[si + 3]) continue;
      const di = ((oy + y) * ATLAS_W + (ox + x)) * 4;
      atlas[di] = src[si];
      atlas[di + 1] = src[si + 1];
      atlas[di + 2] = src[si + 2];
      atlas[di + 3] = src[si + 3];
    }
  }
  jsonFrames[frames[i].name] = {
    frame: { x: ox, y: oy, w: TILE_W, h: TILE_H },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: TILE_W, h: TILE_H },
    sourceSize: { w: TILE_W, h: TILE_H },
  };
}

await mkdir(OUT_DIR, { recursive: true });
await sharp(atlas, { raw: { width: ATLAS_W, height: ATLAS_H, channels: 4 } })
  .png()
  .toFile(join(OUT_DIR, "ground.png"));
await writeFile(
  join(OUT_DIR, "ground.json"),
  JSON.stringify({
    frames: jsonFrames,
    meta: {
      app: "permit-denied-terrain",
      image: "ground.png",
      format: "RGBA8888",
      size: { w: ATLAS_W, h: ATLAS_H },
      scale: "1",
    },
  }),
);
console.log(`wrote ${frames.length} frames ${ATLAS_W}x${ATLAS_H} blob47=${BLOB47.length}`);
