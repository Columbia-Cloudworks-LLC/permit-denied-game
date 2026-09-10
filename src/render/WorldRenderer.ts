import { Container, Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import { Rng } from "../game/rng";
import { depthKey, roofPainterDepth, screenAabbVisible, worldBoundsToScreen, worldToScreen } from "../world/iso";
import type { ParticlePool } from "../fx/particles";
import { displacedRoofVerts, roofHeightAt } from "../structure/roof";
import type { Bird, Building, CollapsedSite, CoverKind, GroundMark, GroundPatch, Particle, RoofSection, Rubble } from "../structure/types";
import type { Dozer } from "../vehicle/dozer";
import type { Town } from "../world/town";
import { aggregateSurfaceStats, getBuildingSurfaces } from "./buildingSurfaces";
import { drawCatalogProp } from "./assets";
import { cellColors, drawGroundPoly, drawIsoBox, drawOrientedGround, drawOrientedIsoBox, drawShadow, drawSlopedQuad, PAL, shade } from "./drawIso";
import {
  drawBreachGroup,
  drawBuildingFootprintShadow,
  drawFallingCell,
  drawTopSpan,
  drawWallSpan,
} from "./facadeDraw";
import { roofSlopeLight } from "./lighting";
import { drawDozer, drawRoadVehicle } from "./vehicles";

interface Cmd {
  depth: number;
  run: (g: Graphics) => void;
}

export class WorldRenderer {
  readonly root = new Container();
  private readonly ground = new Graphics();
  private readonly sites = new Graphics();
  private readonly overlay = new Graphics();
  private readonly world = new Graphics();
  private readonly cmds: Cmd[] = [];
  camX = 0;
  camY = 0;
  zoom = 1.15;
  private viewW = 1;
  private viewH = 1;
  private groundKey = "";
  private overlayKey = "";
  private siteKey = "";
  stats = { total: 0, visible: 0, surfaceGeometry: 0 };

  constructor() {
    this.root.addChild(this.ground, this.sites, this.overlay, this.world);
    this.root.sortableChildren = false;
  }

  invalidate(): void {
    this.groundKey = "";
    this.overlayKey = "";
    this.siteKey = "";
  }

  layout(viewW: number, viewH: number, shakeX: number, shakeY: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.root.position.set(viewW / 2 - this.camX + shakeX, viewH / 2 - this.camY + shakeY);
    this.root.scale.set(this.zoom);
  }

  private visibleBox(x: number, y: number, w: number, d: number, z0: number, z1: number): boolean {
    return screenAabbVisible(
      worldBoundsToScreen(x, y, w, d, z0, z1),
      this.viewW,
      this.viewH,
      this.camX,
      this.camY,
      this.zoom,
    );
  }

  draw(
    town: Town,
    dozer: Dozer,
    particles: ParticlePool,
    birds: Bird[],
    occludeX: number,
    occludeY: number,
  ): void {
    this.world.clear();
    this.cmds.length = 0;
    let total = 0;
    let visible = 0;

    const gKey = `${town.district}:${town.seed}:${town.lots.length}:${town.network.mesh.length}:${town.ground.length}`;
    if (gKey !== this.groundKey) {
      this.ground.clear();
      const covers = town.ground.length
        ? town.ground
        : town.lots.map((lot) => ({
            x: lot.x,
            y: lot.y,
            w: lot.w,
            d: lot.d,
            heading: 0,
            cover: "lot" as CoverKind,
            seed: town.seed,
            z: 0,
          }));
      for (const patch of covers) {
        drawCover(this.ground, patch);
      }
      const mesh = town.network.mesh;
      if (mesh.length) {
        for (const q of mesh) {
          if (q.kind === "mark") {
            drawOrientedGround(this.ground, q.x, q.y, q.heading, q.w, q.d, q.color, 0.72, q.z);
          } else {
            drawOrientedGround(this.ground, q.x, q.y, q.heading, q.w, q.d, q.color, 1, q.z);
          }
        }
      } else {
        for (const road of town.roads) {
          drawGroundPoly(this.ground, road.x, road.y, road.w, road.d, PAL.asphalt);
        }
      }
      this.groundKey = gKey;
    }

    const sKey = `${town.siteRevision}:${town.collapsedSites.length}`;
    if (sKey !== this.siteKey) {
      this.sites.clear();
      for (const site of town.collapsedSites) drawCollapsedSite(this.sites, site);
      this.siteKey = sKey;
    }

    const camCell = `${Math.round(this.camX / 28)}:${Math.round(this.camY / 28)}`;
    const oKey = `${town.visualRevision}:${town.pile.revision}:${camCell}`;
    if (oKey !== this.overlayKey) {
      this.overlay.clear();
      for (const mark of town.marks) {
        total++;
        if (!this.visibleBox(mark.x - mark.w, mark.y - mark.d, mark.w * 2, mark.d * 2, 0, 0.02)) continue;
        visible++;
        drawGroundMark(this.overlay, mark);
      }
      drawPileHints(this.overlay, town, (x, y, w, d) => this.visibleBox(x, y, w, d, 0, 0.4));
      this.overlayKey = oKey;
    }

    const surfaceStats = aggregateSurfaceStats(town.buildings);
    for (const b of town.buildings) {
      const bw = b.w * b.cellSize;
      const bd = b.d * b.cellSize;
      const z1 = b.floors * FLOOR_Z + 0.8;
      const fall = 1.4;
      total += b.cells.length;
      if (!this.visibleBox(b.x - fall, b.y - fall, bw + fall * 2, bd + fall * 2, -0.4, z1)) continue;
      const fade = occludes(b, occludeX, occludeY) ? 0.38 : 1;
      const surfaces = getBuildingSurfaces(b);
      const hasSolid = b.cells.some((c) => c.state !== "gone" && c.state !== "falling");
      if (hasSolid) {
        visible++;
        this.cmds.push({
          depth: depthKey(b.x + bw * 0.5, b.y + bd * 0.5, 0),
          run: (g) => drawBuildingFootprintShadow(g, surfaces.footprint, fade),
        });
      }
      for (const span of surfaces.walls) {
        visible++;
        this.cmds.push({
          depth: span.depth,
          run: (g) => drawWallSpan(g, b, span, fade),
        });
      }
      for (const span of surfaces.tops) {
        visible++;
        this.cmds.push({
          depth: span.depth,
          run: (g) => drawTopSpan(g, b, span, fade),
        });
      }
      for (const breach of surfaces.breaches) {
        visible++;
        this.cmds.push({
          depth: breach.depth,
          run: (g) => drawBreachGroup(g, b, breach, fade),
        });
      }
      for (const cell of b.cells) {
        if (cell.state !== "falling") continue;
        const cx = b.x + cell.gx * b.cellSize + cell.fallDx * cell.fallT * 0.85;
        const cy = b.y + cell.gy * b.cellSize + cell.fallDy * cell.fallT * 0.85;
        const z0 = cell.floor * FLOOR_Z - cell.sag * 0.55 - cell.fallT * 1.6;
        if (!this.visibleBox(cx, cy, b.cellSize, b.cellSize, z0, z0 + FLOOR_Z)) continue;
        visible++;
        this.cmds.push({
          depth: depthKey(
            b.x + (cell.gx + 0.5) * b.cellSize + cell.fallDx * cell.fallT,
            b.y + (cell.gy + 0.5) * b.cellSize + cell.fallDy * cell.fallT,
            cell.floor * FLOOR_Z,
          ),
          run: (g) => {
            drawShadow(g, cx, cy, b.cellSize, b.cellSize, 0.18 * fade);
            drawFallingCell(g, b, cell, fade);
          },
        });
      }
      const liveRoofs = b.roofs.filter((roof) => roof.state !== "gone");
      if (liveRoofs.length) {
        total += liveRoofs.length;
        const moved = liveRoofs.flatMap((roof) => roofVerts(roof));
        const c = roofCenter(moved);
        if (this.visibleBox(c.x - 2, c.y - 2, 4, 4, c.z - 1, c.z + 1.4)) {
          visible += liveRoofs.length;
          this.cmds.push({
            depth: roofPainterDepth(moved),
            run: (g) => drawBuildingRoofs(g, b, liveRoofs, fade),
          });
        }
      }
    }

    for (const p of town.props) {
      if (p.broken) continue;
      total++;
      if (!this.visibleBox(p.x, p.y, p.w, p.d, p.elev, p.elev + 3.2)) continue;
      visible++;
      this.cmds.push({
        depth: depthKey(p.x + p.w / 2, p.y + p.d / 2, p.elev + 0.4),
        run: (g) => drawCatalogProp(g, p),
      });
    }

    for (const r of town.rubble) {
      total++;
      if (!this.visibleBox(r.x - r.w, r.y - r.d, r.w * 2, r.d * 2, r.elev, r.elev + r.thickness + 0.25)) continue;
      visible++;
      this.cmds.push({
        depth: depthKey(r.x, r.y, r.elev + r.thickness * 0.5),
        run: (g) => drawDebris(g, r),
      });
    }

    if (town.roadCar?.alive) {
      const car = town.roadCar;
      total++;
      if (this.visibleBox(car.x - 1, car.y - 1, 2, 2, 0, 0.6)) {
        visible++;
        this.cmds.push({
          depth: depthKey(car.x, car.y, 0.35),
          run: (g) => drawRoadVehicle(g, car),
        });
      }
    }

    total++;
    visible++;
    this.cmds.push({
      depth: depthKey(dozer.x, dozer.y, 0.4),
      run: (g) => drawDozer(g, dozer),
    });

    for (const p of particles.items) {
      if (!p.alive) continue;
      total++;
      if (!this.visibleBox(p.x - 0.3, p.y - 0.3, 0.6, 0.6, 0, p.z + 0.2)) continue;
      visible++;
      this.cmds.push({
        depth: depthKey(p.x, p.y, p.z),
        run: (g) => drawParticle(g, p),
      });
    }

    for (const bird of birds) {
      total++;
      if (!this.visibleBox(bird.x - 0.4, bird.y - 0.4, 0.8, 0.8, bird.z, bird.z + 0.2)) continue;
      visible++;
      this.cmds.push({
        depth: depthKey(bird.x, bird.y, bird.z),
        run: (g) => drawBird(g, bird),
      });
    }

    this.cmds.sort((a, b) => a.depth - b.depth);
    for (const cmd of this.cmds) cmd.run(this.world);
    this.stats = { total, visible, surfaceGeometry: surfaceStats.geometryCount };
  }
}

function occludes(b: Building, px: number, py: number): boolean {
  const cx = b.x + (b.w * b.cellSize) / 2;
  const cy = b.y + (b.d * b.cellSize) / 2;
  if (cx + cy <= px + py + 0.4) return false;
  const dx = Math.abs(cx - px);
  const dy = Math.abs(cy - py);
  return dx < b.w * b.cellSize * 0.9 + 2.2 && dy < b.d * b.cellSize * 0.9 + 2.2;
}

function roofVerts(roof: RoofSection): { x: number; y: number; z: number }[] {
  return displacedRoofVerts(roof);
}

function chimneyWorld(b: Building): { x: number; y: number; z: number } | null {
  const live = b.roofs.some((r) => r.state === "intact" || r.state === "sagging");
  if (!live) return null;
  const cs = b.cellSize;
  const w = 0.32;
  const d = 0.32;
  const x = b.x + (b.w - 0.55) * cs;
  const y = b.y + 0.12;
  const samples = [
    roofHeightAt(b, x, y),
    roofHeightAt(b, x + w, y),
    roofHeightAt(b, x + w, y + d),
    roofHeightAt(b, x, y + d),
  ].filter((z): z is number => z != null);
  if (samples.length === 0) return null;
  return { x, y, z: Math.min(...samples) - 0.03 };
}

function drawChimney(g: Graphics, ch: { x: number; y: number; z: number }, alpha: number): void {
  drawIsoBox(g, ch.x, ch.y, 0.32, 0.32, ch.z, 0.85, PAL.brick, PAL.brickDark, PAL.brick, alpha);
}

function roofCenter(verts: { x: number; y: number; z: number }[]): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    x += v.x;
    y += v.y;
    z += v.z;
  }
  const n = Math.max(1, verts.length);
  return { x: x / n, y: y / n, z: z / n };
}

