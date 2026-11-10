import {
  ATTACHMENT_SLOT,
  BALLAST,
  COMBO_WINDOW,
  CORE_MAX_LEVEL,
  DEFAULT_LIVERY,
  SALVAGE_MUL,
  drivetrainTopSpeed,
  price,
  skunkworksUnlocked,
  type AttachmentId,
  type AttachmentTier,
  type AuxAttachmentId,
  type BladeAttachmentId,
  type CareerStore,
  type CoreTrack,
} from './career';

/**
 * The Heavy Shop's catalog and transactions: prices, names, blurbs, and every purchase. Lives in
 * the lazy Home Yard chunk; the startup graph only needs the stat curves in `career.ts`.
 */

/** Design-table prices for levels 1–10 (index 0 is level 1). */
const STANDARD_COSTS = [10000, 14000, 19500, 27500, 38500, 54000, 75500, 105500, 148000, 207000] as const;
const SALVAGE_COSTS = [12000, 18000, 26500, 39000, 57500, 85500, 126500, 187000, 277000, 410000] as const;

export function coreTrackCost(track: CoreTrack, level: number): number | null {
  if (!Number.isInteger(level) || level < 1 || level > CORE_MAX_LEVEL) return null;
  return price((track === 'salvage' ? SALVAGE_COSTS : STANDARD_COSTS)[level - 1]!);
}

export const CORE_TRACK_NAMES: Record<CoreTrack, string> = {
  drivetrain: 'Twin-Turbo Drivetrain',
  ballast: 'Ballast & Torque',
  hydraulics: 'Hydraulic Overdrive',
  salvage: 'Salvage Magnetics',
};

/** One line per level for the shop's stat preview. */
export function coreTrackStat(track: CoreTrack, levelIndex: number): string {
  const l = Math.max(0, Math.min(CORE_MAX_LEVEL, Math.floor(levelIndex)));
  if (track === 'drivetrain') return `${(drivetrainTopSpeed(l) * 3.6).toFixed(0)} km/h top speed`;
  if (track === 'ballast') return `${(BALLAST[l]! * 100).toFixed(1).replace(/\.0$/, '')}% pile & mass drag ignored`;
  if (track === 'hydraulics') return `${(1 + 0.12 * l).toFixed(2)}× turn · +${4 * l}% blade width`;
  return `${SALVAGE_MUL[l]!.toFixed(2)}× cash · ${COMBO_WINDOW[l]!.toFixed(1)} s combo`;
}

export interface AttachmentSpec {
  id: AttachmentId;
  name: string;
  slot: 'blade' | 'aux';
  costs: readonly [number, number, number];
  blurb: string;
}

export const ATTACHMENTS: Record<AttachmentId, AttachmentSpec> = {
  explosive_blade: { id: 'explosive_blade', name: 'Shaped-Charge Blade', slot: 'blade', costs: [65000, 110000, 185000],
    blurb: 'Charges while you wreck. Ready + BLADE DOWN + Q arms a burst of blade-face detonations.' },
  jato_thrusters: { id: 'jato_thrusters', name: 'JATO Thrusters', slot: 'aux', costs: [50000, 85000, 140000],
    blurb: 'Shift lights twin rockets: a short burst far past cruiser speed with five times the hit.' },
  seismic_ripper: { id: 'seismic_ripper', name: 'Seismic Ripper', slot: 'aux', costs: [75000, 120000, 190000],
    blurb: 'Shift drops a rear shank. It trenches the ground and pre-cracks foundations around you.' },
  wrecking_harpoon: { id: 'wrecking_harpoon', name: 'Wrecking Harpoon', slot: 'aux', costs: [90000, 135000, 210000],
    blurb: 'Shift fires a winch cable into the nearest support ahead. Drive away to rip it out.' },
};

export function attachmentCost(id: AttachmentId, tier: AttachmentTier): number {
  return price(ATTACHMENTS[id].costs[tier - 1]);
}

export interface PrestigeItem {
  id: string;
  name: string;
  cost: number;
  kind: 'livery' | 'yard';
  /** Yard tiers are bought in order. */
  yardTier?: number;
  blurb: string;
}

