import type { CoreImpact } from '../structure/coreCollapse';
import type { Material, WorldEvent } from '../structure/types';
import type { Town } from '../world/town';
import type { Dozer } from '../vehicle/dozer';
import type { ParticlePool } from '../fx/particles';

/** Bounded aggregate pulses. No rigid bodies are allocated by a tower collapse. */
export function applyCoreImpact(town: Town, dozer: Dozer, particles: ParticlePool, impact: CoreImpact, events: WorldEvent[]): void {
  const b = impact.building, cx = b.x + b.w * b.cellSize / 2, cy = b.y + b.d * b.cellSize / 2;
  const progress = (impact.pulse + 1) / b.floors;
  const radius = Math.max(b.w, b.d) * b.cellSize * (.48 + .35 * progress);
  const owner = town.debrisOwnerAt?.(cx, cy);
  // Fixed 256 samples distribute each material into a widening, center-heavy mound.
  // The pile's own 3x3 kernel smooths samples; ownership follows the source building.
  for (const [material, mass] of Object.entries(impact.mass)) for (let i = 0; i < 256; i++) {
    const angle = i * 2.399963229728653 + impact.pulse * .37;
    const r = radius * Math.pow((i + .5) / 256, .72);
    town.pile.addMass(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, mass / 256, material as Material, owner);
  }
  particles.radialDust(cx, cy, radius * .72, 24, owner);
  const dx = dozer.x - cx, dy = dozer.y - cy, distance = Math.hypot(dx, dy);
  const strength = Math.max(0, 1 - distance / (radius + 5));
  if (strength > 0) {
    dozer.vx += (distance > .01 ? dx / distance : 0) * strength * 2;
    dozer.vy += (distance > .01 ? dy / distance : 1) * strength * 2;
    dozer.track = Math.min(100, dozer.track + strength * 3);
    dozer.lastImpact = .3;
  }
  if (impact.pulse % 3 === 0) events.push({ kind: 'collapse', x: cx, y: cy, z: 0, mag: .3 + strength * 1.7 });
}
