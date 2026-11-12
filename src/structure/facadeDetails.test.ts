import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../game/constants';
import { ParticlePool } from '../fx/particles';
import { ARCHETYPES, validateBuildingDefinition } from '../world/archetypes';
import { applyCellDamage, createBuildingFromDefinition, stepStructures } from './building';
import { facadeDetailPose, facadeDetailSupports, FACADE_DETAIL_KINDS, onRoof } from './facadeDetails';
import { downspoutCells, faceRun, facadeTrimPlan, stampStreetFaces, trimItemsAt, trimKey, usesWindowAc, type TrimItemKind } from './facadeTrim';
import type { Building, Lot } from './types';

describe('mounted facade details', () => {
  it.each(['roof-duct', 'dormer'] as const)('rejects %s on the wrong roof or spanning multiple mounting cells', kind => {
    const a = structuredClone(ARCHETYPES.find(a => a.facadeDetails?.some(d => d.kind === kind))!);
    const originalRoof = a.roof;
    a.roof = kind === 'roof-duct' ? 'gable' : 'flat';
    expect(validateBuildingDefinition(a).join(' ')).toContain(kind === 'roof-duct' ? 'top flat roof' : 'top gable roof');
    a.roof = originalRoof;
    a.facadeDetails!.find(d => d.kind === kind)!.width = 2;
    expect(validateBuildingDefinition(a).join(' ')).toContain('single mounting cell');
  });
  it('breaks shopfront glass without destroying its bearing frame',()=>{
    const a=ARCHETYPES.find(a=>a.facadeDetails?.some(d=>d.kind==='display-glazing'))!;
    const b=createBuildingFromDefinition(a,'GLAZING',0,0),particles=new ParticlePool();
    const d=b.facadeDetails.find(d=>d.kind==='display-glazing')!,c=facadeDetailSupports(b,d)[0]!,hp=c.hp;
    expect(c.cladding?.material).toBe('glass');
    applyCellDamage(b,c,c.cladding!.maxHp,0,1,particles,[]);
    expect(c.hp).toBe(hp);expect(c.state).toBe('intact');expect(c.cladding!.hp).toBe(0);
    for(let i=0;i<180;i++)stepStructures([b],SIM_DT,particles,[]);
    expect(c.state).toBe('intact');expect(facadeDetailPose(b,d)?.panes?.[0]?.hp).toBe(0);
    expect(b.roofs.every(r=>r.state==='intact')).toBe(true);
  });
  for (const kind of FACADE_DETAIL_KINDS) it(`${kind} stays mounted intact, follows failure and leaves no floating detail`, () => {
    const a = ARCHETYPES.find(a => a.facadeDetails?.some(d => d.kind === kind))!;
    const b = createBuildingFromDefinition(a, 'DETAIL', 0, 0), detail = b.facadeDetails.find(d => d.kind === kind)!;
    const initial = facadeDetailPose(b, detail)!;
    const particles = new ParticlePool();
    for (let i = 0; i < 180; i++) stepStructures([b], SIM_DT, particles, []);
    expect(facadeDetailPose(b, detail)).toEqual(initial);
    const mounts = facadeDetailSupports(b, detail);
    for (const c of onRoof(detail) ? mounts : mounts.slice(0, 1))
      applyCellDamage(b, c, 10000, 0, 1, new ParticlePool(), []);
    let sawMovement = false;
    for (let i = 0; i < 300; i++) {
      stepStructures([b], SIM_DT, particles, []);
      const pose = facadeDetailPose(b, detail);
      if (pose?.fallT) {
        sawMovement = true; expect(pose.scaleZ).toBeLessThan(1);
        expect([pose.x, pose.y, pose.z, pose.width].every(Number.isFinite)).toBe(true);
      }
    }
    // Tall shells absorb local facade loss directly into the aggregate pile.
    expect(sawMovement).toBe(!b.coreCollapse);
    expect(facadeDetailPose(b, detail)).toBeNull();
  });

  it('mounts a rooftop sign 1-3 cells wide on a flat or canopy roof edge only', () => {
    const a = structuredClone(ARCHETYPES.find(a => a.id === 'service-station-canopy')!);
    const sign = a.facadeDetails!.find(d => d.kind === 'rooftop-sign')!;
    expect(validateBuildingDefinition(a)).toEqual([]);
    sign.width = 3;
    expect(validateBuildingDefinition(a)).toEqual([]);
    sign.width = 4;
    expect(validateBuildingDefinition(a).join(' ')).toContain('Rooftop signs span 1-3 cells');
    sign.width = 2; sign.gy = 3;
    expect(validateBuildingDefinition(a).join(' ')).toContain('exposed mounting cells');
    sign.gy = 6; a.roof = 'gable';
    expect(validateBuildingDefinition(a).join(' ')).toContain('Rooftop signs span 1-3 cells');
  });

  it('accepts sign colours as 24-bit integers and rejects anything else', () => {
    const a = structuredClone(ARCHETYPES.find(a => a.id === 'service-station-canopy')!);
    const sign = a.facadeDetails!.find(d => d.kind === 'rooftop-sign')!;
    Object.assign(sign, { faceColor: 0xc8102e, trimColor: 0, textColor: 0xffffff });
    expect(validateBuildingDefinition(a)).toEqual([]);
    for (const bad of [-1, 0x1000000, 1.5]) {
      sign.faceColor = bad;
      expect(validateBuildingDefinition(a).join(' ')).toContain('Invalid facade detail');
    }
  });

  it('spans the rooftop sign across its cells and drops it when any panel under it is gone', () => {
    const a = ARCHETYPES.find(a => a.id === 'service-station-canopy')!;
    const b = createBuildingFromDefinition(a, 'CANOPY', 0, 0), sign = b.facadeDetails.find(d => d.kind === 'rooftop-sign')!;
    expect(facadeDetailPose(b, sign)!.width).toBe(sign.width * b.cellSize);
    b.roofs.forEach(roof => { roof.state = 'gone'; });
    expect(facadeDetailPose(b, sign)).toBeNull();
  });

  it('rejects mounting inside the footprint and unknown lettering', () => {
    const a = structuredClone(ARCHETYPES.find(a => a.facadeDetails?.length)!);
    const d = a.facadeDetails![0]!;
    d.gx = 1; d.gy = 1; d.floor = 0; d.width = 1;
    expect(validateBuildingDefinition(a).join(' ')).toContain('exposed mounting cells');
    d.text = '<script>';
    expect(validateBuildingDefinition(a).join(' ')).toContain('Invalid facade detail');
  });
});

