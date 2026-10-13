import { Rng } from "../game/rng";
import type { Building, CollapsedSite, Material, SiteMark } from "./types";

export interface TownSiteHost {
  seed: number;
  collapsedSites: CollapsedSite[];
  siteRevision: number;
  roads: { x: number; y: number; w: number; d: number }[];
}

function hash32(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function majorityGround(building: Building): Material {
  const counts = new Map<Material, number>();
  for (let gx = 0; gx < building.w; gx++) {
    for (let gy = 0; gy < building.d; gy++) {
      const cell = building.grid[0]?.[gx]?.[gy];
      if (!cell) continue;
      counts.set(cell.material, (counts.get(cell.material) ?? 0) + 1);
    }
  }
  let best: Material = building.cells[0]?.material ?? "wood";
  let n = -1;
  for (const [mat, c] of counts) {
    if (c > n) {
      n = c;
      best = mat;
    }
  }
  return best;
}

function occupiedGround(building: Building): { gx: number; gy: number }[] {
  const out: { gx: number; gy: number }[] = [];
  for (let gx = 0; gx < building.w; gx++) {
    for (let gy = 0; gy < building.d; gy++) {
      const cell = building.grid[0]?.[gx]?.[gy];
      if (cell) out.push({ gx, gy });
    }
  }
  return out;
}

function clipToFootprint(
  building: Building,
  x: number,
  y: number,
  w: number,
  d: number,
): { x: number; y: number; w: number; d: number } | null {
  const fx = building.x;
  const fy = building.y;
  const fw = building.w * building.cellSize;
  const fd = building.d * building.cellSize;
  const x0 = Math.max(x, fx);
  const y0 = Math.max(y, fy);
  const x1 = Math.min(x + w, fx + fw);
  const y1 = Math.min(y + d, fy + fd);
  if (x1 - x0 < 0.08 || y1 - y0 < 0.08) return null;
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
}

function overlapsRoad(
  roads: TownSiteHost["roads"],
  x: number,
  y: number,
  w: number,
  d: number,
): boolean {
  for (const road of roads) {
    if (x < road.x + road.w && x + w > road.x && y < road.y + road.d && y + d > road.y) return true;
  }
  return false;
}

export function siteDescriptor(site: CollapsedSite): string {
  return [
    site.buildingId,
    site.seed,
    site.foundationMaterial,
    site.collapseDirectionX.toFixed(3),
    site.collapseDirectionY.toFixed(3),
    site.marks.map((m) => `${m.kind}:${m.x.toFixed(2)}:${m.y.toFixed(2)}:${m.w.toFixed(2)}`).join(","),
  ].join("|");
}

/** Shared inputs while one collapsed site's ground marks are laid out. */
interface SiteLayout {
  building: Building;
  town: TownSiteHost;
  rng: Rng;
  dx: number;
  dy: number;
  fw: number;
  fd: number;
  marks: SiteMark[];
}

/** Clip to the footprint and drop marks that land on roads (unless `onRoads`); push the rest. */
function pushSiteMark(site: SiteLayout, kind: SiteMark["kind"], x: number, y: number, w: number, d: number, heading: () => number, z: number, onRoads = false): void {
  const clip = clipToFootprint(site.building, x, y, w, d);
  if (!clip || (!onRoads && overlapsRoad(site.town.roads, clip.x, clip.y, clip.w, clip.d))) return;
  site.marks.push({ kind, ...clip, heading: heading(), seed: site.rng.int(1, 1_000_000), z });
}

export function buildCollapsedSite(building: Building, town: TownSiteHost): CollapsedSite {
  const leanL = Math.hypot(building.leanX, building.leanY) || 1;
  const dx = building.leanX / leanL;
  const dy = building.leanY / leanL;
  const seed = hash32(building.id, town.seed, building.w, building.d, building.floors, Math.round(dx * 100), Math.round(dy * 100));
  const cs = building.cellSize;
  const fw = building.w * cs;
  const fd = building.d * cs;
  const site: SiteLayout = { building, town, rng: new Rng(seed), dx, dy, fw, fd, marks: [] };

  outlineMarks(site, 8 + (seed % 4));
  patchMarks(site, 4 + (seed % 3));
  crackMarks(site);
  ridgeMarks(site, 3 + (seed % 3));
  remnantMarks(site, 2 + (seed % 2));
  if (site.marks.length < 7) fallbackMarks(site);

  const channels = [
    { x: building.x + fw * 0.5, y: building.y + fd * 0.5, r: Math.min(fw, fd) * 0.22 },
    { x: building.x + fw * 0.35 - dy * 0.4, y: building.y + fd * 0.55 + dx * 0.4, r: 0.55 },
  ];

  return {
    buildingId: building.id,
    x: building.x,
    y: building.y,
    w: fw,
    d: fd,
    seed,
    foundationMaterial: majorityGround(building),
    collapseDirectionX: dx,
    collapseDirectionY: dy,
    marks: site.marks,
    channels,
  };
}

/** Broken wall stubs around the footprint, walking north, east, south, then west; at least four. */
function outlineMarks(site: SiteLayout, count: number): void {
  const { building, rng, fw } = site;
  for (let i = 0; i < count; i++) {
    const stroke = outlineStroke(site, i % 4, i / count);
    const clip = clipToFootprint(building, stroke.x, stroke.y, stroke.w, stroke.d);
    if (!clip || overlapsRoad(site.town.roads, clip.x, clip.y, clip.w, clip.d)) continue;
    site.marks.push({ kind: "outline", ...clip, heading: stroke.heading, seed: rng.int(1, 1_000_000), z: 0.03 });
  }
  if (site.marks.filter((m) => m.kind === "outline").length >= 4) return;
  site.marks.push({
    kind: "outline",
    x: building.x + 0.06,
    y: building.y + 0.06,
    w: Math.max(0.4, fw - 0.12),
    d: 0.1,
    heading: 0,
    seed: rng.int(1, 1_000_000),
    z: 0.03,
  });
}

function outlineStroke(site: SiteLayout, side: number, t: number): { x: number; y: number; w: number; d: number; heading: number } {
  const { building, rng, fw, fd } = site;
  let w = rng.range(0.35, 0.85);
  let d = rng.range(0.08, 0.16);
  if (side === 0) {
    const x = building.x + t * fw + rng.range(-0.08, 0.12);
    const y = building.y + rng.range(-0.04, 0.1);
    return { x, y, w, d, heading: rng.range(-0.2, 0.2) };
  }
  if (side === 2) {
    const x = building.x + (1 - t) * fw + rng.range(-0.1, 0.1);
    const y = building.y + fd - rng.range(0.04, 0.14);
    return { x, y, w, d, heading: rng.range(-0.25, 0.25) };
  }
  const x = side === 1 ? building.x + fw - rng.range(0.04, 0.14) : building.x + rng.range(-0.04, 0.1);
  const y = building.y + (side === 1 ? t : 1 - t) * fd + rng.range(-0.1, 0.1);
  w = rng.range(0.08, 0.16);
  d = side === 1 ? rng.range(0.3, 0.8) : rng.range(0.3, 0.75);
  return { x, y, w, d, heading: rng.range(-0.2, 0.2) };
}

/** Exposed dirt and slab pads on ground cells, nudged along the collapse direction. */
function patchMarks(site: SiteLayout, count: number): void {
  const { building, rng, dx, dy } = site;
  const cs = building.cellSize;
  const cells = occupiedGround(building);
  for (let i = 0; i < count; i++) {
    const cell = cells[rng.int(0, Math.max(0, cells.length - 1))] ?? { gx: 0, gy: 0 };
    const along = rng.range(-0.15, 0.55);
    const x = building.x + (cell.gx + 0.15) * cs + dx * along * cs;
    const y = building.y + (cell.gy + 0.15) * cs + dy * along * cs;
    const w = rng.range(0.35, 0.8), d = rng.range(0.28, 0.65);
    const clip = clipToFootprint(building, x, y, w, d);
    if (!clip || overlapsRoad(site.town.roads, clip.x, clip.y, clip.w, clip.d)) continue;
    site.marks.push({
      kind: rng.chance(0.45) ? "dirt" : "slab",
      ...clip,
      heading: rng.range(-0.4, 0.4),
      seed: rng.int(1, 1_000_000),
      z: 0.01,
    });
  }
}

/** Six thin cracks radiating along the collapse direction; cracks may cross the street. */
function crackMarks(site: SiteLayout): void {
  const { building, rng, dx, dy, fw, fd } = site;
  for (let i = 0; i < 6; i++) {
    const t = rng.range(0.15, 0.85);
    const x = building.x + fw * 0.5 + dx * (t - 0.2) * fw * 0.35 + rng.range(-0.35, 0.35);
    const y = building.y + fd * 0.5 + dy * (t - 0.2) * fd * 0.35 + rng.range(-0.35, 0.35);
    const w = rng.range(0.45, 1.1), d = rng.range(0.04, 0.08);
    pushSiteMark(site, "crack", x, y, w, d, () => Math.atan2(dy, dx) + rng.range(-0.35, 0.35), 0.015, true);
  }
}

/** Rubble ridges stepping out along the collapse direction, kept off the centre. */
function ridgeMarks(site: SiteLayout, count: number): void {
  const { building, rng, dx, dy, fw, fd } = site;
  for (let i = 0; i < count; i++) {
    const along = 0.18 + i * 0.16 + rng.range(0, 0.08);
    const x = building.x + fw * 0.5 + dx * along * fw * 0.42 + rng.range(-0.4, 0.4);
    const y = building.y + fd * 0.5 + dy * along * fd * 0.42 + rng.range(-0.4, 0.4);
    if (Math.hypot(x - (building.x + fw * 0.5), y - (building.y + fd * 0.5)) < Math.min(fw, fd) * 0.18) continue;
    const w = rng.range(0.4, 0.85), d = rng.range(0.18, 0.34);
    pushSiteMark(site, "ridge", x, y, w, d, () => Math.atan2(dy, dx) + rng.range(-0.5, 0.5), 0.08);
  }
}

/** Standing remnants off-centre toward the collapse side. */
function remnantMarks(site: SiteLayout, count: number): void {
  const { building, rng, dx, dy, fw, fd } = site;
  for (let i = 0; i < count; i++) {
    const along = 0.22 + i * 0.18;
    const x = building.x + fw * 0.35 + dx * along * fw * 0.4 + rng.range(-0.25, 0.25);
    const y = building.y + fd * 0.35 + dy * along * fd * 0.4 + rng.range(-0.25, 0.25);
    if (Math.hypot(x - (building.x + fw * 0.5), y - (building.y + fd * 0.5)) < Math.min(fw, fd) * 0.16) continue;
    const w = rng.range(0.28, 0.5), d = rng.range(0.18, 0.32);
    pushSiteMark(site, "remnant", x, y, w, d, () => rng.range(-0.8, 0.8), 0.12);
  }
}

/** Sparse sites still get a slab, a dirt patch and a ridge. */
function fallbackMarks(site: SiteLayout): void {
  const { building, rng, dx, dy, fw, fd } = site;
  site.marks.push(
    {
      kind: "slab",
      x: building.x + fw * 0.18,
      y: building.y + fd * 0.2,
      w: fw * 0.28,
      d: fd * 0.22,
      heading: 0.1,
      seed: rng.int(1, 1_000_000),
      z: 0.01,
    },
    {
      kind: "dirt",
      x: building.x + fw * 0.5,
      y: building.y + fd * 0.45,
      w: fw * 0.22,
      d: fd * 0.18,
      heading: -0.2,
      seed: rng.int(1, 1_000_000),
      z: 0.01,
    },
    {
      kind: "ridge",
      x: building.x + fw * 0.55 + dx * 0.2,
      y: building.y + fd * 0.55 + dy * 0.2,
      w: 0.45,
      d: 0.22,
      heading: Math.atan2(dy, dx),
      seed: rng.int(1, 1_000_000),
      z: 0.08,
    },
  );
}

export function ensureCollapsedSite(town: TownSiteHost, building: Building): CollapsedSite | null {
  if (town.collapsedSites.some((s) => s.buildingId === building.id)) return null;
  const site = buildCollapsedSite(building, town);
  town.collapsedSites.push(site);
  town.siteRevision++;
  return site;
}

export function siteContaining(town: TownSiteHost, x: number, y: number): CollapsedSite | undefined {
  for (const site of town.collapsedSites) {
    if (x >= site.x && y >= site.y && x <= site.x + site.w && y <= site.y + site.d) return site;
  }
  return undefined;
}

export function siteFeel(site: CollapsedSite, x: number, y: number): number {
  for (const ch of site.channels) {
    if (Math.hypot(x - ch.x, y - ch.y) < ch.r) return 0.03;
  }
  let feel = 0.08;
  for (const m of site.marks) {
    if (m.kind !== "ridge" && m.kind !== "remnant") continue;
    if (x >= m.x && y >= m.y && x <= m.x + m.w && y <= m.y + m.d) {
      feel = Math.max(feel, m.kind === "remnant" ? 0.2 : 0.16);
    }
  }
  return feel;
}

