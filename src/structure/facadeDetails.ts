import { FLOOR_Z } from '../game/constants';
import { materialHp, type Building, type Cell } from './types';
import { displacedRoofVerts, roofCoverage, heightOnPoly } from './roof';

export const FACADE_DETAIL_KINDS = ['signboard', 'marquee', 'clock-face', 'roll-up-door', 'porch', 'fire-escape', 'entry-steps', 'display-glazing', 'roof-duct', 'dormer'] as const;
export interface FacadeDetailDef {
  id: string;
  kind: typeof FACADE_DETAIL_KINDS[number];
  floor: number; gx: number; gy: number;
  side: 'south' | 'east';
  /** Integer span along the frontage, in cells. Every cell is a required mounting point. */
  width: number;
  text?: string;
}

export function facadeDetailSupports(b: Building, d: FacadeDetailDef): Cell[] {
  if ((d.kind === 'roof-duct' || d.kind === 'dormer')) return (detailRoof(b, d)?.support ?? []).map(p => b.grid[d.floor]?.[p.gx]?.[p.gy]).filter((c): c is Cell => Boolean(c));
  return Array.from({ length: d.width }, (_, i) =>
    b.grid[d.floor]?.[d.gx + (d.side === 'south' ? i : 0)]?.[d.gy + (d.side === 'east' ? i : 0)])
    .filter((c): c is Cell => Boolean(c));
}

export function detailRoof(b: Building, d: FacadeDetailDef) {
  return b.roofs.find(r => r.floor === d.floor && roofCoverage(r).some(p => p.gx === d.gx && p.gy === d.gy));
}

/** Roof attachments start on the original covering plane and share its hinge/drop. */
export function roofDetailPoint(b: Building, d: FacadeDetailDef, u: number, out: number, z: number) {
  const roof = detailRoof(b, d)!;
  const base = heightOnPoly(roof.verts, b.x + (d.gx + .5) * b.cellSize, b.y + (d.gy + .5) * b.cellSize) ?? roof.verts[0]!.z;
  return displacedRoofVerts(roof, [{ x: b.x + d.gx * b.cellSize + (d.side === 'south' ? u : out),
    y: b.y + d.gy * b.cellSize + (d.side === 'south' ? out : u), z: base + z }])[0]!;
}

export function initializeFacadeDetails(b:Building) {
  for(const detail of b.facadeDetails) if(detail.kind==='display-glazing') for(const c of facadeDetailSupports(b,detail))
    c.cladding={material:'glass',hp:materialHp('glass'),maxHp:materialHp('glass'),shed:false};
}

/** Attached decoration shares its mount's controlled failure and adds no collision.
 * Display glass uses the mount's explicit glass cladding HP; the frame remains after a pane breaks.
 * Any lost mounting point tears the detail away; it disappears with the falling wall debris. */
export function facadeDetailPose(b: Building, d: FacadeDetailDef) {
  if ((d.kind === 'roof-duct' || d.kind === 'dormer')) {
    const roof = detailRoof(b, d);
    if (!roof || roof.state === 'gone') return null;
    return { ...roofDetailPoint(b, d, 0, 0, 0), scaleZ: 1 - roof.fallT * .85,
      width: b.cellSize, damaged: roof.state !== 'intact', fallT: roof.fallT, panes: undefined };
  }
  const supports = facadeDetailSupports(b, d);
  if (supports.length !== d.width || supports.some(c => c.state === 'gone')) return null;
  const falling = supports.filter(c => c.state === 'falling').sort((a, b) => b.fallT - a.fallT)[0];
  const t = falling?.fallT ?? 0;
  return { x: b.x + (d.gx + (d.side === 'east' ? 1 : 0)) * b.cellSize + (falling?.fallDx ?? 0) * t,
    y: b.y + (d.gy + (d.side === 'south' ? 1 : 0)) * b.cellSize + (falling?.fallDy ?? 0) * t,
    z: d.floor * FLOOR_Z * (1 - t), scaleZ: 1 - t * .85,
    width: d.width * b.cellSize, damaged: supports.some(c => c.state !== 'intact'), fallT: t,
    panes: d.kind==='display-glazing'? supports.map(c=>({hp:c.cladding?.hp??0,maxHp:c.cladding?.maxHp??0})):undefined };
}
