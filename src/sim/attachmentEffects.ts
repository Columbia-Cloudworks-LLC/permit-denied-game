import { DEBRIS, DOZER } from '../game/constants';
import type { ParticlePool } from '../fx/particles';
import { applyCellDamage } from '../structure/building';
import { cellCenter, cellPresent, type Building, type Cell, type WorldEvent } from '../structure/types';
import {
  EXPLOSIVE_TIERS,
  HARPOON_MAX_SECONDS,
  HARPOON_TIERS,
  RIPPER_PULSE_SECONDS,
  RIPPER_TIERS,
  blastReady,
  releaseHarpoon,
  spendBlast,
  type AttachmentRig,
} from '../vehicle/attachments';
import { dozerForward, dozerSpeed, type Dozer } from '../vehicle/dozer';
import { hitVehicle } from '../vehicle/runtime';
import type { Town } from '../world/town';

/**
 * World effects of the Skunkworks attachments: blade-face detonations, ripper shock pulses and
 * trench, and harpoon cable tension. Runs once per fixed step after the world step, and returns
 * the cash its damage paid. Everything here is bounded: a blast touches only cells inside its
 * radius, and the blade's inter-detonation delay caps blasts per second.
 */
export function stepAttachmentEffects(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], rig: AttachmentRig, dt: number): number {
  let cash = 0;
  if (blastReady(rig, dozer.bladeDown) && bladeTouchesTarget(town, dozer)) cash += detonate(town, dozer, particles, events, rig);
  const aux = rig.aux;
  if (aux?.id === 'seismic_ripper' && aux.deployed) cash += rip(town, dozer, particles, events, rig, dt);
  if (aux?.id === 'wrecking_harpoon' && aux.tether) cash += haul(town, dozer, particles, events, rig, dt);
  return cash;
}

function bladeCenter(dozer: Dozer, ahead = 0): { x: number; y: number } {
  const f = dozerForward(dozer);
  const reach = DOZER.bladeReach + 0.12 + ahead;
  return { x: dozer.x + f.x * reach, y: dozer.y + f.y * reach };
}

function buildingsNear(town: Town, x: number, y: number, radius: number): Building[] {
  return town.buildings.filter(b => !b.retired
    && x + radius >= b.x && x - radius <= b.x + b.w * b.cellSize
    && y + radius >= b.y && y - radius <= b.y + b.d * b.cellSize);
}

/** An intact wall or column, a core rubble heap, or a vehicle right at the blade face. */
function bladeTouchesTarget(town: Town, dozer: Dozer): boolean {
  const c = bladeCenter(dozer);
  const reach = DOZER.bladeHalf * (dozer.bladeWidthMul ?? 1) + 0.35;
  for (const b of buildingsNear(town, c.x, c.y, reach)) {
    for (const cell of b.cells) {
      if (cell.floor !== 0 || !cellPresent(cell)) continue;
      const p = cellCenter(b, cell);
      if (Math.hypot(p.x - c.x, p.y - c.y) <= reach) return true;
    }
  }
  if (town.pile.sample(c.x, c.y).mass > 1.2) return true;
  return town.vehicles.some(v => Math.hypot(v.x - c.x, v.y - c.y) < 2.1);
}

const LIGHT = new Set(['wood', 'brick', 'glass']);