export const PRESTIGE: readonly PrestigeItem[] = [
  { id: 'livery:hazard', name: 'Hazard-Stripe', cost: price(250000), kind: 'livery', blurb: 'Black and yellow chevrons.' },
  { id: 'livery:black-ops', name: 'Black-Ops Matte', cost: price(500000), kind: 'livery', blurb: 'Flat black, no markings.' },
  { id: 'livery:chrome', name: 'Polished Chrome', cost: price(750000), kind: 'livery', blurb: 'Mirror-bright everything.' },
  { id: 'livery:gold', name: '24K Municipal Nightmare Gold', cost: price(1500000), kind: 'livery', blurb: 'The county will hear about this.' },
  { id: 'yard:1', name: 'Range Tier 1', cost: price(300000), kind: 'yard', yardTier: 1, blurb: 'Adds a respawning water tower and grain elevator lane.' },
  { id: 'yard:2', name: 'Range Tier 2', cost: price(750000), kind: 'yard', yardTier: 2, blurb: 'Adds a respawning eight-story office slab pad.' },
  { id: 'yard:3', name: 'Range Tier 3', cost: price(1500000), kind: 'yard', yardTier: 3, blurb: 'Paves the yard into a floodlit concrete mega-depot.' },
];

export const LIVERY_NAMES: Record<string, string> = {
  [DEFAULT_LIVERY]: 'County Yellow',
  ...Object.fromEntries(PRESTIGE.filter(p => p.kind === 'livery').map(p => [p.id, p.name])),
};

export type PurchaseResult = { ok: true } | { ok: false; reason: string };

const OK: PurchaseResult = { ok: true };
const broke: PurchaseResult = { ok: false, reason: 'Not enough banked cash.' };

export function buyCore(store: CareerStore, track: CoreTrack): PurchaseResult {
  const p = store.profile;
  const cost = coreTrackCost(track, p.coreUpgrades[track] + 1);
  if (cost === null) return { ok: false, reason: 'Track maxed out.' };
  if (cost > p.walletBalance) return broke;
  store.update(profile => { profile.walletBalance -= cost; profile.coreUpgrades[track] += 1; });
  return OK;
}

export function buyAttachment(store: CareerStore, id: AttachmentId): PurchaseResult {
  const p = store.profile;
  if (!skunkworksUnlocked(p)) return { ok: false, reason: 'Skunkworks opens when any core track reaches level 3.' };
  const owned = p.attachments.unlockedTiers[id] ?? 0;
  if (owned >= 3) return { ok: false, reason: 'Already Mk III.' };
  const tier = (owned + 1) as AttachmentTier;
  const cost = attachmentCost(id, tier);
  if (cost > p.walletBalance) return broke;
  store.update(profile => {
    profile.walletBalance -= cost;
    profile.attachments.unlockedTiers[id] = tier;
    // A first purchase goes straight onto the machine when its slot is free.
    if (tier !== 1) return;
    if (ATTACHMENT_SLOT[id] === 'blade') profile.attachments.equippedBladeSlot ??= id as BladeAttachmentId;
    else profile.attachments.equippedAuxSlot ??= id as AuxAttachmentId;
  });
  return OK;
}

/** Equip an owned attachment, or pass `null` with a slot to empty it. */
export function equip(store: CareerStore, id: AttachmentId | null, slot: 'blade' | 'aux'): PurchaseResult {
  if (id && !store.profile.attachments.unlockedTiers[id]) return { ok: false, reason: 'Not owned.' };
  if (id && ATTACHMENT_SLOT[id] !== slot) return { ok: false, reason: 'Wrong slot.' };
  store.update(profile => {
    if (slot === 'blade') profile.attachments.equippedBladeSlot = id as BladeAttachmentId | null;
    else profile.attachments.equippedAuxSlot = id as AuxAttachmentId | null;
  });
  return OK;
}

export function buyPrestige(store: CareerStore, id: string): PurchaseResult {
  const p = store.profile;
  const item = PRESTIGE.find(x => x.id === id);
  if (!item) return { ok: false, reason: 'Unknown item.' };
  if (p.cosmetics.unlockedIds.includes(id)) return { ok: false, reason: 'Already owned.' };
  if (item.kind === 'yard' && item.yardTier !== p.cosmetics.yardTier + 1) return { ok: false, reason: 'Buy the previous range tier first.' };
  if (item.cost > p.walletBalance) return broke;
  store.update(profile => {
    profile.walletBalance -= item.cost;
    profile.cosmetics.unlockedIds.push(id);
    if (item.kind === 'yard') profile.cosmetics.yardTier = item.yardTier!;
    else profile.cosmetics.activeLiveryId = id;
  });
  return OK;
}

export function setLivery(store: CareerStore, id: string): PurchaseResult {
  if (!store.profile.cosmetics.unlockedIds.includes(id) || !(id in LIVERY_NAMES)) return { ok: false, reason: 'Not owned.' };
  store.update(profile => { profile.cosmetics.activeLiveryId = id; });
  return OK;
}
