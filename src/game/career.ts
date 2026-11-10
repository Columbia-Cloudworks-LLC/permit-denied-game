import { DOZER, POLICE_CRUISE } from './constants';

/**
 * Career economy: the persistent wallet, the four core dozer tracks, Skunkworks attachments and
 * prestige unlocks bought in the Home Yard's Heavy Shop. Kept per browser like county clears.
 *
 * Every dollar figure below is written as the design table states it, calibrated to a $25,000
 * standard county. The live game pays about a fifth of that per county, so `price()` scales each
 * figure by ECONOMY_SCALE: the pacing (what one clear buys, when Skunkworks opens, when the
 * dozer maxes out) matches the design while in-run cash, targets and payouts stay one currency.
 */
export const ECONOMY_SCALE = 0.2;
export const PROFILE_KEY = 'permit_denied_profile_v1';

/** A design-table dollar figure in live game dollars. */
export function price(designDollars: number): number {
  return Math.round(designDollars * ECONOMY_SCALE);
}

export const CORE_TRACKS = ['drivetrain', 'ballast', 'hydraulics', 'salvage'] as const;
export type CoreTrack = (typeof CORE_TRACKS)[number];
export const CORE_MAX_LEVEL = 10;

export type BladeAttachmentId = 'explosive_blade';
export type AuxAttachmentId = 'jato_thrusters' | 'seismic_ripper' | 'wrecking_harpoon';
export type AttachmentId = BladeAttachmentId | AuxAttachmentId;
export type AttachmentTier = 1 | 2 | 3;
export const ATTACHMENT_IDS: readonly AttachmentId[] = ['explosive_blade', 'jato_thrusters', 'seismic_ripper', 'wrecking_harpoon'];

export interface PlayerCareerProfile {
  version: 1;
  walletBalance: number;
  lifetimeEarnedCash: number;
  lifetimeCellsDestroyed: number;
  coreUpgrades: Record<CoreTrack, number>;
  attachments: {
    unlockedTiers: Partial<Record<AttachmentId, AttachmentTier>>;
    equippedBladeSlot: BladeAttachmentId | null;
    equippedAuxSlot: AuxAttachmentId | null;
  };
  cosmetics: {
    unlockedIds: string[];
    activeLiveryId: string;
    yardTier: number;
  };
  wearLevel: number;
}

/** Drivetrain top speed as a share of the fastest road vehicle (police cruise). */
const DRIVETRAIN = [0.45, 0.55, 0.66, 0.78, 0.92, 1.08, 1.24, 1.42, 1.6, 1.8, 2.0] as const;
/** Ballast & Torque: share of pile and mass drag ignored. Capped below 100% so hits still crunch. */
export const BALLAST = [0, 0.22, 0.4, 0.55, 0.68, 0.78, 0.85, 0.9, 0.94, 0.965, 0.98] as const;
export const SALVAGE_MUL = [1, 1.12, 1.25, 1.38, 1.52, 1.68, 1.84, 2.0, 2.16, 2.32, 2.5] as const;
export const COMBO_WINDOW = [0, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7] as const;

/** Which slot each attachment mounts in. Names, prices and blurbs live with the shop. */
export const ATTACHMENT_SLOT: Record<AttachmentId, 'blade' | 'aux'> = {
  explosive_blade: 'blade', jato_thrusters: 'aux', seismic_ripper: 'aux', wrecking_harpoon: 'aux',
};

export const DEFAULT_LIVERY = 'livery:county-yellow';
/** Every prestige unlock id; the shop's catalog (`careerShop.ts`) prices them. */
export const PRESTIGE_IDS = ['livery:hazard', 'livery:black-ops', 'livery:chrome', 'livery:gold', 'yard:1', 'yard:2', 'yard:3'] as const;

export function emptyProfile(): PlayerCareerProfile {
  return {
    version: 1,
    walletBalance: 0,
    lifetimeEarnedCash: 0,
    lifetimeCellsDestroyed: 0,
    coreUpgrades: { drivetrain: 0, ballast: 0, hydraulics: 0, salvage: 0 },
    attachments: { unlockedTiers: {}, equippedBladeSlot: null, equippedAuxSlot: null },
    cosmetics: { unlockedIds: [DEFAULT_LIVERY], activeLiveryId: DEFAULT_LIVERY, yardTier: 0 },
    wearLevel: 0,
  };
}

const wholeDollars = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const level = (value: unknown, max: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0);

