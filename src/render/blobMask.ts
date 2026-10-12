// Dependency-free so scripts/build-terrain-atlas.mjs can import it directly.

/** Neighbour flags packed in an 8-bit blob mask, clockwise from north. */
export interface BlobBits {
  n: boolean;
  ne: boolean;
  e: boolean;
  se: boolean;
  s: boolean;
  sw: boolean;
  w: boolean;
  nw: boolean;
}

export function blobBits(mask: number): BlobBits {
  return {
    n: (mask & 1) !== 0,
    ne: (mask & 2) !== 0,
    e: (mask & 4) !== 0,
    se: (mask & 8) !== 0,
    s: (mask & 16) !== 0,
    sw: (mask & 32) !== 0,
    w: (mask & 64) !== 0,
    nw: (mask & 128) !== 0,
  };
}

/** A corner only counts when both edges beside it are set. */
function validBlobMask(mask: number): boolean {
  const { n, ne, e, se, s, sw, w, nw } = blobBits(mask);
  if (ne && !(n && e)) return false;
  if (se && !(s && e)) return false;
  if (sw && !(s && w)) return false;
  if (nw && !(n && w)) return false;
  return true;
}

/** The 47 distinct blob-tile masks in atlas frame order. */
export const BLOB47_MASKS: readonly number[] = (() => {
  const masks: number[] = [];
  for (let mask = 0; mask < 256; mask++) {
    if (validBlobMask(mask)) masks.push(mask);
  }
  return masks;
})();