function detonate(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], rig: AttachmentRig): number {
  const tier = rig.blade!.tier;
  const spec = EXPLOSIVE_TIERS[tier];
  spendBlast(rig);
  const { x, y } = bladeCenter(dozer, 1);
  const r = spec.radius;
  let cash = 0;
  for (const b of buildingsNear(town, x, y, r)) {
    for (const cell of b.cells) {
      if (!cellPresent(cell)) continue;
      const p = cellCenter(b, cell);
      const dx = p.x - x, dy = p.y - y, dist = Math.hypot(dx, dy);
      // A ground blast reaches the floors it can see; the cascade does the rest.
      if (dist > r || p.z > r + 1) continue;
      cash += applyCellDamage(b, cell, blastDamage(cell, spec), dist > 0.01 ? dx / dist : 0, dist > 0.01 ? dy / dist : 0, particles, events);
    }
  }
  for (const v of town.vehicles) {
    const dx = v.x - x, dy = v.y - y, dist = Math.hypot(dx, dy);
    if (dist > r + 1) continue;
    const nx = dist > 0.01 ? dx / dist : 1, ny = dist > 0.01 ? dy / dist : 0;
    hitVehicle(v, [{ x: v.x - nx, y: v.y - ny, z: 0.5, nx, ny, nz: 0.35, impulse: spec.vehicleImpulse * (1 - 0.5 * dist / (r + 1)), source: `blast:${rig.blade!.blasts}` }]);
  }
  for (const rubble of town.rubble) {
    const dx = rubble.x - x, dy = rubble.y - y, dist = Math.hypot(dx, dy);
    if (dist > r || dist < 0.01) continue;
    const push = (1 - dist / r) * 7 / Math.max(0.5, Math.sqrt(rubble.mass));
    rubble.vx += (dx / dist) * push;
    rubble.vy += (dy / dist) * push;
    rubble.vz += push * 0.6;
    rubble.sleeping = false;
    rubble.sleepT = 0;
  }
  scorch(town, x, y, r * 0.75);
  particles.sparks(x, y, 0, 0, 14 + tier * 6, 3.4);
  particles.radialDust(x, y, r * 0.8, 18 + tier * 4);
  particles.burst('dust', x, y, 0.8, 1.6);
  particles.burst('spark', x, y, 0.9, 1.2);
  events.push({ kind: 'blast', x, y, z: 0.8, mag: 2 + tier * 0.35, dirX: Math.cos(dozer.heading), dirY: Math.sin(dozer.heading) });
  dozer.lastImpact = Math.max(dozer.lastImpact, 0.24);
  return cash;
}

function blastDamage(cell: Cell, spec: (typeof EXPLOSIVE_TIERS)[1]): number {
  const cladding = cell.cladding?.hp ?? 0;
  const share = LIGHT.has(cell.material) ? 1 : cell.material === 'metal' ? spec.steel : spec.concrete;
  // A full share vaporizes the cell through its cladding; a partial share fractures it.
  return share >= 1 ? cell.maxHp * 4 + cladding + 1 : cell.maxHp * share + cladding;
}

function pushMark(town: Town, mark: Town['marks'][number]): void {
  if (town.marks.length >= DEBRIS.cosmeticCap) town.marks.splice(0, 24);
  town.marks.push(mark);
  town.visualRevision++;
}

function scorch(town: Town, x: number, y: number, size: number): void {
  pushMark(town, { x, y, w: size, d: size, heading: (x * 7.3 + y * 3.1) % Math.PI, kind: 'crack', material: 'concrete',
    seed: Math.floor(Math.abs(x * 131 + y * 71)) + 1, alpha: 0.8, tint: 0x16110c, yardOwner: town.debrisOwnerAt?.(x, y) });
}

/** Ripper shank: a trench behind the machine, and a shock pulse that pre-cracks foundations. */
function rip(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], rig: AttachmentRig, dt: number): number {
  const aux = rig.aux!;
  const spec = RIPPER_TIERS[aux.tier];
  const f = dozerForward(dozer);
  const tx = dozer.x - f.x * 1.45, ty = dozer.y - f.y * 1.45;
  aux.trench += dozerSpeed(dozer) * dt;
  if (aux.trench >= 0.35) {
    aux.trench = 0;
    pushMark(town, { x: tx, y: ty, w: 0.55, d: 0.32, heading: dozer.heading, kind: 'scrape', material: 'concrete',
      seed: Math.floor(Math.abs(tx * 97 + ty * 53)) + 1, alpha: 0.92, tint: 0x2a241c, yardOwner: town.debrisOwnerAt?.(tx, ty) });
  }
  aux.pulse += dt;
  if (aux.pulse < RIPPER_PULSE_SECONDS) return 0;
  aux.pulse -= RIPPER_PULSE_SECONDS;
  let cash = 0;
  for (const b of buildingsNear(town, tx, ty, spec.radius)) {
    for (const cell of b.cells) {
      if (cell.floor !== 0 || !cellPresent(cell)) continue;
      const p = cellCenter(b, cell);
      const dx = p.x - tx, dy = p.y - ty, dist = Math.hypot(dx, dy);
      if (dist > spec.radius) continue;
      // Pre-crack to the tier's share of health; the pulse never finishes a cell by itself.
      const cap = cell.maxHp * (1 - spec.crack);
      if (cell.hp <= cap + 0.01) continue;
      cash += applyCellDamage(b, cell, cell.hp - cap, dist > 0.01 ? dx / dist : 0, dist > 0.01 ? dy / dist : 0, particles, events);
    }
  }
  particles.radialDust(tx, ty, spec.radius * 0.5, 10);
  events.push({ kind: 'impact', x: tx, y: ty, z: 0.1, mag: 0.35, dirX: 0, dirY: 1, heft: 1.3 });
  return cash;
}

