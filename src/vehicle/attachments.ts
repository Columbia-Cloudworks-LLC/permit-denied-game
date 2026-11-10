import type { AttachmentTier, AuxAttachmentId, DozerLoadout } from '../game/career';
import { POLICE_CRUISE } from '../game/constants';

/**
 * Skunkworks attachment timers and state machines. Pure: the world effects (blasts, pulses,
 * cable tension) live in `src/sim/attachmentEffects.ts`, which reads and advances this state.
 */

export interface ExplosiveTierSpec {
  cooldown: number;
  cellRefund: number;
  vehicleRefund: number;
  window: number;
  radius: number;
  icd: number;
  maxBlasts: number;
  /** Fraction of max hp a blast removes from steel and concrete cells; 1 vaporizes. */
  steel: number;
  concrete: number;
  /** Outward impulse on vehicles in the blast. */
  vehicleImpulse: number;
}

export const EXPLOSIVE_TIERS: Record<AttachmentTier, ExplosiveTierSpec> = {
  1: { cooldown: 22, cellRefund: 0.2, vehicleRefund: 1, window: 4, radius: 3.5, icd: 0.4, maxBlasts: 10, steel: 0.5, concrete: 0.5, vehicleImpulse: 9 },
  2: { cooldown: 18, cellRefund: 0.25, vehicleRefund: 1.25, window: 5, radius: 4.5, icd: 0.35, maxBlasts: 14, steel: 1, concrete: 0.85, vehicleImpulse: 14 },
  3: { cooldown: 14, cellRefund: 0.3, vehicleRefund: 1.5, window: 6.5, radius: 6, icd: 0.28, maxBlasts: 23, steel: 1, concrete: 1, vehicleImpulse: 26 },
};

export const JATO_TIERS: Record<AttachmentTier, { speed: number; burn: number; cooldown: number }> = {
  1: { speed: 2.5 * POLICE_CRUISE, burn: 1.5, cooldown: 18 },
  2: { speed: 2.85 * POLICE_CRUISE, burn: 2, cooldown: 14 },
  3: { speed: 3.2 * POLICE_CRUISE, burn: 2.5, cooldown: 10 },
};
/** Collision mass multiplier and remaining steering authority while the rockets burn. */
export const JATO_HIT_MUL = 5;
export const JATO_TURN = 0.3;

export const RIPPER_TIERS: Record<AttachmentTier, { slow: number; radius: number; crack: number }> = {
  1: { slow: 0.15, radius: 5, crack: 0.35 },
  2: { slow: 0.1, radius: 7, crack: 0.5 },
  3: { slow: 0.05, radius: 9, crack: 0.7 },
};
export const RIPPER_PULSE_SECONDS = 0.5;

export const HARPOON_TIERS: Record<AttachmentTier, { range: number; kiloNewtons: number; cooldown: number }> = {
  1: { range: 18, kiloNewtons: 400, cooldown: 12 },
  2: { range: 24, kiloNewtons: 800, cooldown: 9 },
  3: { range: 30, kiloNewtons: 1200, cooldown: 6 },
};
/** A tether lets go after this long even if the support holds. */
export const HARPOON_MAX_SECONDS = 6;

export type BladeChargeState = 'charging' | 'ready' | 'armed';

export interface ExplosiveBladeState {
  tier: AttachmentTier;
  state: BladeChargeState;
  cooldown: number;
  window: number;
  icd: number;
  blasts: number;
}

export interface AuxState {
  id: AuxAttachmentId;
  tier: AttachmentTier;
  cooldown: number;
  /** JATO burn seconds left. */
  burn: number;
  /** Ripper shank down. */
  deployed: boolean;
  pulse: number;
  /** Distance driven since the last trench mark. */
  trench: number;
  /** Harpoon tether: target key and seconds attached. */
  tether: { buildingId: number; cellIndex: number; rest: number; t: number; x: number; y: number; z: number } | null;
}

export interface AttachmentRig {
  blade: ExplosiveBladeState | null;
  aux: AuxState | null;
  /** Presentation: the HUD and audio read and clear these one-shot cues. */
  cues: AttachmentCue[];
}

export type AttachmentCue = 'blade-ready' | 'blade-armed' | 'blade-rejected' | 'blade-spent' | 'aux-fired' | 'aux-rejected' | 'aux-ready' | 'blast' | 'harpoon-hit' | 'harpoon-snap';

export function createRig(loadout: DozerLoadout): AttachmentRig {
  const blade = loadout.blade
    ? { tier: loadout.blade.tier, state: 'charging' as const, cooldown: EXPLOSIVE_TIERS[loadout.blade.tier].cooldown, window: 0, icd: 0, blasts: 0 }
    : null;
  const aux = loadout.aux
    ? { id: loadout.aux.id, tier: loadout.aux.tier, cooldown: 0, burn: 0, deployed: false, pulse: 0, trench: 0, tether: null }
    : null;
  return { blade, aux, cues: [] };
}

/** Q: arm the charged blade. Only with the blade down; otherwise a buzzer and the indicator flash. */
export function pressBladeAbility(rig: AttachmentRig, bladeDown: boolean): void {
  const b = rig.blade;
  if (!b || b.state !== 'ready') return;
  if (!bladeDown) {
    rig.cues.push('blade-rejected');
    return;
  }
  const spec = EXPLOSIVE_TIERS[b.tier];
  b.state = 'armed';
  b.window = spec.window;
  b.icd = 0;
  b.blasts = 0;
  rig.cues.push('blade-armed');
}

