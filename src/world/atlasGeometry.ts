/**
 * Plane geometry for the road atlas: shared by `scripts/build-atlas-data.mjs` (which runs it on
 * projected Natural Earth outlines at build time) and the overworld chunk's schematic fallback.
 * Pure functions, erasable TypeScript only, so Node can import this file directly.
 */

export type Point = readonly [number, number];

/**
 * County numbers from the busiest cell to the quietest: Downtown (6), Suburban (4), Industrial
 * (3), Main Street (5), Roadside (2), Rural (1). The numbers stay tied to their archetypes, levels
 * and saved clears; only which Voronoi cell each one occupies follows highway density.
 */
export const DENSEST_FIRST: readonly number[] = [6, 4, 3, 5, 2, 1];
/** One closed ring; the closing point is implied. */
export type Ring = readonly Point[];
export type BBox = readonly [minX: number, minY: number, maxX: number, maxY: number];

export function ringsBBox(rings: readonly Ring[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Signed shoelace area; the sign depends on winding. */
export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j]![0] * ring[i]![1]) - (ring[i]![0] * ring[j]![1]);
  return sum / 2;
}

/** Even-odd containment across every ring, so holes and multipolygons both work. */
export function pointInRings(point: Point, rings: readonly Ring[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function segmentDistanceSq(point: Point, a: Point, b: Point): number {
  const [px, py] = point;
  let [x, y] = a;
  const dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  return (px - x) ** 2 + (py - y) ** 2;
}

/** Distance to the nearest edge, negative outside. */
function signedEdgeDistance(point: Point, rings: readonly Ring[]): number {
  let best = Infinity;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, segmentDistanceSq(point, ring[i]!, ring[j]!));
  }
  return (pointInRings(point, rings) ? 1 : -1) * Math.sqrt(best);
}

/**
 * Approximate pole of inaccessibility: the interior point farthest from any edge, found by a
 * coarse grid and two refinements. Labels go here, so they never fall outside a curved state.
 */
export function labelAnchor(rings: readonly Ring[]): [number, number] {
  const [minX, minY, maxX, maxY] = ringsBBox(rings);
  let best: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  let bestScore = signedEdgeDistance(best, rings);
  let cx = best[0], cy = best[1], spanX = maxX - minX, spanY = maxY - minY;
  for (let pass = 0; pass < 3; pass++) {
    const steps = 24;
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
      const p: [number, number] = [cx - spanX / 2 + (spanX * i) / steps, cy - spanY / 2 + (spanY * j) / steps];
      const score = signedEdgeDistance(p, rings);
      if (score > bestScore) { best = p; bestScore = score; }
    }
    [cx, cy] = best;
    spanX /= 6;
    spanY /= 6;
  }
  return best;
}

/** Grid points inside the rings, densified until there are enough to cluster. */
function interiorSamples(rings: readonly Ring[], minimum = 240): [number, number][] {
  const [minX, minY, maxX, maxY] = ringsBBox(rings);
  const w = maxX - minX, h = maxY - minY;
  for (let steps = 40; steps <= 640; steps *= 2) {
    const cell = Math.max(w, h) / steps;
    const samples: [number, number][] = [];
    for (let y = minY + cell / 2; y < maxY; y += cell) for (let x = minX + cell / 2; x < maxX; x += cell) {
      if (pointInRings([x, y], rings)) samples.push([x, y]);
    }
    if (samples.length >= minimum || steps === 640) return samples;
  }
  return [];
}