/** Harpoon: pick the support ahead that the cable reaches; load-bearing members win ties. */
export function fireHarpoon(town: Town, dozer: Dozer, rig: AttachmentRig): boolean {
  const aux = rig.aux;
  if (!aux || aux.id !== 'wrecking_harpoon') return false;
  const range = HARPOON_TIERS[aux.tier].range;
  const f = dozerForward(dozer);
  let best: { b: Building; index: number; dist: number; score: number; x: number; y: number; z: number } | undefined;
  for (const b of buildingsNear(town, dozer.x, dozer.y, range)) {
    b.cells.forEach((cell, index) => {
      if (cell.floor !== 0 || !cellPresent(cell)) return;
      const p = cellCenter(b, cell);
      const dx = p.x - dozer.x, dy = p.y - dozer.y, dist = Math.hypot(dx, dy);
      if (dist > range || dist < 1.5 || (dx * f.x + dy * f.y) / dist < Math.cos(0.7)) return;
      const score = dist * (cell.isSupport ? 0.6 : 1);
      if (!best || score < best.score) best = { b, index, dist, score, ...p };
    });
  }
  if (!best) {
    rig.cues.push('aux-rejected');
    aux.cooldown = 1;
    return false;
  }
  aux.tether = { buildingId: best.b.id, cellIndex: best.index, rest: best.dist, t: 0, x: best.x, y: best.y, z: Math.min(best.z, 1.2) };
  rig.cues.push('harpoon-hit');
  return true;
}

function haul(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], rig: AttachmentRig, dt: number): number {
  const aux = rig.aux!;
  const tether = aux.tether!;
  const spec = HARPOON_TIERS[aux.tier];
  const b = town.buildings.find(building => building.id === tether.buildingId);
  const cell = b?.cells[tether.cellIndex];
  tether.t += dt;
  const dx = dozer.x - tether.x, dy = dozer.y - tether.y, dist = Math.hypot(dx, dy);
  if (!b || !cell || !cellPresent(cell) || tether.t > HARPOON_MAX_SECONDS || dist > spec.range * 1.6) {
    // The support tore out, or the cable let go.
    rig.cues.push('harpoon-snap');
    releaseHarpoon(rig);
    return 0;
  }
  // The winch takes up slack as the dozer closes in.
  if (dist < tether.rest) tether.rest = Math.max(2, dist);
  const stretch = dist - tether.rest;
  if (stretch <= 0) return 0;
  const kN = Math.min(spec.kiloNewtons, stretch * spec.kiloNewtons / 1.2);
  const ux = dx / dist, uy = dy / dist;
  // The cable resists driving away; the machine leans on it rather than snapping straight back.
  const outward = dozer.vx * ux + dozer.vy * uy;
  if (outward > 0) {
    const brake = Math.min(1, (kN / spec.kiloNewtons) * 3 * dt);
    dozer.vx -= ux * outward * brake;
    dozer.vy -= uy * outward * brake;
  }
  const shear = (kN / 400) * 80 * dt;
  let cash = applyCellDamage(b, cell, shear, ux, uy, particles, events);
  for (const other of b.cells) {
    if (other === cell || !cellPresent(other)) continue;
    const near = Math.abs(other.gx - cell.gx) + Math.abs(other.gy - cell.gy);
    if (other.floor === cell.floor + 1 && near === 0) cash += applyCellDamage(b, other, shear * 0.5, ux, uy, particles, events);
    else if (other.floor === cell.floor && near === 1 && other.isSupport) cash += applyCellDamage(b, other, shear * 0.4, ux, uy, particles, events);
  }
  if (kN > spec.kiloNewtons * 0.6 && Math.floor(tether.t * 10) !== Math.floor((tether.t - dt) * 10)) {
    particles.sparks(tether.x, tether.y, -ux * 2, -uy * 2, 3, 1.2);
    events.push({ kind: 'scrape', x: tether.x, y: tether.y, z: 1, mag: 0.4, material: 'metal' });
  }
  return cash;
}
