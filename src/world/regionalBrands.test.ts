import { describe, expect, it } from 'vitest';
import { campaignLevelById } from '../game/campaign';
import { createBuildingFromArchetype } from '../structure/building';
import { facadeDetailPose } from '../structure/facadeDetails';
import type { Building } from '../structure/types';
import { ARCHETYPES, archetypeById } from './archetypes';
import { campaignWeight } from './campaignPlacement';
import { countyAt, countyEnvironment } from './counties';
import { BIOME_PROFILES } from './biomes';
import { BRANDS, brandById, brandsForRegion, REGIONAL_FLAVORS, regionalLandmark, regionalPlacement } from './regionalCatalog';
import { brandMount, MAX_PER_BRAND, SIGN_TEXT, stampBrand, stampRegionalBrands, TRAVEL_PLAZA_ID } from './regionalBrands';
import { regionalLevel } from './regionalPlacement';
import { REGIONS, regionById } from './regions';
import { createTown } from './town';

const ids = (regionId: string) => brandsForRegion(regionById(regionId)!).map(brand => brand.id);
const eager = new Set(ARCHETYPES.map(a => a.id));
const color = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffffff;

const county = (regionId: string, index: number) => {
  const def = countyAt(regionId, index)!, region = regionById(regionId)!;
  const placement = regionalPlacement(region, index);
  return createTown({ district: 'd30', seed: def.seed, campaign: regionalLevel(campaignLevelById(def.level.id), placement), regional: placement, biome: BIOME_PROFILES[countyEnvironment(region, index).biomeId] });
};

