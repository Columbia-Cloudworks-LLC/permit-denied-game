import { Container, Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import { depthKey, worldToScreen } from "../world/iso";
import type { ParticlePool } from "../fx/particles";
import type { Building, Cell, Particle, Prop } from "../structure/types";
import { cellPresent } from "../structure/types";
import type { Dozer } from "../vehicle/dozer";
import type { Town } from "../world/town";
import type { Bird } from "../structure/types";
import { cellColors, drawFaceWindow, drawGroundPoly, drawIsoBox, drawShadow, PAL } from "./drawIso";
import { drawCar, drawDozer } from "./vehicles";

interface Cmd {
  depth: number;
  run: (g: Graphics) => void;
}

export class WorldRenderer {
  readonly root = new Container();
  private readonly ground = new Graphics();
  private readonly world = new Graphics();
  private readonly cmds: Cmd[] = [];
  camX = 0;
  camY = 0;
  zoom = 1.15;

  constructor() {
    this.root.addChild(this.ground, this.world);
    this.root.sortableChildren = false;
  }

  layout(viewW: number, viewH: number, shakeX: number, shakeY: number): void {
    this.root.position.set(viewW / 2 - this.camX + shakeX, viewH / 2 - this.camY + shakeY);
    this.root.scale.set(this.zoom);
  }

  draw(
    town: Town,
    dozer: Dozer,
    particles: ParticlePool,
    birds: Bird[],
    occludeX: number,
    occludeY: number,
  ): void {
    this.ground.clear();
    this.world.clear();
    this.cmds.length = 0;

    for (const lot of town.lots) {
      drawGroundPoly(this.ground, lot.x, lot.y, lot.w, lot.d, PAL.lot);
      for (let i = 0; i < 90; i++) {
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

    for (const b of town.buildings) {
      const fade = occludes(b, occludeX, occludeY) ? 0.38 : 1;
      for (const cell of b.cells) {
        if (cell.state === "gone") continue;
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
      this.cmds.push({
        depth: depthKey(p.x + p.w / 2, p.y + p.d / 2, 0.4),
        run: (g) => drawProp(g, p),
      });
    }

    for (const r of town.rubble) {
      this.cmds.push({
        depth: depthKey(r.x + r.w / 2, r.y + r.d / 2, 0.1),
        run: (g) => {
          drawShadow(g, r.x, r.y, r.w, r.d, 0.22);
          const c = cellColors(r.material, true);
          drawIsoBox(g, r.x, r.y, r.w, r.d, 0, r.z, c.top, c.left, c.right, 1);
        },
      });
    }

    this.cmds.push({
      depth: depthKey(dozer.x, dozer.y, 0.4),
      run: (g) => drawDozer(g, dozer),
    });

    for (const p of particles.items) {
      if (!p.alive) continue;
      this.cmds.push({
        depth: depthKey(p.x, p.y, p.z),
        run: (g) => drawParticle(g, p),
      });
    }

    for (const bird of birds) {
      this.cmds.push({
        depth: depthKey(bird.x, bird.y, bird.z),
        run: (g) => drawBird(g, bird),
      });
    }

    this.cmds.sort((a, b) => a.depth - b.depth);
    for (const cmd of this.cmds) cmd.run(this.world);
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
  const s = worldToScreen(p.x, p.y, 0);
  g.ellipse(s.x, s.y, 3.2, 1.6);
  g.fill({ color: PAL.shadow, alpha: 0.22 * Math.min(1, p.life / p.maxLife) });
  const c = worldToScreen(p.x, p.y, p.z);
  const color =
    p.kind === "wood"
      ? PAL.wood
      : p.kind === "brick"
        ? PAL.brick
        : p.kind === "metal"
          ? PAL.metal
          : p.kind === "glass"
            ? 0xa8c4d0
            : p.kind === "dust"
              ? PAL.dust
              : PAL.concrete;
  const a = p.kind === "dust" ? 0.35 * (p.life / p.maxLife) : 0.9;
  const r = p.kind === "dust" ? 5 + p.size * 10 : 2.2 + p.size * 8;
  g.rect(c.x - r / 2, c.y - r / 2, r, r);
  g.fill({ color, alpha: a });
}

function drawBird(g: Graphics, bird: Bird): void {
  const c = worldToScreen(bird.x, bird.y, bird.z);
  g.poly([c.x, c.y, c.x + 6, c.y - 2, c.x + 2, c.y + 1]);
  g.fill({ color: PAL.bird, alpha: Math.min(1, bird.life) });
}
