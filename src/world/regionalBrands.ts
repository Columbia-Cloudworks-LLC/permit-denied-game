/**
 * Brand stamping and regional landmark dressing: the generation-time half of the regional
 * establishments. It rides in the lazy overworld chunk and reaches town generation through
 * `RegionalPlacement.finish`, so none of it counts toward the startup bundle.
 * Never import this from the startup graph.
 */
import { Rng } from '../game/rng';
import { facadeDetailPose, type FacadeDetailDef } from '../structure/facadeDetails';
import { roofCoverage } from '../structure/roof';
import type { Building } from '../structure/types';
import { spawnAsset } from './catalog';
import type { BrandSpec, RegionalLayout, RegionalPlacement } from './regionalPlacement';

export const SIGN_TEXT = /^[A-Z0-9 ]{1,16}$/;
/** Share of eligible ordinary hosts that take a brand skin. */
export const BRAND_SHARE = 0.6;
/** One chain does not paper a whole county. */
export const MAX_PER_BRAND = 2;
const BRAND_SALT = 0xb7a2d5;
const PUMP_SALT = 0x9d2c51;
/** A branded canopy looks for its convenience store this close (centre to centre, metres). */
const SITE_RADIUS = 24;
export const TRAVEL_PLAZA_ID = 'mega-beaver-travel-plaza';

const center = (b: Building) => ({ x: b.x + b.w * b.cellSize / 2, y: b.y + b.d * b.cellSize / 2 });
const hosts = (brand: BrandSpec, b: Building) => brand.hostBuildingIds.includes(b.archetypeId);
const isSign = (d: FacadeDetailDef) => d.kind === 'signboard' || d.kind === 'marquee' || d.kind === 'rooftop-sign';

type Side = 'south' | 'east';
type Mount = Pick<FacadeDetailDef, 'floor' | 'gx' | 'gy' | 'side' | 'width'>;

/**
 * The longest exposed run on the outermost row of one frontage, trimmed to `want` cells and
 * centred. `has` says whether a cell can carry the sign; a cell is exposed when nothing stands
 * outward of it.
 */
function frontage(b: Building, floor: number, side: Side, want: number, has: (gx: number, gy: number) => boolean): Mount | null {
  const south = side === 'south', len = south ? b.w : b.d, depth = south ? b.d : b.w;
  const at = (u: number, v: number) => has(south ? u : v, south ? v : u);
  for (let v = depth - 1; v >= 0; v--) {
    let best: { start: number; run: number } | null = null, start = -1;
    for (let u = 0; u <= len; u++) {
      const open = u < len && at(u, v) && !at(u, v + 1);
      if (open && start < 0) start = u;
      if (!open && start >= 0) {
        if (!best || u - start > best.run) best = { start, run: u - start };
        start = -1;
      }
    }
    if (!best) continue;
    const width = Math.min(want, best.run), u0 = best.start + Math.floor((best.run - width) / 2);
    return { floor, side, width, gx: south ? u0 : v, gy: south ? v : u0 };
  }
  return null;
}

/** A sign mount for a host with no sign of its own: the flat roof edge first, then the ground-floor wall. */
export function brandMount(b: Building, text: string): (Mount & { kind: 'rooftop-sign' | 'signboard' }) | null {
  const top = b.floors - 1;
  const covered = new Set(b.roofs.filter(r => r.floor === top && r.style === 'flat').flatMap(r => roofCoverage(r).map(p => `${p.gx},${p.gy}`)));
  const wall = (gx: number, gy: number) => !!b.grid[0]?.[gx]?.[gy];
  for (const side of ['south', 'east'] as const) {
    const roof = b.roof === 'flat' && covered.size ? frontage(b, top, side, 3, (gx, gy) => covered.has(`${gx},${gy}`)) : null;
    if (roof && roof.width >= 2) return { ...roof, kind: 'rooftop-sign' };
    const face = frontage(b, 0, side, text.length > 9 ? 4 : 3, wall);
    if (face && face.width >= 2) return { ...face, kind: 'signboard' };
  }
  return null;
}

/**
 * Paint one brand onto one building: name, fascia, and its sign. Existing signboards and marquees
 * are recoloured and the ground-floor ones relettered; a host without one gets a mounted sign,
 * and only where the mount is in bounds, exposed and posed. Returns false when the host stays bare.
 */
