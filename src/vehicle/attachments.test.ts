import { describe, expect, it } from 'vitest';
import { STOCK_LOADOUT, type DozerLoadout } from '../game/career';
import { EXPLOSIVE_TIERS, JATO_TIERS, blastReady, createRig, pressAuxAbility, pressBladeAbility, rigReadout, spendBlast, stepRig } from './attachments';
import { ParticlePool } from '../fx/particles';
import { createTown } from '../world/town';
import { createDozer } from './dozer';
import { fireHarpoon, stepAttachmentEffects } from '../sim/attachmentEffects';
import { cellPresent } from '../structure/types';

const withBlade = (tier: 1 | 2 | 3): DozerLoadout => ({ ...STOCK_LOADOUT, blade: { id: 'explosive_blade', tier } });
const withAux = (id: 'jato_thrusters' | 'seismic_ripper' | 'wrecking_harpoon', tier: 1 | 2 | 3 = 1): DozerLoadout => ({ ...STOCK_LOADOUT, aux: { id, tier } });
const idle = { cellsDestroyed: 0, vehiclesWrecked: 0 };

describe('shaped-charge blade state machine', () => {
  it('charges passively, faster with kinetic refunds', () => {
    const passive = createRig(withBlade(1));
    stepRig(passive, 10, idle);
    expect(passive.blade!.state).toBe('charging');
    const busy = createRig(withBlade(1));
    stepRig(busy, 10, { cellsDestroyed: 40, vehiclesWrecked: 4 });
    expect(busy.blade!.state).toBe('ready');
    expect(busy.cues).toContain('blade-ready');
  });

  it('arms only with the blade down, then burns the window whether or not the blade stays down', () => {
    const rig = createRig(withBlade(2));
    stepRig(rig, EXPLOSIVE_TIERS[2].cooldown, idle);
    pressBladeAbility(rig, false);
    expect(rig.blade!.state).toBe('ready');
    expect(rig.cues).toContain('blade-rejected');
    pressBladeAbility(rig, true);
    expect(rig.blade!.state).toBe('armed');
    expect(blastReady(rig, false)).toBe(false);
    expect(blastReady(rig, true)).toBe(true);
    spendBlast(rig);
    expect(blastReady(rig, true)).toBe(false);
    stepRig(rig, EXPLOSIVE_TIERS[2].icd, idle);
    expect(blastReady(rig, true)).toBe(true);
    stepRig(rig, EXPLOSIVE_TIERS[2].window, idle);
    expect(rig.blade!.state).toBe('charging');
    expect(rig.blade!.cooldown).toBe(EXPLOSIVE_TIERS[2].cooldown);
  });

  it('caps detonations per window', () => {
    const rig = createRig(withBlade(1));
    stepRig(rig, 30, idle);
    pressBladeAbility(rig, true);
    for (let i = 0; i < EXPLOSIVE_TIERS[1].maxBlasts; i++) { spendBlast(rig); rig.blade!.icd = 0; }
    expect(blastReady(rig, true)).toBe(false);
  });
});

describe('aux attachments', () => {
  it('JATO burns, then reloads; a second press during the burn is refused', () => {
    const rig = createRig(withAux('jato_thrusters', 3));
    expect(pressAuxAbility(rig)).toBe('jato');
    expect(pressAuxAbility(rig)).toBeNull();
    stepRig(rig, JATO_TIERS[3].burn, idle);
    expect(rig.aux!.cooldown).toBe(JATO_TIERS[3].cooldown);
    expect(rigReadout(rig).aux!.status).toBe('RELOAD');
    stepRig(rig, JATO_TIERS[3].cooldown, idle);
    expect(pressAuxAbility(rig)).toBe('jato');
  });

  it('the ripper toggles without a cooldown', () => {
    const rig = createRig(withAux('seismic_ripper'));
    pressAuxAbility(rig);
    expect(rig.aux!.deployed).toBe(true);
    pressAuxAbility(rig);
    expect(rig.aux!.deployed).toBe(false);
  });
});

describe('attachment world effects', () => {
  const cottageTown = () => createTown({ testMap: { kind: 'asset', assetId: 'building:cottage', variant: 0 } });

  it('a shaped charge at a timber wall vaporizes the cells in its radius', () => {
    const town = cottageTown();
    const house = town.buildings[0]!;
    const before = house.cells.filter(cellPresent).length;
    const dozer = createDozer(house.x + house.w * house.cellSize / 2, house.y + house.d * house.cellSize + 2.2, -Math.PI / 2);
    dozer.bladeDown = true;
    const rig = createRig(withBlade(1));
    stepRig(rig, 30, idle);
    pressBladeAbility(rig, true);
    const cash = stepAttachmentEffects(town, dozer, new ParticlePool(), [], rig, 1 / 60);
    expect(rig.blade!.blasts).toBe(1);
    expect(cash).toBeGreaterThan(0);
    expect(house.cells.filter(cellPresent).length).toBeLessThan(before);
  });

  it('a ripper pulse pre-cracks foundations without finishing them', () => {
    const town = cottageTown();
    const house = town.buildings[0]!;
    const dozer = createDozer(house.x + house.w * house.cellSize / 2, house.y - 1.2, -Math.PI / 2);
    const rig = createRig(withAux('seismic_ripper', 3));
    pressAuxAbility(rig);
    stepAttachmentEffects(town, dozer, new ParticlePool(), [], rig, 0.5);
    const ground = house.cells.filter(c => c.floor === 0);
    expect(ground.some(c => c.hp < c.maxHp)).toBe(true);
    expect(ground.filter(c => c.state === 'breached').length).toBe(0);
  });

  it('the harpoon latches onto a cell ahead and pulls it apart as the dozer backs away', () => {
    const town = cottageTown();
    const house = town.buildings[0]!;
    const dozer = createDozer(house.x + house.w * house.cellSize / 2, house.y + house.d * house.cellSize + 8, -Math.PI / 2);
    const rig = createRig(withAux('wrecking_harpoon', 3));
    expect(pressAuxAbility(rig)).toBe('harpoon-fire');
    expect(fireHarpoon(town, dozer, rig)).toBe(true);
    const target = house.cells[rig.aux!.tether!.cellIndex]!;
    dozer.y += 3;
    for (let i = 0; i < 120 && cellPresent(target); i++) stepAttachmentEffects(town, dozer, new ParticlePool(), [], rig, 1 / 60);
    expect(cellPresent(target)).toBe(false);
  });
});
