import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../game/constants';
import { ParticlePool } from '../fx/particles';
import { ARCHETYPES, validateBuildingDefinition } from '../world/archetypes';
import { applyCellDamage, createBuildingFromDefinition, stepStructures } from './building';
import { facadeDetailPose, facadeDetailSupports, FACADE_DETAIL_KINDS } from './facadeDetails';

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
    for (const c of (kind === 'roof-duct' || kind === 'dormer') ? mounts : mounts.slice(0, 1))
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

  it('rejects mounting inside the footprint and unknown lettering', () => {
    const a = structuredClone(ARCHETYPES.find(a => a.facadeDetails?.length)!);
    const d = a.facadeDetails![0]!;
    d.gx = 1; d.gy = 1; d.floor = 0; d.width = 1;
    expect(validateBuildingDefinition(a).join(' ')).toContain('exposed mounting cells');
    d.text = '<script>';
    expect(validateBuildingDefinition(a).join(' ')).toContain('Invalid facade detail');
  });
});