export function stampBrand(b: Building, brand: BrandSpec): boolean {
  if (!SIGN_TEXT.test(brand.signText)) throw new Error(`Brand ${brand.id} sign text "${brand.signText}" breaks the signage alphabet`);
  const colors = { faceColor: brand.faceColor, trimColor: brand.trimColor, textColor: brand.textColor };
  let details = b.facadeDetails.map(d => isSign(d) ? { ...d, ...colors, text: d.floor === 0 || d.kind === 'rooftop-sign' ? brand.signText : d.text } : d);
  if (!details.some(d => isSign(d) && d.text === brand.signText)) {
    const mount = brandMount(b, brand.signText);
    if (!mount) return false;
    const sign: FacadeDetailDef = { id: `brand-${brand.id}`, text: brand.signText, ...colors, ...mount };
    if (!facadeDetailPose({ ...b, facadeDetails: [sign] }, sign)) return false;
    details = [...details, sign];
  }
  b.facadeDetails = details;
  b.name = brand.label.toUpperCase();
  b.fasciaColor = brand.fasciaColor;
  b.brandId = brand.id;
  if (b.regionalSignature) b.regionalSignature = brand.label;
  b.visualRevision++;
  return true;
}

/**
 * Stamp the county's brands: its tagged signatures first, then a seeded share of the other
 * eligible hosts. A branded fuel canopy carries its brand to the storefront on the same site.
 * `brands` is in priority order; the pick leans toward the front of it. Returns the stamped buildings.
 */
export function stampRegionalBrands(buildings: readonly Building[], brands: readonly BrandSpec[], seed: number): Building[] {
  if (!brands.length) return [];
  const rng = new Rng((seed ^ BRAND_SALT) >>> 0);
  const used = new Map<string, number>();
  const stamped: Building[] = [];
  const open = (b: Building) => !b.campaignLandmark && !b.brandId;
  const apply = (b: Building, brand: BrandSpec): boolean => {
    if (!stampBrand(b, brand)) return false;
    used.set(brand.id, (used.get(brand.id) ?? 0) + 1);
    stamped.push(b);
    if (b.archetypeId !== 'service-station-canopy' || !brand.hostBuildingIds.includes('storefront')) return true;
    const at = center(b);
    const shop = buildings
      .filter(s => s.archetypeId === 'storefront' && open(s))
      .map(s => ({ s, d: Math.hypot(center(s).x - at.x, center(s).y - at.y) }))
      .filter(entry => entry.d <= SITE_RADIUS)
      .sort((a, c) => a.d - c.d || a.s.id - c.s.id)[0]?.s;
    if (shop && stampBrand(shop, brand)) stamped.push(shop);
    return true;
  };
  const choose = (b: Building): BrandSpec | undefined => {
    const options = brands.filter(brand => hosts(brand, b) && (used.get(brand.id) ?? 0) < MAX_PER_BRAND);
    // Squaring the roll leans toward the region's own chains at the front of the list.
    return options[Math.floor(rng.next() ** 2 * options.length)];
  };
  for (const b of buildings) {
    if (!b.regionalSignature || !open(b)) continue;
    const brand = brands.find(entry => hosts(entry, b));
    if (brand) apply(b, brand);
  }
  for (const b of buildings) {
    if (!open(b) || !brands.some(brand => hosts(brand, b))) continue;
    // Roll for every eligible host, taken or not, so one building's fit never shifts the next one's roll.
    const take = rng.chance(BRAND_SHARE), brand = choose(b);
    if (take && brand) apply(b, brand);
  }
  return stamped;
}

/** The Mega Beaver's fuel islands: 8, 10 or 12 pumps in two rows under the landmark canopy. */
export function dressTravelPlaza(layout: RegionalLayout, seed: number): number {
  const canopy = layout.buildings.find(b => b.campaignLandmark && b.archetypeId === TRAVEL_PLAZA_ID);
  if (!canopy) return 0;
  const rng = new Rng((seed ^ PUMP_SALT) >>> 0);
  const perRow = 4 + rng.int(0, 2), w = canopy.w * canopy.cellSize, d = canopy.d * canopy.cellSize;
  let placed = 0;
  for (const row of [0.3, 0.7]) for (let i = 0; i < perRow; i++) {
    const x = canopy.x + w * (i + 0.5) / perRow, y = canopy.y + d * row;
    // A column stands on its own cell; a pump there slides half a cell toward the canopy's middle.
    const column = !!canopy.grid[0]?.[Math.floor((x - canopy.x) / canopy.cellSize)]?.[Math.floor((y - canopy.y) / canopy.cellSize)];
    const pump = spawnAsset('fuel-pump', x - 0.3, y + (column ? (row < 0.5 ? 1 : -1) * canopy.cellSize * 0.75 : 0) - 0.3);
    layout.props.push(pump);
    placed++;
  }
  return placed;
}

/** `RegionalPlacement.finish`: everything the region does to a finished county layout. */
export function finishRegionalLayout(placement: Pick<RegionalPlacement, 'brands'>, layout: RegionalLayout, seed: number): void {
  stampRegionalBrands(layout.buildings, placement.brands ?? [], seed);
  dressTravelPlaza(layout, seed);
}