function roofColors(b: Building, roof: RoofSection, verts: { x: number; y: number; z: number }[]): { top: number; edge: number } {
  if (roof.material === "metal" || b.roof === "shed") return { top: PAL.roofMetal, edge: PAL.metalDark };
  if (b.roof === "flat") return { top: PAL.roofFelt, edge: PAL.metalDark };
  const lit = roofSlopeLight(verts);
  const top = lit >= 0 ? PAL.roofShingle : shade(PAL.roofShingle, 0.78);
  return { top, edge: PAL.roofShingleDark };
}

function ridgeKey(ridge: NonNullable<RoofSection["ridge"]>): string {
  return `${ridge.ax}:${ridge.ay}:${ridge.az}:${ridge.bx}:${ridge.by}:${ridge.bz}`;
}

function drawBuildingRoofs(g: Graphics, b: Building, roofs: RoofSection[], alpha: number): void {
  const ordered = roofs.slice().sort((a, c) => {
    const da = roofPainterDepth(roofVerts(a));
    const dc = roofPainterDepth(roofVerts(c));
    if (da !== dc) return da - dc;
    return a.id - c.id;
  });
  const drawnRidges = new Set<string>();
  for (const roof of ordered) drawRoofSection(g, b, roof, alpha, drawnRidges);
  if (b.features.chimney) {
    const ch = chimneyWorld(b);
    if (ch) drawChimney(g, ch, alpha);
  }
}