/** Accepts anything from storage; a corrupt or foreign record becomes a valid profile. */
export function normalizeProfile(raw: unknown): PlayerCareerProfile {
  const profile = emptyProfile();
  if (!raw || typeof raw !== 'object') return profile;
  const r = raw as Partial<PlayerCareerProfile>;
  if (r.version !== 1) return profile;
  profile.walletBalance = wholeDollars(r.walletBalance);
  profile.lifetimeEarnedCash = wholeDollars(r.lifetimeEarnedCash);
  profile.lifetimeCellsDestroyed = wholeDollars(r.lifetimeCellsDestroyed);
  for (const track of CORE_TRACKS) profile.coreUpgrades[track] = level(r.coreUpgrades?.[track], CORE_MAX_LEVEL);
  for (const id of ATTACHMENT_IDS) {
    const tier = level(r.attachments?.unlockedTiers?.[id], 3);
    if (tier) profile.attachments.unlockedTiers[id] = tier as AttachmentTier;
  }
  const blade = r.attachments?.equippedBladeSlot;
  if (blade === 'explosive_blade' && profile.attachments.unlockedTiers[blade]) profile.attachments.equippedBladeSlot = blade;
  const aux = r.attachments?.equippedAuxSlot;
  if (aux && ATTACHMENT_SLOT[aux] === 'aux' && profile.attachments.unlockedTiers[aux]) profile.attachments.equippedAuxSlot = aux;
  const known = new Set<string>(PRESTIGE_IDS);
  const ids = Array.isArray(r.cosmetics?.unlockedIds) ? r.cosmetics!.unlockedIds.filter((id): id is string => typeof id === 'string' && known.has(id)) : [];
  profile.cosmetics.unlockedIds = [...new Set([DEFAULT_LIVERY, ...ids])];
  const livery = r.cosmetics?.activeLiveryId;
  if (typeof livery === 'string' && profile.cosmetics.unlockedIds.includes(livery)) profile.cosmetics.activeLiveryId = livery;
  profile.cosmetics.yardTier = level(r.cosmetics?.yardTier, 3);
  profile.wearLevel = typeof r.wearLevel === 'number' && Number.isFinite(r.wearLevel) ? Math.max(0, Math.min(1, r.wearLevel)) : 0;
  return profile;
}

export function skunkworksUnlocked(profile: PlayerCareerProfile): boolean {
  return CORE_TRACKS.some(track => profile.coreUpgrades[track] >= 3);
}

/** What the dozer runs with this run: resolved stats plus the equipped attachments. */
export interface DozerLoadout {
  topSpeed: number;
  accel: number;
  turnMul: number;
  bladeWidthMul: number;
  /** Share of pile and mass drag ignored, 0..0.98. */
  resistanceCut: number;
  salvageMul: number;
  comboWindow: number;
  blade: { id: BladeAttachmentId; tier: AttachmentTier } | null;
  aux: { id: AuxAttachmentId; tier: AttachmentTier } | null;
  livery: string;
}

/** Seconds the dozer may take from a standstill to its upgraded top speed. */
const TOP_SPEED_SECONDS = 2.2;

export function drivetrainTopSpeed(levelIndex: number): number {
  // Level 0 keeps the stock machine; the table only ever raises it.
  return Math.max(DOZER.maxSpeed, DRIVETRAIN[level(levelIndex, CORE_MAX_LEVEL)]! * POLICE_CRUISE);
}

export function careerLoadout(profile: PlayerCareerProfile): DozerLoadout {
  const { drivetrain, ballast, hydraulics, salvage } = profile.coreUpgrades;
  const topSpeed = drivetrainTopSpeed(drivetrain);
  const bladeId = profile.attachments.equippedBladeSlot;
  const auxId = profile.attachments.equippedAuxSlot;
  const bladeTier = bladeId ? profile.attachments.unlockedTiers[bladeId] : undefined;
  const auxTier = auxId ? profile.attachments.unlockedTiers[auxId] : undefined;
  return {
    topSpeed,
    accel: Math.max(DOZER.accel, topSpeed / TOP_SPEED_SECONDS),
    turnMul: 1 + 0.12 * hydraulics,
    bladeWidthMul: 1 + 0.04 * hydraulics,
    resistanceCut: BALLAST[ballast]!,
    salvageMul: SALVAGE_MUL[salvage]!,
    comboWindow: COMBO_WINDOW[salvage]!,
    blade: bladeId && bladeTier ? { id: bladeId, tier: bladeTier } : null,
    aux: auxId && auxTier ? { id: auxId, tier: auxTier } : null,
    livery: profile.cosmetics.activeLiveryId,
  };
}

