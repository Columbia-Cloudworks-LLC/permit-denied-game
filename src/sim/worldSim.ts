import { DOZER } from "../game/constants";
import { clamp, len } from "../game/math";
import { ParticlePool, debrisKind } from "../fx/particles";
import {
  applyCellDamage,
  buildingBonus,
  footprintSolid,
  stepStructures,
} from "../structure/building";
import { cellPresent, cellWorldBox, type Building, type Cell, type WorldEvent } from "../structure/types";
import { bladePoints, clampDozer, dozerSpeed, resolveCircleSolid, type Dozer } from "../vehicle/dozer";
import { addRubble, type Town } from "../world/town";
import { SpatialHash } from "./spatial";

export interface Upgrades {
  blade: number;
  engine: number;
  push: number;
}

export interface SimFrame {
  cash: number;
  score: number;
  events: WorldEvent[];
  birds: { x: number; y: number }[];
}

interface SolidRef {
  kind: "cell" | "prop" | "rubble";
  building?: Building;
  cell?: Cell;
  propId?: number;
  rubbleId?: number;
  x: number;
  y: number;
  w: number;
  d: number;
}

const nearby: SolidRef[] = [];
const hash = new SpatialHash<SolidRef>(2.4);

function rebuildHash(town: Town): void {
  hash.clear();
  for (const b of town.buildings) {
    for (let gx = 0; gx < b.w; gx++) {
      for (let gy = 0; gy < b.d; gy++) {
        if (!footprintSolid(b, gx, gy)) continue;
        const cell = b.grid[0]![gx]![gy]!;
        const box = cellWorldBox(b, cell);
        const ref: SolidRef = { kind: "cell", building: b, cell, ...box };
        hash.insert(box.x, box.y, box.w, box.d, ref);
      }
    }
  }
  for (const p of town.props) {
    if (p.broken) continue;
    const ref: SolidRef = { kind: "prop", propId: p.id, x: p.x, y: p.y, w: p.w, d: p.d };
    hash.insert(p.x, p.y, p.w, p.d, ref);
  }
  for (const r of town.rubble) {
    const ref: SolidRef = { kind: "rubble", rubbleId: r.id, x: r.x, y: r.y, w: r.w, d: r.d };
    hash.insert(r.x, r.y, r.w, r.d, ref);
  }
}