function drawRoofSection(
  g: Graphics,
  b: Building,
  roof: RoofSection,
  alpha: number,
  drawnRidges: Set<string>,
): void {
  const verts = roofVerts(roof);
  const cols = roofColors(b, roof, verts);
  const faded = roof.state === "falling" ? alpha * 0.88 : alpha;
  drawSlopedQuad(g, verts, cols.top, cols.edge, faded);
  if (roof.ridge && roof.state !== "falling") {
    const key = ridgeKey(roof.ridge);
    if (!drawnRidges.has(key)) {
      drawnRidges.add(key);
      const r = roof.ridge;
      const sag = roof.sag * 0.35;
      drawSlopedQuad(
        g,
        [
          { x: r.ax, y: r.ay, z: r.az + 0.05 - sag },
          { x: r.bx, y: r.by, z: r.bz + 0.05 - sag },
          { x: r.bx, y: r.by, z: r.bz - 0.02 - sag },
          { x: r.ax, y: r.ay, z: r.az - 0.02 - sag },
        ],
        PAL.roofShingleDark,
        PAL.roofShingleDark,
        faded,
      );
    }
  }
  if (b.features.parapet && roof.style === "flat" && roof.state === "intact") {
    const z = verts[0]!.z;
    const xs = verts.map((v) => v.x);
    const ys = verts.map((v) => v.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    drawIsoBox(g, x0, y0, x1 - x0, 0.08, z, 0.22, PAL.concrete, PAL.concreteDark, PAL.concrete, faded);
    drawIsoBox(g, x0, y1 - 0.08, x1 - x0, 0.08, z, 0.22, PAL.concrete, PAL.concreteDark, PAL.concrete, faded);
  }
}

function drawCollapsedSite(g: Graphics, site: CollapsedSite): void {
  const rng = new Rng(site.seed);
  drawGroundPoly(g, site.x + 0.04, site.y + 0.04, site.w - 0.08, site.d - 0.08, PAL.lotDark, 0.28);
  for (const mark of site.marks) {
    const color =
      mark.kind === "dirt"
        ? PAL.lotDark
        : mark.kind === "slab"
          ? PAL.concrete
          : mark.kind === "crack"
            ? PAL.crack
            : mark.kind === "outline"
              ? PAL.foundation
              : mark.kind === "ridge"
                ? PAL.concreteDark
                : PAL.brickDark;
    const alpha =
      mark.kind === "crack" ? 0.55 : mark.kind === "dirt" ? 0.4 : mark.kind === "outline" ? 0.7 : 0.62;
    if (mark.kind === "ridge" || mark.kind === "remnant") {
      drawIsoBox(g, mark.x, mark.y, mark.w, mark.d, 0, mark.z, color, PAL.concreteDark, color, alpha);
    } else {
      drawGroundPoly(g, mark.x, mark.y, mark.w, mark.d, color, alpha);
    }
  }
  void rng;
}

function drawCover(g: Graphics, patch: GroundPatch): void {
  const color = coverColor(patch.cover);
  if (Math.abs(patch.heading) > 0.05) {
    drawOrientedGround(g, patch.x + patch.w * 0.5, patch.y + patch.d * 0.5, patch.heading, patch.w, patch.d, color, 1, patch.z);
  } else {
    drawGroundPoly(g, patch.x, patch.y, patch.w, patch.d, color, 1, patch.z);
  }
  const speckle = patch.z < 0 ? 1 : Math.min(40, Math.max(4, Math.floor((patch.w * patch.d) / 18)));
  const dark = coverDark(patch.cover);
  for (let i = 0; i < speckle; i++) {
    const gx = patch.x + ((i * 17 + (patch.seed % 13)) % 97) * 0.12 * (patch.w / 8);
    const gy = patch.y + ((i * 29 + (patch.seed % 17)) % 89) * 0.1 * (patch.d / 8);
    if (gx > patch.x + patch.w || gy > patch.y + patch.d) continue;
    drawGroundPoly(g, gx, gy, 0.32, 0.26, dark, 0.2, patch.z);
  }
}

function coverColor(cover: CoverKind): number {
  switch (cover) {
    case "grass":
      return PAL.grass;
    case "scrub":
      return PAL.grassDark;
    case "dirt":
      return PAL.dirt;
    case "gravel":
      return PAL.gravel;
    case "tracks":
      return PAL.lotDark;
    case "concrete":
    case "parking":
      return PAL.concrete;
    case "driveway":
      return 0x5a5248;
    case "planted":
      return PAL.planted;
    case "lot":
      return PAL.lot;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}

function coverDark(cover: CoverKind): number {
  switch (cover) {
    case "grass":
    case "scrub":
    case "planted":
      return PAL.grassDark;
    case "dirt":
    case "tracks":
    case "lot":
      return PAL.lotDark;
    case "gravel":
    case "driveway":
      return 0x5a5448;
    case "concrete":
    case "parking":
      return PAL.concreteDark;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}

function drawParticle(g: Graphics, p: Particle): void {
  const fade = Math.min(1, p.life / p.maxLife);
  const s = worldToScreen(p.x, p.y, 0);
  g.ellipse(s.x, s.y, 3.2, 1.6);
  g.fill({ color: PAL.shadow, alpha: 0.2 * fade });
  if (p.kind === "dust") {
    const c = worldToScreen(p.x, p.y, p.z);
    const r = 5 + p.size * 10;
    g.rect(c.x - r / 2, c.y - r / 2, r, r);
    g.fill({ color: PAL.dust, alpha: 0.32 * fade });
    return;
  }
  const color =
    p.kind === "wood"
      ? PAL.wood
      : p.kind === "brick"
        ? PAL.brick
        : p.kind === "metal"
          ? PAL.metal
          : p.kind === "glass"
            ? 0xa8c4d0
            : PAL.concrete;
  const dark =
    p.kind === "wood"
      ? PAL.woodDark
      : p.kind === "brick"
        ? PAL.brickDark
        : p.kind === "metal"
          ? PAL.metalDark
          : PAL.concreteDark;
  const len = p.kind === "wood" ? 0.18 + p.size * 0.35 : 0.1 + p.size * 0.22;
  const wid = p.kind === "wood" ? 0.05 + p.size * 0.08 : 0.07 + p.size * 0.12;
  drawOrientedIsoBox(g, p.x, p.y, p.rot, len, wid, p.z, Math.max(0.04, p.size * 0.2), color, dark, color, 0.92 * fade);
}

function drawGroundMark(g: Graphics, mark: GroundMark): void {
  const color =
    mark.kind === "scrape"
      ? 0x2a2418
      : mark.kind === "dust"
        ? PAL.lotDark
        : mark.kind === "glass"
          ? 0x8aa4b0
          : mark.material === "wood"
            ? PAL.woodDark
            : mark.material === "brick"
              ? PAL.brickDark
              : mark.material === "metal"
                ? PAL.metalDark
                : PAL.concreteDark;
  const fx = Math.cos(mark.heading);
  const fy = Math.sin(mark.heading);
  const hx = mark.w * 0.5;
  const hy = mark.d * 0.5;
  const pts = [
    { x: mark.x + fx * hx - fy * hy, y: mark.y + fy * hx + fx * hy },
    { x: mark.x + fx * hx + fy * hy, y: mark.y + fy * hx - fx * hy },
    { x: mark.x - fx * hx + fy * hy, y: mark.y - fy * hx - fx * hy },
    { x: mark.x - fx * hx - fy * hy, y: mark.y - fy * hx + fx * hy },
  ];
  const q = pts.flatMap((p) => {
    const s = worldToScreen(p.x, p.y, 0);
    return [s.x, s.y];
  });
  g.poly(q);
  g.fill({ color, alpha: mark.alpha });
}

function drawPileHints(
  g: Graphics,
  town: Town,
  visible: (x: number, y: number, w: number, d: number) => boolean,
): void {
  const pile = town.pile;
  for (let iy = 0; iy < pile.rows; iy++) {
    for (let ix = 0; ix < pile.cols; ix++) {
      const i = iy * pile.cols + ix;
      const h = pile.height[i]!;
      if (h < 0.05) continue;
      const x = pile.ox + (ix + 0.12) * pile.cell;
      const y = pile.oy + (iy + 0.12) * pile.cell;
      const s = pile.cell * 0.76;
      if (!visible(x, y, s, s)) continue;
      const alpha = Math.min(0.62, 0.16 + h * 0.85);
      drawGroundPoly(g, x, y, s, s, PAL.lotDark, alpha);
      if (h > 0.14) {
        drawIsoBox(g, x + 0.04, y + 0.04, s * 0.72, s * 0.72, 0, Math.min(0.42, h * 0.55), PAL.concrete, PAL.concreteDark, PAL.concrete, Math.min(0.85, 0.35 + h));
      }
    }
  }
}

function drawDebris(g: Graphics, r: Rubble): void {
  const rng = new Rng(r.seed);
  const cols = cellColors(r.material, true);
  const z0 = r.elev;
  const h = Math.max(0.05, r.thickness);
  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w * 1.08, r.d * 1.08, 0, 0.02, PAL.shadow, PAL.shadow, PAL.shadow, 0.26);

  if (r.shape === "beam") {
    drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w, r.d, z0, h, cols.top, cols.left, cols.right, 1);
    if (rng.next() > 0.4) {
      const t = rng.range(-0.22, 0.22);
      const fx = Math.cos(r.heading);
      const fy = Math.sin(r.heading);
      drawOrientedIsoBox(
        g,
        r.x + fx * t * r.w,
        r.y + fy * t * r.w,
        r.heading + rng.range(-0.25, 0.25),
        r.w * 0.35,
        r.d * 0.7,
        z0 + h * 0.15,
        h * 0.45,
        cols.top,
        cols.left,
        cols.right,
        1,
      );
    }
    return;
  }

  if (r.shape === "panel") {
    const fold = rng.range(-0.35, 0.35);
    const fx = Math.cos(r.heading);
    const fy = Math.sin(r.heading);
    const rx = -fy;
    const ry = fx;
    drawOrientedIsoBox(g, r.x + rx * r.d * 0.18, r.y + ry * r.d * 0.18, r.heading + fold, r.w * 0.72, r.d * 0.7, z0, h, cols.top, cols.left, cols.right, 1);
    drawOrientedIsoBox(g, r.x - rx * r.d * 0.16, r.y - ry * r.d * 0.16, r.heading - fold * 0.8, r.w * 0.55, r.d * 0.55, z0 + h * 0.2, h * 0.7, cols.top, cols.left, cols.right, 0.95);
    return;
  }

  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w, r.d, z0, h, cols.top, cols.left, cols.right, 1);
  if (r.layer === "remnant" && rng.next() > 0.35) {
    const ox = rng.range(-0.18, 0.18);
    const oy = rng.range(-0.18, 0.18);
    drawOrientedIsoBox(
      g,
      r.x + ox,
      r.y + oy,
      r.heading + rng.range(-0.4, 0.4),
      r.w * rng.range(0.4, 0.65),
      r.d * rng.range(0.35, 0.6),
      z0 + h * 0.25,
      h * rng.range(0.35, 0.7),
      cols.top,
      cols.left,
      cols.right,
      1,
    );
  }
}

function drawBird(g: Graphics, bird: Bird): void {
  const c = worldToScreen(bird.x, bird.y, bird.z);
  g.poly([c.x, c.y, c.x + 6, c.y - 2, c.x + 2, c.y + 1]);
  g.fill({ color: PAL.bird, alpha: Math.min(1, bird.life) });
}