describe('regional brand catalog', () => {
  it('keeps every brand inside the signage alphabet, with real hosts and 24-bit colours', () => {
    expect(new Set(BRANDS.map(brand => brand.id)).size).toBe(BRANDS.length);
    expect(BRANDS.length).toBeGreaterThanOrEqual(13);
    for (const brand of BRANDS) {
      expect(brand.signText, brand.id).toMatch(SIGN_TEXT);
      expect(brand.signText, brand.id).toMatch(/^[A-Z0-9 ]{1,16}$/);
      expect(brand.id, brand.id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(brand.label.trim().length, brand.id).toBeGreaterThan(0);
      expect(brand.hostBuildingIds.length, brand.id).toBeGreaterThan(0);
      for (const host of brand.hostBuildingIds) expect(eager.has(host), `${brand.id}: ${host}`).toBe(true);
      for (const value of [brand.faceColor, brand.trimColor, brand.textColor, brand.fasciaColor]) expect(color(value), brand.id).toBe(true);
      for (const regionId of brand.regionIds ?? []) expect(regionById(regionId), `${brand.id}: ${regionId}`).toBeDefined();
      expect(brandById(brand.id)).toBe(brand);
    }
    for (const flavor of Object.values(REGIONAL_FLAVORS)) for (const id of flavor.brands) expect(brandById(id), `${flavor.id}: ${id}`).toBeDefined();
  });

  it('gives every state and province at least two establishments', () => {
    for (const region of REGIONS) expect(brandsForRegion(region).length, region.id).toBeGreaterThanOrEqual(2);
  });

  it('targets chains by country, region and flavor', () => {
    for (const region of REGIONS.filter(entry => entry.country === 'CA')) {
      const list = brandsForRegion(region);
      expect(list.slice(0, 2).map(brand => brand.id), region.id).toEqual(['timmys-coffee', 'canuck-tire']);
      expect(list.every(brand => !brand.countries || brand.countries.includes('CA')), region.id).toBe(true);
    }
    for (const region of REGIONS.filter(entry => entry.country === 'US')) {
      expect(ids(region.id), region.id).not.toContain('timmys-coffee');
      expect(ids(region.id), region.id).not.toContain('canuck-tire');
    }
    expect(ids('US-TX').slice(0, 2)).toEqual(['buccees-plaza', 'whatabeef']);
    for (const regionId of ['US-IL', 'US-IA', 'US-MO']) expect(ids(regionId).slice(0, 2), regionId).toEqual(['kaseys-general', 'mennards']);
    expect(ids('US-NY')).toEqual(['wahoo-market', 'dunkies']);
    expect(ids('US-GA')[0]).toBe('huddle-griddle');
    expect(ids('US-CA')).toEqual(expect.arrayContaining(['in-n-outpost', 'trader-moes']));
    expect(ids('US-AZ')).toEqual(expect.arrayContaining(['in-n-outpost', 'buccees-plaza']));
    expect(ids('US-WI')[0]).toBe('mennards');
  });
});

describe('brand stamping', () => {
  const brand = brandById('kaseys-general')!;

  it('repaints an existing sign, recolours the fascia and bumps the visual revision', () => {
    const canopy = createBuildingFromArchetype('service-station-canopy', 'CANOPY', 0, 0);
    const before = canopy.visualRevision, authored = archetypeById('service-station-canopy').facadeDetails!;
    expect(stampBrand(canopy, brand)).toBe(true);
    expect(canopy.visualRevision).toBeGreaterThan(before);
    expect(canopy).toMatchObject({ name: "KASEY'S GENERAL STORE", fasciaColor: brand.fasciaColor, brandId: brand.id });
    const sign = canopy.facadeDetails.find(d => d.kind === 'rooftop-sign')!;
    expect(sign).toMatchObject({ text: 'KASEYS PIZZA', faceColor: brand.faceColor, trimColor: brand.trimColor, textColor: brand.textColor });
    expect(facadeDetailPose(canopy, sign)).not.toBeNull();
    // The shared, frozen archetype definition is never written through.
    expect(authored.find(d => d.kind === 'rooftop-sign')!.text).toBe('GAS');
  });

  it('mounts a sign on a bare host only where the span is exposed, in bounds and posed', () => {
    for (const id of new Set(BRANDS.flatMap(entry => entry.hostBuildingIds))) {
      const b = createBuildingFromArchetype(id, 'HOST', 0, 0);
      const host = BRANDS.find(entry => entry.hostBuildingIds.includes(id))!;
      const ok = stampBrand(b, host);
      if (!ok) { expect(b.brandId, id).toBeUndefined(); continue; }
      const signs = b.facadeDetails.filter(d => d.text === host.signText);
      expect(signs.length, id).toBeGreaterThan(0);
      for (const sign of signs) {
        expect(sign.text, id).toMatch(SIGN_TEXT);
        expect(sign.gx >= 0 && sign.gy >= 0 && sign.gx < b.w && sign.gy < b.d, id).toBe(true);
        expect(sign.width, id).toBeLessThanOrEqual(sign.kind === 'rooftop-sign' ? 3 : 4);
        expect(facadeDetailPose(b, sign), id).not.toBeNull();
      }
    }
    const storefront = createBuildingFromArchetype('storefront', 'SHOP', 0, 0);
    const mount = brandMount(storefront, 'KASEYS PIZZA')!;
    expect(mount.kind).toBe('rooftop-sign');
    expect(mount.floor).toBe(storefront.floors - 1);
  });

  it('rejects lettering outside the signage alphabet', () => {
    const shop = createBuildingFromArchetype('storefront', 'SHOP', 0, 0);
    expect(() => stampBrand(shop, { ...brand, signText: "KASEY'S" })).toThrow(/signage alphabet/);
    expect(() => stampBrand(shop, { ...brand, signText: 'SEVENTEEN LETTERS X' })).toThrow(/signage alphabet/);
  });

  it('carries a branded canopy to the storefront on its site, and leaves far shops and landmarks alone', () => {
    const canopy = createBuildingFromArchetype('service-station-canopy', 'CANOPY', 4.5, 16);
    const shop = createBuildingFromArchetype('storefront', 'SHOP', 3, 3);
    const far = createBuildingFromArchetype('storefront', 'FAR', 200, 200);
    const hall = createBuildingFromArchetype('storefront', 'HALL', 12, 3);
    hall.campaignLandmark = true;
    canopy.regionalSignature = 'Highway Service Station';
    stampRegionalBrands([canopy, shop, far, hall], [brand], 7);
    expect(canopy.brandId).toBe(brand.id);
    expect(canopy.regionalSignature).toBe("Kasey's General Store");
    expect(shop.brandId).toBe(brand.id);
    expect(shop.fasciaColor).toBe(brand.fasciaColor);
    expect(hall.brandId).toBeUndefined();
    // Two stamps is the cap for one chain in a county.
    expect([canopy, shop, far].filter(b => b.brandId === brand.id).length).toBeLessThanOrEqual(MAX_PER_BRAND + 1);
  });

  it('stamps a county the same way every time, within the cap, and never the landmark', () => {
    const snapshot = (town: ReturnType<typeof createTown>) => town.buildings.filter(b => b.brandId).map(b => `${b.id}:${b.brandId}:${b.name}`);
    for (const [regionId, index] of [['US-TX', 2], ['US-IA', 2], ['CA-ON', 4], ['US-NY', 5]] as const) {
      const town = county(regionId, index), again = county(regionId, index);
      expect(snapshot(town), `${regionId}#${index}`).toEqual(snapshot(again));
      const allowed = new Set(ids(regionId));
      const branded = town.buildings.filter(b => b.brandId);
      for (const b of branded) {
        expect(allowed.has(b.brandId!), `${regionId}: ${b.brandId}`).toBe(true);
        expect(b.campaignLandmark).toBeFalsy();
        expect(b.fasciaColor).toBe(brandById(b.brandId)!.fasciaColor);
        expect(b.visualRevision).toBeGreaterThan(0);
        for (const d of b.facadeDetails) if (d.text !== undefined) expect(d.text).toMatch(SIGN_TEXT);
      }
      expect(town.diagnostic.ok, `${regionId}#${index}`).toBe(true);
    }
    const roadside = ['US-TX', 'US-IA', 'US-GA', 'CA-AB'].map(regionId => county(regionId, 2).buildings.filter(b => b.brandId).length);
    expect(roadside.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4);
  }, 120_000);
});

describe('regional landmarks', () => {
  it('names only registered landmark packages that list the county\'s level', () => {
    for (const flavor of Object.values(REGIONAL_FLAVORS)) for (const entry of flavor.landmarks) {
      const archetype = archetypeById(entry.buildingId);
      const levelId = countyAt('US-IL', entry.countyIndex)!.level.id;
      expect(archetype.campaign?.landmarkOnly, `${flavor.id}: ${entry.buildingId}`).toBe(true);
      expect(campaignWeight(archetype.campaign, levelId), `${flavor.id}: ${entry.buildingId} on ${levelId}`).toBeGreaterThan(0);
      for (const regionId of entry.regionIds ?? []) expect(regionById(regionId)?.flavor, regionId).toBe(flavor.id);
    }
  });

  it('breaks up the seven civic landmarks by flavor and by named region', () => {
    const label = (regionId: string, index: number) => countyAt(regionId, index)!.level.landmark.label;
    expect(label('US-IL', 1)).toBe('Terminal Grain Co-op');
    expect(label('US-KS', 3)).toBe('Terminal Elevator Works');
    expect(label('US-IL', 3)).toBe('Township Hall');
    expect(label('US-MO', 5)).toBe('Riverboat Brewery Brickworks');
    expect(label('US-MI', 3)).toBe('Blast Furnace & Auto Works');
    expect(label('US-OH', 4)).toBe('Frank Grimes Bowl');
    expect(label('US-GA', 2)).toBe('Giant Roadside Water Tower');
    expect(label('US-TX', 2)).toBe('Mega Beaver Travel Plaza');
    expect(label('US-MA', 7)).toBe('Granite Statehouse');
    expect(label('US-TX', 7)).toBe("Governor's Mansion");
    expect(regionalLandmark('grain-belt', 5)).toBeUndefined();
    const distinct = new Set(REGIONS.flatMap(region => [1, 2, 3, 4, 5, 6, 7].map(index => label(region.id, index))));
    expect(distinct.size).toBeGreaterThanOrEqual(15);
    for (const region of REGIONS) expect(new Set([1, 2, 3, 4, 5, 6, 7].map(index => countyAt(region.id, index)!.level.landmark.buildingId)).size, region.id).toBeGreaterThanOrEqual(6);
  });

  it('builds each overridden county with exactly its regional landmark as the objective', () => {
    const cases = [['US-IL', 1], ['US-KS', 3], ['US-MO', 5], ['US-MI', 3], ['US-OH', 4], ['US-GA', 2], ['US-TX', 2], ['US-CO', 2], ['US-MA', 7], ['CA-QC', 7], ['US-CA', 7]] as const;
    for (const [regionId, index] of cases) {
      const town = county(regionId, index), want = countyAt(regionId, index)!.level.landmark;
      const marked = town.buildings.filter((b: Building) => b.campaignLandmark);
      expect(marked.map(b => b.archetypeId), `${regionId}#${index}`).toEqual([want.buildingId]);
      expect(marked[0]!.name, `${regionId}#${index}`).toBe(want.label.toUpperCase());
    }
  }, 240_000);

  it('dresses the Mega Beaver with 8 to 12 explosive fuel pumps under its canopy', () => {
    const town = county('US-TX', 2);
    const canopy = town.buildings.find(b => b.archetypeId === TRAVEL_PLAZA_ID)!;
    const w = canopy.w * canopy.cellSize, d = canopy.d * canopy.cellSize;
    const pumps = town.props.filter(p => p.assetId === 'fuel-pump' && p.x >= canopy.x && p.x <= canopy.x + w && p.y >= canopy.y && p.y <= canopy.y + d);
    expect(pumps.length).toBeGreaterThanOrEqual(8);
    expect(pumps.length).toBeLessThanOrEqual(12);
    expect(canopy.facadeDetails.some(detail => detail.kind === 'rooftop-sign' && detail.text === 'MEGA BEAVER')).toBe(true);
    expect(canopy.fasciaColor).toBeDefined();
  }, 60_000);

  it('plays the Southwest on arid scrub instead of oak woods and corn', () => {
    for (const regionId of ['US-AZ', 'US-NV', 'US-NM', 'US-TX', 'US-OK']) expect(countyEnvironment(regionById(regionId)!, 2).biomeId, regionId).toBe('arid-scrub');
    expect(countyEnvironment(regionById('US-IA')!, 1).biomeId).toBe('agricultural-plain');
  });
});