describe('procedural facade trim', () => {
  const build = (id: string) => createBuildingFromDefinition(ARCHETYPES.find(a => a.id === id)!, id, 4, 6);
  const lotFacing = (id: string, heading: number, cornerLot = false) => ({ id, heading, cornerLot }) as Lot;
  const kinds = (plan: ReturnType<typeof facadeTrimPlan>) => new Set([...plan.items.values()].flat());

  it('fronts the street on the south face by default and on the east face of an east-facing lot', () => {
    const shop = build('hardware-store'), east = build('hardware-store'), north = build('hardware-store');
    expect(facadeTrimPlan(shop)).toMatchObject({ street: 'south', service: 'east' });
    for (const b of [shop, east, north]) b.lotId = b === shop ? 'south' : b === east ? 'east' : 'north';
    const revision = east.visualRevision;
    // Heading runs frontage to rear: pi puts the street to the east, 3pi/2 to the south, 0 to the west.
    stampStreetFaces([shop, east, north], [lotFacing('south', Math.PI * 1.5), lotFacing('east', Math.PI), lotFacing('north', Math.PI / 2)]);
    expect(east.visualRevision).toBeGreaterThan(revision);
    expect(facadeTrimPlan(shop)).toMatchObject({ street: 'south', service: 'east' });
    expect(facadeTrimPlan(east)).toMatchObject({ street: 'east', service: 'south' });
    expect(facadeTrimPlan(north).street).toBe('south');
  });

  it('keeps meters, gas, louvers and service doors on the service face and the blade sign on the street face', () => {
    const service: TrimItemKind[] = ['meter-bank', 'conduit', 'gas-meter', 'louver', 'downspout', 'service-door', 'wall-pack'];
    for (const stamped of [false, true]) {
      const b = build('hardware-store');
      if (stamped) { b.lotId = 'lot'; stampStreetFaces([b], [lotFacing('lot', Math.PI)]); }
      const plan = facadeTrimPlan(b);
      for (const [key, items] of plan.items) for (const item of items) {
        const side = key & 1 ? 'east' : 'south';
        if (service.includes(item)) expect(side, item).toBe(plan.service);
        if (item === 'blade-sign') expect(side).toBe(plan.street);
      }
      expect([...kinds(plan)]).toEqual(expect.arrayContaining(['meter-bank', 'gas-meter', 'louver', 'wall-pack', 'blade-sign']));
      expect(kinds(plan).has('service-door')).toBe(plan.service === 'east');
    }
  });

  it('mounts gear only on real exposed cells and drops it from a damaged one', () => {
    for (const a of ARCHETYPES) {
      const b = createBuildingFromDefinition(a, a.label, 0, 0), plan = facadeTrimPlan(b);
      for (const [key, items] of plan.items) {
        const side = key & 1 ? 'east' : 'south', gy = (key >> 1) & 127, gx = (key >> 8) & 127, floor = key >> 15;
        const cell = b.grid[floor]?.[gx]?.[gy];
        expect(cell?.exterior[side], `${a.id} ${items.join()}`).toBe(true);
        expect(trimKey(side, floor, gx, gy)).toBe(key);
        expect(plan.claimed.has(key), a.id).toBe(false);
        expect(trimItemsAt(plan, cell!, side), `${a.id} ${cell!.state}`).toEqual(items);
        for (const state of ['cracked', 'breached', 'falling', 'gone'] as const) expect(trimItemsAt(plan, { ...cell!, state }, side)).toEqual([]);
      }
    }
  });

  it('puts window units only on the older walk-up residential forms', () => {
    for (const id of ['boarding-house', 'motel-room-block', 'walkup-block', 'walkup']) {
      expect(usesWindowAc(build(id)), id).toBe(true);
      expect(kinds(facadeTrimPlan(build(id))).has('window-ac'), id).toBe(true);
    }
    for (const a of ARCHETYPES) {
      const b = createBuildingFromDefinition(a, a.label, 0, 0);
      const listed = a.kind === 'house' && a.floors <= 6 && (a.theme === 'walkup' ||
        (a.traits?.use ?? []).some(use => ['boarding-house', 'motel-room-block', 'urban-apartment', 'fourplex', 'rowhouse-unit', 'garden-apartment-block'].includes(use)));
      expect(kinds(facadeTrimPlan(b)).has('window-ac') ? true : !listed || !b.cells.some(c => c.windowE || c.windowS), a.id).toBe(true);
      if (!listed) expect(kinds(facadeTrimPlan(b)).has('window-ac'), a.id).toBe(false);
    }
    for (const id of ['bakery', 'ranch', 'telephone-exchange', 'warehouse']) expect(usesWindowAc(build(id)), id).toBe(false);
  });

  it('dresses the corners of civic masonry and of corner structures only', () => {
    for (const a of ARCHETYPES) {
      const b = createBuildingFromDefinition(a, a.label, 0, 0), plan = facadeTrimPlan(b);
      const masonry = b.construction.skin === 'brick' || b.construction.skin === 'concrete';
      const plain = b.openDecks || b.canopy || b.silos?.length || b.elevatedTank;
      const expected = masonry && !plain && (a.theme === 'civic' || a.theme === 'corner');
      expect(plan.corners !== 'none', a.id).toBe(!!expected);
      if (a.theme === 'corner' && expected) expect(plan.corners).toBe('quoins');
    }
    const shop = build('bakery');
    expect(facadeTrimPlan(shop).corners).toBe('none');
    shop.lotId = 'corner';
    stampStreetFaces([shop], [lotFacing('corner', Math.PI * 1.5, true)]);
    expect(facadeTrimPlan(shop).corners).toBe(shop.construction.skin === 'wood' ? 'none' : 'quoins');
  });

  it('leaves authored detail cells alone and replans when brand stamping replaces them', () => {
    const bakery = build('bakery'), plan = facadeTrimPlan(bakery);
    const sign = bakery.facadeDetails.find(d => d.kind === 'signboard')!;
    for (let i = 0; i < sign.width; i++) expect(plan.claimed.has(trimKey('south', sign.floor, sign.gx + i, sign.gy))).toBe(true);
    expect(facadeTrimPlan(bakery)).toBe(plan);
    bakery.facadeDetails = [];
    expect(facadeTrimPlan(bakery)).not.toBe(plan);
    expect(facadeTrimPlan(bakery).claimed.size).toBe(0);
  });

  it('is stable for a building and its regional seed, and varies across seeds', () => {
    const region = (seed: number) => ({ roofs: 'temperate', walls: 'brick-belt', soil: 'dark-loam', seed }) as Building['region'];
    const awnings = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const a = build('bakery'), b = build('bakery');
      a.region = region(seed * 7919); b.region = region(seed * 7919);
      expect(facadeTrimPlan(a)).toEqual(facadeTrimPlan(b));
      awnings.add(`${facadeTrimPlan(a).lintels}:${facadeTrimPlan(a).transom}:${facadeTrimPlan(a).meters}`);
    }
    expect(awnings.size).toBeGreaterThan(2);
  });

  it('puts scuppers and downspouts at the quarter points, on cell boundaries', () => {
    expect(downspoutCells(8)).toEqual([2, 6]);
    expect(downspoutCells(5)).toEqual([1, 4]);
    expect(downspoutCells(2)).toEqual([1]);
    expect(downspoutCells(1)).toEqual([]);
    const b = build('telephone-exchange'), plan = facadeTrimPlan(b), run = faceRun(b, plan.service);
    for (const at of downspoutCells(run.length)) expect(trimItemsAt(plan, run[at]!, plan.service)).toContain('downspout');
  });

  it('carries no trim on glass houses, canopies and open decks', () => {
    for (const a of ARCHETYPES) {
      const b = createBuildingFromDefinition(a, a.label, 0, 0);
      if (!(b.construction.skin === 'glass' || b.canopy || b.openDecks)) continue;
      expect(facadeTrimPlan(b)).toMatchObject({ belt: false, cornice: 'none', plinth: 'none', corners: 'none', awning: 'flat' });
      expect(facadeTrimPlan(b).items.size, a.id).toBe(0);
    }
  });
});
