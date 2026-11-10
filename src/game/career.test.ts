import { describe, expect, it } from 'vitest';
import {
  CAPITOL_BOUNTY,
  CareerStore,
  ECONOMY_SCALE,
  PROFILE_KEY,
  SalvageCombo,
  STOCK_LOADOUT,
  PRESTIGE_IDS,
  TIME_BONUS_PER_SECOND,
  careerLoadout,
  drivetrainTopSpeed,
  emptyProfile,
  normalizeProfile,
  settleRun,
  skunkworksUnlocked,
  type CareerStoreBackend,
} from './career';
import { DOZER, POLICE_CRUISE } from './constants';
import { PRESTIGE, attachmentCost, buyAttachment, buyCore, buyPrestige, coreTrackCost, equip, setLivery } from './careerShop';

function memory(initial?: string): CareerStoreBackend & { data: Map<string, string> } {
  const data = new Map<string, string>(initial ? [[PROFILE_KEY, initial]] : []);
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('career prices', () => {
  it('scales the design tables: $699,500 per standard track and $1,239,000 for Salvage', () => {
    const levels = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(sum(levels.map(l => coreTrackCost('drivetrain', l)!))).toBe(Math.round(699500 * ECONOMY_SCALE));
    expect(sum(levels.map(l => coreTrackCost('salvage', l)!))).toBe(Math.round(1239000 * ECONOMY_SCALE));
    expect(PRESTIGE.map(p => p.id)).toEqual([...PRESTIGE_IDS]);
    expect(coreTrackCost('ballast', 0)).toBeNull();
    expect(coreTrackCost('ballast', 11)).toBeNull();
  });

  it('prices the Skunkworks path at $1,455,000 design dollars', () => {
    const total = sum((['explosive_blade', 'jato_thrusters', 'seismic_ripper', 'wrecking_harpoon'] as const)
      .flatMap(id => [1, 2, 3].map(tier => attachmentCost(id, tier as 1 | 2 | 3))));
    expect(total).toBe(Math.round(1455000 * ECONOMY_SCALE));
  });
});

describe('career loadout', () => {
  it('keeps the stock dozer at level 0 and reaches twice cruiser speed at level 10', () => {
    expect(STOCK_LOADOUT.topSpeed).toBe(DOZER.maxSpeed);
    expect(STOCK_LOADOUT.accel).toBe(DOZER.accel);
    expect(STOCK_LOADOUT.resistanceCut).toBe(0);
    expect(drivetrainTopSpeed(10)).toBeCloseTo(2 * POLICE_CRUISE);
    for (let l = 1; l <= 10; l++) expect(drivetrainTopSpeed(l)).toBeGreaterThanOrEqual(drivetrainTopSpeed(l - 1));
  });

  it('reaches any upgraded top speed within 2.2 seconds and caps drag cut at 98%', () => {
    const profile = emptyProfile();
    profile.coreUpgrades = { drivetrain: 10, ballast: 10, hydraulics: 10, salvage: 10 };
    const loadout = careerLoadout(profile);
    expect(loadout.topSpeed / loadout.accel).toBeLessThanOrEqual(2.2 + 1e-9);
    expect(loadout.resistanceCut).toBe(0.98);
    expect(loadout.turnMul).toBeCloseTo(2.2);
    expect(loadout.bladeWidthMul).toBeCloseTo(1.4);
    expect(loadout.salvageMul).toBe(2.5);
    expect(loadout.comboWindow).toBe(7);
  });
});

describe('salvage combo', () => {
  it('adds 0.01× per ten chained cells, capped so level 10 pays at most 3.00×', () => {
    const combo = new SalvageCombo();
    combo.hit(9, 7);
    expect(combo.multiplier(2.5)).toBe(2.5);
    combo.hit(1, 7);
    expect(combo.multiplier(2.5)).toBeCloseTo(2.51);
    combo.hit(5000, 7);
    expect(combo.multiplier(2.5)).toBeCloseTo(3);
  });

  it('drops the chain when the window runs out and ignores hits without Salvage', () => {
    const combo = new SalvageCombo();
    combo.hit(40, 2);
    combo.step(1.9);
    expect(combo.cells).toBe(40);
    combo.step(0.2);
    expect(combo.cells).toBe(0);
    combo.hit(40, 0);
    expect(combo.cells).toBe(0);
  });
});

describe('settlement', () => {
  it('pays escrow plus the time bonus on a first clear, halved on a replay', () => {
    const first = settleRun({ mode: 'challenge', outcome: 'win', escrow: 5000, timeRemaining: 30, replay: false, capitolFirstClear: false });
    expect(first.payout).toBe(5000 + 30 * TIME_BONUS_PER_SECOND);
    const replay = settleRun({ mode: 'challenge', outcome: 'win', escrow: 5000, timeRemaining: 30, replay: true, capitolFirstClear: false });
    expect(replay.payout).toBe(Math.floor(first.payout * 0.5));
  });

  it('adds the capitol bounty once, and never halves it', () => {
    const capitol = settleRun({ mode: 'challenge', outcome: 'win', escrow: 1000, timeRemaining: 0, replay: false, capitolFirstClear: true });
    expect(capitol.payout).toBe(1000 + CAPITOL_BOUNTY);
  });

  it('salvages 20% on failure or bailout and 25% in sandbox', () => {
    expect(settleRun({ mode: 'challenge', outcome: 'fail', escrow: 1000, timeRemaining: 40, replay: false, capitolFirstClear: false }).payout).toBe(200);
    expect(settleRun({ mode: 'challenge', outcome: 'bailout', escrow: 1000, timeRemaining: 40, replay: true, capitolFirstClear: false }).payout).toBe(100);
    expect(settleRun({ mode: 'sandbox', outcome: 'bailout', escrow: 1000, timeRemaining: 0, replay: true, capitolFirstClear: false }).payout).toBe(250);
  });
});

describe('career store', () => {
  it('banks payouts, buys levels, and persists under the versioned key', () => {
    const backend = memory();
    const store = new CareerStore(backend);
    store.bank(coreTrackCost('drivetrain', 1)! + 50, 120, 0.4);
    expect(buyCore(store, 'drivetrain')).toEqual({ ok: true });
    expect(buyCore(store, 'drivetrain')).toEqual({ ok: false, reason: 'Not enough banked cash.' });
    const reloaded = new CareerStore(backend);
    expect(reloaded.profile.coreUpgrades.drivetrain).toBe(1);
    expect(reloaded.profile.walletBalance).toBe(50);
    expect(reloaded.profile.lifetimeCellsDestroyed).toBe(120);
    expect(reloaded.profile.wearLevel).toBe(0.4);
    reloaded.wash();
    expect(new CareerStore(backend).profile.wearLevel).toBe(0);
  });

  it('locks Skunkworks until a core track reaches level 3, then auto-equips the first purchase', () => {
    const store = new CareerStore(memory());
    store.bank(10_000_000, 0, 0);
    expect(buyAttachment(store, 'jato_thrusters').ok).toBe(false);
    for (let i = 0; i < 3; i++) buyCore(store, 'ballast');
    expect(skunkworksUnlocked(store.profile)).toBe(true);
    expect(buyAttachment(store, 'jato_thrusters').ok).toBe(true);
    expect(buyAttachment(store, 'seismic_ripper').ok).toBe(true);
    expect(store.profile.attachments.equippedAuxSlot).toBe('jato_thrusters');
    expect(equip(store, 'seismic_ripper', 'aux').ok).toBe(true);
    expect(equip(store, 'seismic_ripper', 'blade').ok).toBe(false);
    expect(store.loadout().aux).toEqual({ id: 'seismic_ripper', tier: 1 });
  });

  it('sells range tiers in order and switches liveries only to owned paint', () => {
    const store = new CareerStore(memory());
    store.bank(10_000_000, 0, 0);
    expect(buyPrestige(store, 'yard:2').ok).toBe(false);
    expect(buyPrestige(store, 'yard:1').ok).toBe(true);
    expect(store.profile.cosmetics.yardTier).toBe(1);
    expect(setLivery(store, 'livery:gold').ok).toBe(false);
    expect(buyPrestige(store, 'livery:gold').ok).toBe(true);
    expect(store.loadout().livery).toBe('livery:gold');
  });

  it('starts clean from corrupt or foreign storage', () => {
    expect(new CareerStore(memory('{not json')).profile).toEqual(emptyProfile());
    const tampered = normalizeProfile({ version: 1, walletBalance: -5, coreUpgrades: { drivetrain: 99 },
      attachments: { unlockedTiers: { explosive_blade: 7 }, equippedBladeSlot: 'explosive_blade', equippedAuxSlot: 'explosive_blade' } });
    expect(tampered.walletBalance).toBe(0);
    expect(tampered.coreUpgrades.drivetrain).toBe(10);
    expect(tampered.attachments.unlockedTiers.explosive_blade).toBe(3);
    expect(tampered.attachments.equippedAuxSlot).toBeNull();
    expect(normalizeProfile({ version: 2, walletBalance: 50 })).toEqual(emptyProfile());
  });
});
