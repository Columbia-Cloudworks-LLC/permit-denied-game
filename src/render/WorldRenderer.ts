import { Container, Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import { Rng } from "../game/rng";
import { depthKey, screenAabbVisible, worldBoundsToScreen, worldToScreen } from "../world/iso";
import type { ParticlePool } from "../fx/particles";
import type { Building, Cell, GroundMark, Particle, Prop, Rubble } from "../structure/types";
import { cellPresent } from "../structure/types";
import type { Dozer } from "../vehicle/dozer";
import type { Town } from "../world/town";
import type { Bird } from "../structure/types";
import { cellColors, drawFaceWindow, drawGroundPoly, drawIsoBox, drawOrientedIsoBox, drawShadow, PAL } from "./drawIso";
import { drawCar, drawDozer, drawRoadVehicle } from "./vehicles";

interface Cmd {
  depth: number;
  run: (g: Graphics) => void;
}

export class WorldRenderer {
  readonly root = new Container();
  private readonly ground = new Graphics();
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
  stats = { total: 0, visible: 0 };

  constructor() {
    this.root.addChild(this.ground, this.overlay, this.world);
    this.root.sortableChildren = false;
  }

  invalidate(): void {
    this.groundKey = "";
    this.overlayKey = "";
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

    const gKey = `${town.district}:${town.seed}:${town.lots.length}:${town.roads.length}`;
    if (gKey !== this.groundKey) {
      this.ground.clear();
      for (const lot of town.lots) {
        drawGroundPoly(this.ground, lot.x, lot.y, lot.w, lot.d, PAL.lot);
        const speckle = Math.min(90, Math.max(12, Math.floor((lot.w * lot.d) / 14)));
        for (let i = 0; i < speckle; i++) {
          const gx = lot.x + ((i * 17) % 97) * 0.38;
          const gy = lot.y + ((i * 29) % 89) * 0.36;
          if (gx > lot.x + lot.w || gy > lot.y + lot.d) continue;
          drawGroundPoly(this.ground, gx, gy, 0.35, 0.28, PAL.lotDark, 0.22);
        }
      }
      for (const road of town.roads) {
        drawGroundPoly(this.ground, road.x, road.y, road.w, road.d, PAL.asphalt);
        if (road.w > road.d) {
          for (let x = road.x + 1; x < road.x + road.w - 1; x += 2.2) {
            drawGroundPoly(this.ground, x, road.y + road.d * 0.46, 1.1, 0.12, PAL.asphaltLine, 0.7);
          }
        } else {
          for (let y = road.y + 1; y < road.y + road.d - 1; y += 2.2) {
            drawGroundPoly(this.ground, road.x + road.w * 0.46, y, 0.12, 1.1, PAL.asphaltLine, 0.7);
          }
        }
      }
      this.groundKey = gKey;
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

    for (const b of town.buildings) {
      const bw = b.w * b.cellSize;
      const bd = b.d * b.cellSize;
      const z1 = b.floors * FLOOR_Z + 0.8;
      const fall = 1.4;
      total += b.cells.length;
      if (!this.visibleBox(b.x - fall, b.y - fall, bw + fall * 2, bd + fall * 2, -0.4, z1)) continue;
      const fade = occludes(b, occludeX, occludeY) ? 0.38 : 1;
      for (const cell of b.cells) {
        if (cell.state === "gone") continue;
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
          run: (g) => drawCell(g, b, cell, fade),
        });
      }
    }

    for (const p of town.props) {
      if (p.broken) continue;
      total++;
      if (!this.visibleBox(p.x, p.y, p.w, p.d, 0, 2.7)) continue;
      visible++;
      this.cmds.push({
        depth: depthKey(p.x + p.w / 2, p.y + p.d / 2, 0.4),
        run: (g) => drawProp(g, p),
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
    this.stats = { total, visible };
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

function drawCell(g: Graphics, b: Building, cell: Cell, alpha: number): void {
  const cs = b.cellSize;
  let x = b.x + cell.gx * cs + cell.fallDx * cell.fallT * 0.85;
  let y = b.y + cell.gy * cs + cell.fallDy * cell.fallT * 0.85;
  const z0 = cell.floor * FLOOR_Z - cell.sag * 0.55 - cell.fallT * 1.6;
  const h = FLOOR_Z * 0.92;
  const cols = cellColors(cell.material, cell.state !== "intact");

  drawShadow(g, x, y, cs, cs, 0.18 * alpha);

  if (cell.state === "breached" || cell.state === "falling") {
    drawIsoBox(g, x + cs * 0.08, y + cs * 0.08, cs * 0.84, cs * 0.84, z0, h * 0.55, PAL.interior, PAL.interior, PAL.interior, alpha);
    drawIsoBox(g, x, y, cs * 0.22, cs, z0, h * 0.7, cols.top, cols.left, cols.right, alpha);
    drawIsoBox(g, x + cs * 0.78, y, cs * 0.22, cs, z0, h * 0.65, cols.top, cols.left, cols.right, alpha);
    if (cell.state === "falling") {
      drawIsoBox(g, x + 0.1, y + 0.1, cs * 0.5, cs * 0.4, z0 + h * 0.2, h * 0.25, cols.top, cols.left, cols.right, alpha * 0.85);
    }
    return;
  }

  drawIsoBox(g, x, y, cs, cs, z0, h, cols.top, cols.left, cols.right, alpha);
  if (cell.material === "brick") {
    drawFaceWindow(g, x + cs, y, x + cs, y + cs, z0, z0 + h, 0, 1, 0.46, 0.54, cols.left, alpha * 0.35);
    drawFaceWindow(g, x, y + cs, x + cs, y + cs, z0, z0 + h, 0, 1, 0.46, 0.54, cols.left, alpha * 0.28);
  }

  const glass = cell.state === "cracked" ? PAL.glass : PAL.glassLit;
  if (cell.windowE) {
    drawFaceWindow(g, x + cs, y, x + cs, y + cs, z0, z0 + h, 0.28, 0.72, 0.28, 0.72, glass, alpha);
  }
  if (cell.windowS) {
    drawFaceWindow(g, x, y + cs, x + cs, y + cs, z0, z0 + h, 0.28, 0.72, 0.28, 0.72, glass, alpha);
  }
  if (cell.doorS) {
    drawFaceWindow(g, x, y + cs, x + cs, y + cs, z0, z0 + h, 0.32, 0.68, 0.0, 0.55, PAL.woodDark, alpha);
  }
  if (cell.loadingS) {
    drawFaceWindow(g, x, y + cs, x + cs, y + cs, z0, z0 + h, 0.12, 0.88, 0.0, 0.78, PAL.metalDark, alpha);
  }
  if (cell.state === "cracked") {
    drawFaceWindow(g, x + cs, y, x + cs, y + cs, z0, z0 + h, 0.45, 0.52, 0.05, 0.9, PAL.crack, alpha * 0.7);
    drawFaceWindow(g, x, y + cs, x + cs, y + cs, z0, z0 + h, 0.2, 0.28, 0.1, 0.85, PAL.crack, alpha * 0.55);
  }

  const topFloor = cell.floor === b.floors - 1 && cellPresent(cell);
  if (topFloor) {
    if (b.roof === "flat") {
      drawIsoBox(g, x - 0.04, y - 0.04, cs + 0.08, cs + 0.08, z0 + h, 0.18, PAL.metalDark, PAL.metalDark, PAL.metal, alpha);
    } else if (b.roof === "shed") {
      drawIsoBox(g, x - 0.02, y - 0.02, cs + 0.04, cs + 0.04, z0 + h, 0.28 + cell.gy * 0.06, PAL.metal, PAL.metalDark, PAL.metal, alpha);
    } else {
      drawIsoBox(g, x + cs * 0.12, y + cs * 0.12, cs * 0.76, cs * 0.76, z0 + h, 0.42, PAL.woodDark, PAL.woodDark, PAL.wood, alpha);
    }
  }
}

function drawProp(g: Graphics, p: Prop): void {
  drawShadow(g, p.x, p.y, p.w, p.d, 0.2);
  if (p.kind === "fence" || p.kind === "barricade") {
    drawIsoBox(g, p.x, p.y, p.w, p.d, 0, 0.85, PAL.fence, 0x8a6a28, 0xb48a3a, 1);
    return;
  }
  if (p.kind === "light") {
    drawIsoBox(g, p.x, p.y, p.w, p.d, 0, 2.6, PAL.metalTop, PAL.metalDark, PAL.metal, 1);
    drawIsoBox(g, p.x - 0.12, p.y - 0.12, p.w + 0.24, p.d + 0.24, 2.5, 0.2, PAL.asphaltLine, PAL.asphaltLine, PAL.asphaltLine, 1);
    return;
  }
  if (p.kind === "camera") {
    drawIsoBox(g, p.x, p.y, p.w, p.d, 0, 2.1, PAL.metalTop, PAL.metalDark, PAL.metal, 1);
    drawIsoBox(g, p.x - 0.08, p.y + 0.02, 0.42, 0.22, 1.9, 0.22, 0x222222, 0x111111, 0x333333, 1);
    return;
  }
  if (p.kind === "dumpster") {
    drawIsoBox(g, p.x, p.y, p.w, p.d, 0, 0.7, PAL.dumpster, 0x244a22, 0x4a8844, 1);
    return;
  }
  if (p.kind === "car") {
    drawCar(g, p);
    return;
  }
  drawIsoBox(g, p.x, p.y, p.w, p.d, 0, 0.55, PAL.car, 0x243850, 0x4a74a4, 1);
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