/** Shift: fire JATO, toggle the ripper, or fire / release the harpoon. Harpoon targeting is the sim's job. */
export function pressAuxAbility(rig: AttachmentRig): 'jato' | 'ripper' | 'harpoon-fire' | 'harpoon-release' | null {
  const a = rig.aux;
  if (!a) return null;
  if (a.id === 'seismic_ripper') {
    a.deployed = !a.deployed;
    a.pulse = 0;
    rig.cues.push('aux-fired');
    return 'ripper';
  }
  if (a.id === 'wrecking_harpoon' && a.tether) {
    releaseHarpoon(rig);
    return 'harpoon-release';
  }
  if (a.cooldown > 0 || a.burn > 0) {
    rig.cues.push('aux-rejected');
    return null;
  }
  if (a.id === 'jato_thrusters') {
    a.burn = JATO_TIERS[a.tier].burn;
    rig.cues.push('aux-fired');
    return 'jato';
  }
  return 'harpoon-fire';
}

export function releaseHarpoon(rig: AttachmentRig): void {
  const a = rig.aux;
  if (!a?.tether) return;
  a.tether = null;
  a.cooldown = HARPOON_TIERS[a.tier].cooldown;
}

export interface RigStepInput {
  cellsDestroyed: number;
  vehiclesWrecked: number;
}

/** Advance passive timers. Blasts, pulses and tension are applied by the sim before this runs. */
export function stepRig(rig: AttachmentRig, dt: number, input: RigStepInput): void {
  const b = rig.blade;
  if (b) {
    const spec = EXPLOSIVE_TIERS[b.tier];
    if (b.state === 'charging') {
      b.cooldown -= dt + input.cellsDestroyed * spec.cellRefund + input.vehiclesWrecked * spec.vehicleRefund;
      if (b.cooldown <= 0) {
        b.cooldown = 0;
        b.state = 'ready';
        rig.cues.push('blade-ready');
      }
    } else if (b.state === 'armed') {
      // The burn runs whether or not the blade stays down.
      b.window -= dt;
      b.icd = Math.max(0, b.icd - dt);
      if (b.window <= 0) {
        b.state = 'charging';
        b.cooldown = spec.cooldown;
        b.window = 0;
        rig.cues.push('blade-spent');
      }
    }
  }
  const a = rig.aux;
  if (!a) return;
  if (a.burn > 0) {
    a.burn = Math.max(0, a.burn - dt);
    if (a.burn === 0) a.cooldown = JATO_TIERS[a.tier].cooldown;
  } else if (a.cooldown > 0 && !a.tether) {
    a.cooldown = Math.max(0, a.cooldown - dt);
    if (a.cooldown === 0) rig.cues.push('aux-ready');
  }
}

/** True when the armed blade may detonate this step. */
export function blastReady(rig: AttachmentRig, bladeDown: boolean): boolean {
  const b = rig.blade;
  return !!b && b.state === 'armed' && bladeDown && b.icd <= 0 && b.blasts < EXPLOSIVE_TIERS[b.tier].maxBlasts;
}

export function spendBlast(rig: AttachmentRig): void {
  const b = rig.blade!;
  b.icd = EXPLOSIVE_TIERS[b.tier].icd;
  b.blasts += 1;
  rig.cues.push('blast');
}

/** HUD readout for each slot: label, 0..1 fill, and a status word. */
export interface RigReadout {
  blade?: { label: string; fill: number; status: 'CHARGING' | 'READY' | 'ARMED' };
  aux?: { label: string; fill: number; status: string };
}

const TIER_NAME = ['', 'Mk I', 'Mk II', 'Mk III'] as const;

export function rigReadout(rig: AttachmentRig): RigReadout {
  const out: RigReadout = {};
  const b = rig.blade;
  if (b) {
    const spec = EXPLOSIVE_TIERS[b.tier];
    out.blade = {
      label: `CHARGE ${TIER_NAME[b.tier]}`,
      fill: b.state === 'charging' ? 1 - b.cooldown / spec.cooldown : b.state === 'armed' ? b.window / spec.window : 1,
      status: b.state === 'charging' ? 'CHARGING' : b.state === 'ready' ? 'READY' : 'ARMED',
    };
  }
  const a = rig.aux;
  if (a) {
    const name = a.id === 'jato_thrusters' ? 'JATO' : a.id === 'seismic_ripper' ? 'RIPPER' : 'HARPOON';
    let fill = 1, status = 'READY';
    if (a.id === 'seismic_ripper') status = a.deployed ? 'DOWN' : 'UP';
    else if (a.burn > 0) { fill = a.burn / JATO_TIERS[a.tier].burn; status = 'BURN'; }
    else if (a.tether) { fill = 1 - a.tether.t / HARPOON_MAX_SECONDS; status = 'TAUT'; }
    else if (a.cooldown > 0) {
      const total = a.id === 'jato_thrusters' ? JATO_TIERS[a.tier].cooldown : HARPOON_TIERS[a.tier].cooldown;
      fill = 1 - a.cooldown / total;
      status = 'RELOAD';
    }
    out.aux = { label: `${name} ${TIER_NAME[a.tier]}`, fill, status };
  }
  return out;
}