export function stepWorld(
  town: Town,
  dozer: Dozer,
  particles: ParticlePool,
  upgrades: Upgrades,
  dt: number,
): SimFrame {
  const events: WorldEvent[] = [];
  const birds: { x: number; y: number }[] = [];
  let cash = 0;
  let score = 0;

  rebuildHash(town);
  hash.query(dozer.x - 3, dozer.y - 3, 6, 6, nearby);

  const bladeMul = 1 + upgrades.blade * 0.42;
  const grind = (dozer.bladeDown ? DOZER.grindDps * (0.65 + (dozer.pushT > 0 ? DOZER.pushGrind : 1)) : DOZER.grindDps * 0.45) * bladeMul;
  const speed = dozerSpeed(dozer);
  const pts = bladePoints(dozer);

  const damaged = new Set<Cell>();

  for (const ref of nearby) {
    if (ref.kind === "cell" && ref.building && ref.cell) {
      const impact = resolveCircleSolid(dozer, ref.x, ref.y, ref.w, ref.d, 0.08);
      if (impact > 0.4) {
        dozer.heat += impact * DOZER.heatImpact * 0.08;
        dozer.track += impact * 0.35;
        if (impact > 1.6) {
          events.push({
            kind: "impact",
            x: dozer.x,
            y: dozer.y,
            z: 0.6,
            mag: Math.min(2.2, impact * 0.35),
          });
        }
        const amt = impact * DOZER.ramScale * 0.35 * bladeMul;
        cash += applyCellDamage(ref.building, ref.cell, amt, dozer.x - (ref.x + ref.w / 2), dozer.y - (ref.y + ref.d / 2), particles, events);
        damaged.add(ref.cell);
      }
    } else if (ref.kind === "prop") {
      const p = town.props.find((x) => x.id === ref.propId);
      if (!p || p.broken) continue;
      const impact = resolveCircleSolid(dozer, p.x, p.y, p.w, p.d, 0.05);
      if (impact > 0.25) {
        p.hp -= impact * 6;
        if (p.kind === "light" && speed > 5.5) dozer.track += DOZER.trackPole * 0.25;
      }
    } else if (ref.kind === "rubble") {
      const r = town.rubble.find((x) => x.id === ref.rubbleId);
      if (!r) continue;
      const impact = resolveCircleSolid(dozer, r.x, r.y, r.w, r.d, 0.02);
      if (impact > 0) {
        const nx = dozer.x - (r.x + r.w / 2);
        const ny = dozer.y - (r.y + r.d / 2);
        const l = len(nx, ny) || 1;
        r.vx -= (nx / l) * impact * 2.2;
        r.vy -= (ny / l) * impact * 2.2;
        dozer.vx *= 0.92;
        dozer.vy *= 0.92;
        if (speed > 5.5) {
          r.hp -= 8 * dt + impact;
          r.z = Math.max(0.12, r.z - 0.4 * dt);
        }
      }
    }
  }

  for (const pt of pts) {
    hash.query(pt.x - 0.2, pt.y - 0.2, 0.4, 0.4, nearby);
    for (const ref of nearby) {
      if (pt.x < ref.x || pt.y < ref.y || pt.x > ref.x + ref.w || pt.y > ref.y + ref.d) continue;
      if (ref.kind === "cell" && ref.building && ref.cell) {
        if (damaged.has(ref.cell) && !dozer.bladeDown) continue;
        const fx = Math.cos(dozer.heading);
        const fy = Math.sin(dozer.heading);
        const toCx = ref.x + ref.w / 2 - dozer.x;
        const toCy = ref.y + ref.d / 2 - dozer.y;
        const ang = Math.max(0.35, (fx * toCx + fy * toCy) / (len(toCx, toCy) || 1));
        const ram = speed * DOZER.ramScale * ang * bladeMul * dt;
        const g = grind * dt * ang;
        const amt = ram + g;
        const gained = applyCellDamage(ref.building, ref.cell, amt, fx, fy, particles, events);
        cash += gained;
        if (amt > 0.15) {
          dozer.heat += DOZER.heatGrind * dt * (dozer.bladeDown ? 1 : 0.35);
          if (speed > 3) {
            dozer.vx *= 1 - 0.55 * dt;
            dozer.vy *= 1 - 0.55 * dt;
          }
        }
      } else if (ref.kind === "prop") {
        const p = town.props.find((x) => x.id === ref.propId);
        if (!p || p.broken) continue;
        p.hp -= (8 + speed * 4) * bladeMul * dt;
      }
    }
  }

  for (const p of town.props) {
    if (p.broken || p.hp > 0) continue;
    p.broken = true;
    p.hp = 0;
    particles.burst(debrisKind(p.material), p.x + p.w / 2, p.y + p.d / 2, 0.8, 1);
    let pay = 8;
    if (p.kind === "car") pay = 28;
    if (p.kind === "dumpster") pay = 16;
    if (p.kind === "light") {
      pay = 12;
      dozer.track += speed > 6 ? DOZER.trackPole : 10;
    }
    if (p.kind === "camera") {
      pay = 40;
      birds.push({ x: p.x, y: p.y });
      events.push({ kind: "bird", x: p.x, y: p.y, z: 2.2, mag: 0.4, cash: pay });
    } else {
      events.push({ kind: "snap", x: p.x, y: p.y, z: 0.8, mag: 0.5, cash: pay });
    }
    cash += pay;
    score += pay;
    addRubble(town, p.x, p.y, Math.max(0.4, p.w * 0.8), Math.max(0.35, p.d * 0.8), p.material);
  }

  for (const r of town.rubble) {
    r.vx *= 1 - 3.5 * dt;
    r.vy *= 1 - 3.5 * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.x = clamp(r.x, town.minX, town.maxX - r.w);
    r.y = clamp(r.y, town.minY, town.maxY - r.d);
    if (r.hp <= 0) r.z = Math.min(r.z, 0.12);
  }

  const struct = stepStructures(town.buildings, dt, particles, events);
  cash += struct.cash;
  for (const spawn of struct.rubbleSpawns) {
    addRubble(town, spawn.x, spawn.y, spawn.w, spawn.d, spawn.material);
  }

  for (const lean of struct.leans) {
    for (const other of town.buildings) {
      const right = other.x + other.w * other.cellSize;
      const bot = other.y + other.d * other.cellSize;
      const qx = clamp(lean.x, other.x, right);
      const qy = clamp(lean.y, other.y, bot);
      const dist = len(lean.x - qx, lean.y - qy);
      if (dist > 3.1) continue;
      const toX = (other.x + right) / 2 - lean.x;
      const toY = (other.y + bot) / 2 - lean.y;
      const toward = lean.dx * toX + lean.dy * toY;
      if (toward < -0.4 && dist > 1.4) continue;
      const gx = Math.floor((qx - other.x) / other.cellSize);
      const gy = Math.floor((qy - other.y) / other.cellSize);
      for (const [ox, oy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const cell = other.grid[0]?.[gx + ox]?.[gy + oy];
        if (!cell || !cellPresent(cell)) continue;
        cash += applyCellDamage(other, cell, Math.max(24, lean.mag * 0.85), lean.dx, lean.dy, particles, events);
        const above = other.grid[1]?.[gx + ox]?.[gy + oy];
        if (above && cellPresent(above)) {
          cash += applyCellDamage(other, above, Math.max(16, lean.mag * 0.5), lean.dx, lean.dy, particles, events);
        }
      }
    }
  }

  for (const b of town.buildings) {
    if (b.fullyDown && !b.collapseBonusPaid) {
      b.collapseBonusPaid = true;
      const bonus = buildingBonus(b);
      cash += bonus;
      score += bonus;
      events.push({
        kind: "cash",
        x: b.x + (b.w * b.cellSize) / 2,
        y: b.y + (b.d * b.cellSize) / 2,
        z: 2,
        mag: 2.2,
        cash: bonus,
      });
    }
  }

  clampDozer(dozer, town.minX + 0.8, town.minY + 0.8, town.maxX - 0.8, town.maxY - 0.8);
  particles.step(dt);

  for (const e of events) {
    score += e.cash ?? 0;
  }

  return { cash, score, events, birds };
}