export const STOCK_LOADOUT: DozerLoadout = careerLoadout(emptyProfile());

/** Live combo on top of Salvage Magnetics: +0.01× per 10 cells chained, capped at +0.50×. */
export class SalvageCombo {
  timer = 0;
  cells = 0;

  /** Cells destroyed this step; refreshes the window when Salvage is installed. */
  hit(count: number, window: number): void {
    if (count <= 0 || window <= 0) return;
    this.cells += count;
    this.timer = window;
  }

  step(dt: number): void {
    if (this.timer <= 0) return;
    this.timer = Math.max(0, this.timer - dt);
    if (this.timer === 0) this.cells = 0;
  }

  bonus(): number {
    return Math.min(0.5, 0.01 * Math.floor(this.cells / 10));
  }

  multiplier(salvageMul: number): number {
    return salvageMul + this.bonus();
  }

  reset(): void {
    this.timer = 0;
    this.cells = 0;
  }
}

export type SettlementOutcome = 'win' | 'fail' | 'bailout';

export interface SettlementInput {
  mode: 'challenge' | 'sandbox';
  outcome: SettlementOutcome;
  escrow: number;
  timeRemaining: number;
  /** True when this county had already been cleared before this run. */
  replay: boolean;
  /** First clear of a capitol (County 7) county. */
  capitolFirstClear: boolean;
}

export interface Settlement {
  payout: number;
  escrow: number;
  timeBonus: number;
  bounty: number;
  rate: number;
  replayMul: number;
  label: string;
}

export const TIME_BONUS_PER_SECOND = price(250);
export const CAPITOL_BOUNTY = price(35000);

export function settleRun(input: SettlementInput): Settlement {
  const escrow = Math.max(0, Math.floor(input.escrow));
  if (input.mode === 'sandbox') {
    return { payout: Math.floor(0.25 * escrow), escrow, timeBonus: 0, bounty: 0, rate: 0.25, replayMul: 1, label: 'Sandbox salvage (25%)' };
  }
  const replayMul = input.replay ? 0.5 : 1;
  if (input.outcome === 'win') {
    const timeBonus = Math.floor(TIME_BONUS_PER_SECOND * Math.max(0, input.timeRemaining));
    const bounty = input.capitolFirstClear ? CAPITOL_BOUNTY : 0;
    const payout = Math.floor((escrow + timeBonus) * replayMul) + bounty;
    return { payout, escrow, timeBonus, bounty, rate: 1, replayMul, label: input.replay ? 'Contract settled (replay ×0.5)' : 'Contract settled' };
  }
  return { payout: Math.floor(0.2 * escrow * replayMul), escrow, timeBonus: 0, bounty: 0, rate: 0.2, replayMul,
    label: input.outcome === 'bailout' ? 'Bailout salvage (20%)' : 'Failed contract salvage (20%)' };
}

export interface CareerStoreBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultBackend(): CareerStoreBackend | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The page's one career record. Storage failures keep the record in memory for this page. */
export class CareerStore {
  profile: PlayerCareerProfile;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly backend: CareerStoreBackend | undefined = defaultBackend()) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(this.backend?.getItem(PROFILE_KEY) ?? 'null');
    } catch {
      raw = null;
    }
    this.profile = normalizeProfile(raw);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(): void {
    try {
      this.backend?.setItem(PROFILE_KEY, JSON.stringify(this.profile));
    } catch {
      // Quota or blocked storage: the in-memory profile still holds this page's progress.
    }
    for (const listener of this.listeners) listener();
  }

  loadout(): DozerLoadout {
    return careerLoadout(this.profile);
  }

  bank(payout: number, cellsDestroyed: number, wear: number): void {
    const dollars = wholeDollars(payout);
    this.profile.walletBalance += dollars;
    this.profile.lifetimeEarnedCash += dollars;
    this.profile.lifetimeCellsDestroyed += wholeDollars(cellsDestroyed);
    this.profile.wearLevel = Math.max(0, Math.min(1, wear));
    this.commit();
  }

  /** Apply a shop transaction and persist it. */
  update(change: (profile: PlayerCareerProfile) => void): void {
    change(this.profile);
    this.commit();
  }

  /** The garage washes off stage grime. */
  wash(): void {
    if (this.profile.wearLevel === 0) return;
    this.profile.wearLevel = 0;
    this.commit();
  }
}

let shared: CareerStore | undefined;

export function sharedCareer(): CareerStore {
  shared ??= new CareerStore();
  return shared;
}