function nearest(point: Point, seeds: readonly Point[]): number {
  let best = 0, bestD = Infinity;
  seeds.forEach(([sx, sy], i) => {
    const d = (point[0] - sx) ** 2 + (point[1] - sy) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Each of Counties 1–6 should hold at least this share of the region's interior. */
export const MIN_COUNTY_SHARE = 0.05;

export interface CountyLayout {
  /** Voronoi seeds, County 1 first; the last seed is the fixed capitol point. */
  seeds: [number, number][];
  /** An interior sample near each county's middle, for its label and stamp. */
  labels: [number, number][];
}

/**
 * Seven county seeds for one region: the capitol is fixed as the last seed and the other six
 * are spread over the interior by farthest-point picks then Lloyd relaxation, all deterministic.
 * Counties 1–6 are numbered clockwise from north around the region's middle.
 */
/**
 * The capitol county's label: an interior sample of its own cell, at least `clearance` from the
 * capitol so the number clears the bullseye drawn there, as near as possible to `clearance`
 * straight south of it. Labels let clicks through to the cell, so the point must be inside it.
 */
function capitolLabel(group: readonly [number, number][], capitol: Point, clearance: number): [number, number] {
  const target: Point = [capitol[0], capitol[1] + clearance];
  let best: [number, number] | undefined, bestD = Infinity, far: [number, number] | undefined, farD = -1;
  for (const p of group) {
    const fromCapitol = Math.hypot(p[0] - capitol[0], p[1] - capitol[1]);
    if (fromCapitol > farD) { farD = fromCapitol; far = p; }
    if (fromCapitol < clearance) continue;
    const d = Math.hypot(p[0] - target[0], p[1] - target[1]);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best ?? far ?? [capitol[0], capitol[1]];
}

export function countyLayout(rings: readonly Ring[], capitol: Point, count = 7, capitolClearance = 0): CountyLayout {
  const samples = interiorSamples(rings);
  if (samples.length < count) {
    const [minX, minY, maxX, maxY] = ringsBBox(rings);
    for (let i = samples.length; i < count * 4; i++) {
      samples.push([minX + ((maxX - minX) * ((i * 0.618) % 1)), minY + ((maxY - minY) * ((i * 0.382) % 1))]);
    }
  }
  const fixed: [number, number] = [capitol[0], capitol[1]];
  const free: [number, number][] = [];
  const chosen = (): [number, number][] => [...free, fixed];
  while (free.length < count - 1) {
    let pick = samples[0]!, pickD = -1;
    const seeds = chosen();
    for (const s of samples) {
      const n = seeds[nearest(s, seeds)]!;
      const d = (s[0] - n[0]) ** 2 + (s[1] - n[1]) ** 2;
      if (d > pickD) { pickD = d; pick = s; }
    }
    free.push([pick[0], pick[1]]);
  }
  let groups: [number, number][][] = [];
  const assign = () => {
    const seeds = chosen();
    groups = seeds.map(() => []);
    for (const s of samples) groups[nearest(s, seeds)]!.push(s);
  };
  const relax = (iterations: number) => {
    for (let iteration = 0; iteration < iterations; iteration++) {
      assign();
      for (let i = 0; i < free.length; i++) {
        const group = groups[i]!;
        if (!group.length) continue;
        free[i] = [group.reduce((sum, p) => sum + p[0], 0) / group.length, group.reduce((sum, p) => sum + p[1], 0) / group.length];
      }
    }
    assign();
  };
  relax(12);
  // A seed stranded on an islet or a thin coast stays tiny under relaxation alone, leaving a
  // county too small to click. Move such seeds into the largest county and relax again.
  for (let round = 0; round < 8; round++) {
    const small = free.findIndex((_, i) => groups[i]!.length < samples.length * MIN_COUNTY_SHARE);
    if (small < 0) break;
    let largest = 0;
    groups.forEach((group, i) => { if (group.length > groups[largest]!.length) largest = i; });
    const host = groups[largest]!, centre = chosen()[largest]!;
    let pick = host[0]!, pickD = -1;
    for (const p of host) {
      const d = (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2;
      if (d > pickD) { pickD = d; pick = p; }
    }
    // Halfway between the largest county's centre and its farthest point splits it in two.
    free[small] = [(pick[0] + centre[0]) / 2, (pick[1] + centre[1]) / 2];
    relax(8);
  }
  const labelOf = (group: [number, number][], seed: Point): [number, number] => {
    if (!group.length) return [seed[0], seed[1]];
    const mx = group.reduce((sum, p) => sum + p[0], 0) / group.length;
    const my = group.reduce((sum, p) => sum + p[1], 0) / group.length;
    return group[nearest([mx, my], group)]!;
  };
  const [minX, minY, maxX, maxY] = ringsBBox(rings);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const clockwise = (p: Point) => (Math.atan2(p[0] - cx, -(p[1] - cy)) + Math.PI * 2) % (Math.PI * 2);
  const order = free.map((_, i) => i).sort((a, b) => clockwise(free[a]!) - clockwise(free[b]!));
  return {
    seeds: [...order.map(i => free[i]!), fixed],
    labels: [...order.map(i => labelOf(groups[i]!, free[i]!)), capitolClearance > 0 ? capitolLabel(groups[free.length]!, fixed, capitolClearance) : labelOf(groups[free.length]!, fixed)],
  };
}

/**
 * Highway density per county: line length inside the region and nearest to each seed (so inside
 * its Voronoi cell), divided by that cell's share of the region's interior. Lines are walked in
 * steps of `step` map units.
 */
export function cellLineDensity(seeds: readonly Point[], rings: readonly Ring[], lines: readonly (readonly Point[])[], step = 0.5): number[] {
  const area = seeds.map(() => 0);
  for (const s of interiorSamples(rings)) area[nearest(s, seeds)]!++;
  const length = seeds.map(() => 0);
  const [minX, minY, maxX, maxY] = ringsBBox(rings);
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!;
      if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(ay, by) < minY || Math.min(ay, by) > maxY) continue;
      const len = Math.hypot(bx - ax, by - ay);
      const parts = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < parts; k++) {
        const t = (k + 0.5) / parts;
        const p: Point = [ax + (bx - ax) * t, ay + (by - ay) * t];
        if (pointInRings(p, rings)) length[nearest(p, seeds)]! += len / parts;
      }
    }
  }
  return length.map((l, i) => (area[i] ? l / area[i]! : 0));
}

/**
 * Which cell each county number gets: cells ranked densest first (ties go to the cell nearer the
 * capitol), and `densestFirst` lists county numbers in the same order. Returns, for county
 * number n, the index of its cell.
 */
export function rankCellsByDensity(densities: readonly number[], seeds: readonly Point[], capitol: Point, densestFirst: readonly number[]): number[] {
  const distance = (i: number) => Math.hypot(seeds[i]![0] - capitol[0], seeds[i]![1] - capitol[1]);
  const ranked = densities.map((_, i) => i).sort((a, b) => densities[b]! - densities[a]! || distance(a) - distance(b) || a - b);
  const cellFor: number[] = [];
  densestFirst.forEach((county, rank) => { cellFor[county - 1] = ranked[rank]!; });
  return cellFor;
}

/** Keep the part of a convex polygon on `seed`'s side of the bisector with `other`. */
function clipHalfPlane(polygon: Point[], seed: Point, other: Point): Point[] {
  const nx = other[0] - seed[0], ny = other[1] - seed[1];
  const c = (other[0] ** 2 + other[1] ** 2 - seed[0] ** 2 - seed[1] ** 2) / 2;
  const side = (p: Point) => p[0] * nx + p[1] * ny - c;
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    const sa = side(a), sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Voronoi cells of `seeds`, each clipped to `bbox`; cell i belongs to seed i. */
export function voronoiCells(seeds: readonly Point[], bbox: BBox): Point[][] {
  const [minX, minY, maxX, maxY] = bbox;
  return seeds.map((seed, i) => {
    let cell: Point[] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    seeds.forEach((other, j) => {
      if (j !== i && (other[0] !== seed[0] || other[1] !== seed[1])) cell = clipHalfPlane(cell, seed, other);
    });
    return cell;
  });
}

/** Ramer–Douglas–Peucker on one closed ring. */
export function simplifyRing(ring: Ring, tolerance: number): Point[] {
  if (ring.length <= 4 || tolerance <= 0) return [...ring];
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  // Split at the vertex farthest from the first so a closed ring has a stable chord.
  let far = 0, farD = -1;
  ring.forEach((p, i) => {
    const d = (p[0] - ring[0]![0]) ** 2 + (p[1] - ring[0]![1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  });
  keep[far] = 1;
  const tolSq = tolerance * tolerance;
  const stack: [number, number][] = [[0, far], [far, ring.length]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const end = ring[b % ring.length]!;
    let index = -1, maxD = tolSq;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistanceSq(ring[i]!, ring[a]!, end);
      if (d > maxD) { maxD = d; index = i; }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/** Ramer–Douglas–Peucker on an open polyline; both ends are kept. */
export function simplifyLine(line: readonly Point[], tolerance: number): Point[] {
  if (line.length <= 2) return [...line];
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const tolSq = tolerance * tolerance;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let index = -1, maxD = tolSq;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistanceSq(line[i]!, line[a]!, line[b]!);
      if (d > maxD) { maxD = d; index = i; }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/**
 * Compact SVG path data with 0.1-unit precision: absolute moveto, then relative linetos.
 * Points are quantized first so the deltas add back up to exact tenths.
 */
export function ringsToPath(rings: readonly Ring[]): string {
  return toPath(rings, true);
}

/** Open polylines (highways, graticule) in the same compact form, without closing. */
export function linesToPath(lines: readonly (readonly Point[])[]): string {
  return toPath(lines, false);
}

function toPath(rings: readonly (readonly Point[])[], closed: boolean): string {
  const fmt = (tenths: number) => {
    const text = String(tenths / 10);
    return text.startsWith('0.') ? text.slice(1) : text.startsWith('-0.') ? `-${text.slice(2)}` : text;
  };
  const join = (values: number[]) => values.map((v, i) => {
    const text = fmt(v);
    return i === 0 || text.startsWith('-') ? text : ` ${text}`;
  }).join('');
  let out = '';
  for (const ring of rings) {
    const q = ring.map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)] as const)
      .filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1]);
    if (q.length < (closed ? 3 : 2)) continue;
    const deltas: number[] = [];
    for (let i = 1; i < q.length; i++) deltas.push(q[i]![0] - q[i - 1]![0], q[i]![1] - q[i - 1]![1]);
    out += `M${join([q[0]![0], q[0]![1]])}l${join(deltas)}${closed ? 'z' : ''}`;
  }
  return out;
}
