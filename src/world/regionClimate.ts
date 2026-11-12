import type { BiomeId } from './biomes';
import { classifyClimate, CLIMATES, type Bedrock, type ClimateEnvelope, type ClimateGeography } from './climate';

/**
 * Where each region's counties sit: latitude, elevation, aridity, maritime influence and bedrock.
 * `classifyClimate` turns a county's geography into its climate zone, so snow, hazards, flora and
 * regional dress all follow from this table and never from a state name. Lives in the lazy
 * overworld chunk with the region manifest.
 *
 * A row is the region's settled heartland. `counties` moves individual counties to the region's
 * other country: a low-desert state's plateau county, a coastal state's desert or mountain county.
 */
type Geo = readonly [latitude: number, elevation: number, aridity: number, maritime: number, bedrock: Bedrock];

interface RegionGeography {
  base: Geo;
  /** County index (1–7) to its own geography. */
  counties?: Readonly<Record<number, Geo>>;
}

const row = (base: Geo, counties?: Readonly<Record<number, Geo>>): RegionGeography => ({ base, counties });

const REGION_GEOGRAPHY: Readonly<Record<string, RegionGeography>> = {
  'US-AL': row([32.8, 120, 0.2, 0.35, 'alluvium'], { 2: [30.6, 10, 0.15, 0.7, 'alluvium'] }),
  'US-AK': row([61, 100, 0.3, 0.45, 'granite'], { 1: [64.8, 150, 0.4, 0.05, 'granite'] }),
  // Sonoran low desert, with the Colorado Plateau county up at Flagstaff height.
  'US-AZ': row([33.2, 380, 0.95, 0.05, 'granite'], { 1: [35.6, 1900, 0.75, 0, 'sandstone'], 2: [32.4, 720, 0.92, 0.05, 'granite'] }),
  'US-AR': row([34.8, 130, 0.22, 0.2, 'alluvium']),
  // Coastal basin heartland; a Sierra county, a Mojave county and a Central Valley capitol.
  'US-CA': row([34, 60, 0.6, 0.9, 'alluvium'], { 1: [38.8, 1850, 0.35, 0.3, 'granite'], 2: [34.9, 650, 1, 0.05, 'granite'], 7: [38.5, 20, 0.55, 0.6, 'alluvium'] }),
  'US-CO': row([39.7, 1650, 0.5, 0, 'granite'], { 1: [38.3, 1400, 0.72, 0, 'sandstone'], 2: [39.5, 2600, 0.4, 0, 'granite'] }),
  'US-CT': row([41.6, 60, 0.25, 0.4, 'granite']),
  'US-DE': row([39.1, 15, 0.25, 0.3, 'alluvium']),
  'US-FL': row([28.2, 15, 0.15, 0.8, 'limestone'], { 7: [30.4, 40, 0.15, 0.6, 'limestone'] }),
  'US-GA': row([33.2, 220, 0.2, 0.3, 'granite'], { 2: [31.2, 10, 0.15, 0.6, 'alluvium'] }),
  'US-HI': row([21.3, 30, 0.2, 1, 'volcanic']),
  'US-ID': row([43.6, 830, 0.55, 0.05, 'volcanic'], { 1: [44.4, 1800, 0.4, 0.05, 'granite'] }),
  'US-IL': row([40.2, 190, 0.3, 0.15, 'limestone']),
  'US-IN': row([39.8, 220, 0.3, 0.15, 'limestone']),
  'US-IA': row([41.9, 290, 0.35, 0.05, 'limestone']),
  'US-KS': row([38.5, 500, 0.5, 0, 'limestone']),
  'US-KY': row([37.6, 250, 0.25, 0.2, 'limestone']),
  'US-LA': row([30.3, 10, 0.12, 0.7, 'alluvium']),
  'US-ME': row([45.2, 120, 0.25, 0.45, 'granite']),
  'US-MD': row([39.2, 60, 0.25, 0.3, 'granite']),
  'US-MA': row([42.3, 60, 0.25, 0.45, 'granite']),
  'US-MI': row([43.4, 250, 0.3, 0.3, 'limestone']),
  'US-MN': row([45.2, 300, 0.35, 0.05, 'granite']),
  'US-MS': row([32.4, 90, 0.18, 0.35, 'alluvium'], { 2: [30.4, 10, 0.15, 0.7, 'alluvium'] }),
  'US-MO': row([38.5, 240, 0.3, 0.1, 'limestone']),
  'US-MT': row([46.8, 1100, 0.5, 0, 'granite'], { 1: [47.2, 900, 0.55, 0, 'limestone'], 2: [45.6, 1750, 0.4, 0, 'granite'] }),
  'US-NE': row([41.1, 600, 0.5, 0, 'limestone']),
  // Great Basin heartland; the roadside and downtown counties sit in the Mojave.
  'US-NV': row([39.5, 1350, 0.82, 0, 'granite'], { 2: [36.1, 620, 1, 0.05, 'granite'], 6: [36.2, 610, 1, 0.05, 'granite'] }),
  'US-NH': row([43.6, 250, 0.25, 0.3, 'granite']),
  'US-NJ': row([40.2, 40, 0.25, 0.4, 'alluvium']),
  // High-desert plateau; the roadside county drops to the Chihuahuan low desert.
  'US-NM': row([35.4, 1700, 0.8, 0, 'sandstone'], { 2: [32.3, 1190, 0.88, 0.05, 'limestone'] }),
  'US-NY': row([42.7, 200, 0.25, 0.3, 'granite']),
  'US-NC': row([35.6, 180, 0.22, 0.4, 'granite']),
  'US-ND': row([47, 550, 0.5, 0, 'limestone']),
  'US-OH': row([40.2, 260, 0.28, 0.2, 'limestone']),
  'US-OK': row([35.4, 380, 0.45, 0.05, 'sandstone'], { 2: [36.6, 1100, 0.72, 0, 'sandstone'] }),
  'US-OR': row([44.9, 60, 0.2, 0.8, 'volcanic'], { 1: [43.6, 1250, 0.72, 0, 'volcanic'] }),
  'US-PA': row([40.6, 300, 0.25, 0.25, 'limestone']),
  'US-RI': row([41.7, 30, 0.25, 0.5, 'granite']),
  'US-SC': row([33.8, 100, 0.2, 0.4, 'alluvium'], { 2: [32.8, 5, 0.15, 0.6, 'alluvium'] }),
  'US-SD': row([44.2, 500, 0.5, 0, 'limestone'], { 2: [43.8, 1000, 0.6, 0, 'granite'] }),
  'US-TN': row([36, 200, 0.22, 0.2, 'limestone']),
  // Central Texas heartland; South Texas brush, the Trans-Pecos desert and the Gulf coast get their own counties.
  'US-TX': row([30.6, 180, 0.4, 0.3, 'limestone'], { 1: [27.6, 60, 0.55, 0.45, 'alluvium'], 2: [31.2, 1100, 0.86, 0.05, 'limestone'], 3: [29.6, 10, 0.15, 0.7, 'alluvium'], 6: [32.8, 150, 0.35, 0.2, 'limestone'] }),
  // Wasatch Front heartland; the rural and roadside counties are red-rock canyon country.
  'US-UT': row([40.7, 1500, 0.6, 0, 'granite'], { 1: [38.4, 1250, 0.85, 0, 'sandstone'], 2: [37.3, 1300, 0.85, 0, 'sandstone'] }),
  'US-VT': row([44.2, 300, 0.25, 0.25, 'granite']),
  'US-VA': row([37.6, 150, 0.25, 0.3, 'granite']),
  'US-WA': row([47.3, 60, 0.2, 0.85, 'volcanic'], { 1: [47, 400, 0.6, 0.05, 'volcanic'] }),
  'US-WV': row([38.5, 500, 0.25, 0.15, 'limestone']),
  'US-WI': row([43.6, 280, 0.3, 0.2, 'limestone']),
  'US-WY': row([42.5, 1900, 0.55, 0, 'granite'], { 1: [43.5, 1500, 0.6, 0, 'sandstone'] }),
  'CA-AB': row([52.5, 750, 0.45, 0, 'limestone'], { 2: [51.2, 1500, 0.4, 0, 'granite'] }),
  'CA-BC': row([49.3, 60, 0.2, 0.85, 'granite'], { 1: [50.6, 400, 0.6, 0.1, 'volcanic'], 2: [51.2, 1500, 0.35, 0.1, 'granite'] }),
  'CA-MB': row([50, 250, 0.45, 0, 'limestone']),
  'CA-NB': row([46.2, 100, 0.25, 0.4, 'granite']),
  'CA-NL': row([48.6, 120, 0.25, 0.5, 'granite']),
  'CA-NS': row([44.8, 60, 0.25, 0.55, 'granite']),
  'CA-ON': row([43.8, 200, 0.28, 0.25, 'limestone'], { 1: [48.4, 300, 0.3, 0.1, 'granite'] }),
  'CA-PE': row([46.3, 30, 0.25, 0.55, 'sandstone']),
  'CA-QC': row([46.6, 150, 0.25, 0.2, 'granite'], { 1: [48.5, 300, 0.3, 0.1, 'granite'] }),
  'CA-SK': row([51, 550, 0.5, 0, 'limestone']),
  'CA-NT': row([62.4, 200, 0.4, 0.05, 'granite']),
  'CA-NU': row([63.7, 50, 0.45, 0.3, 'granite']),
  'CA-YT': row([60.7, 650, 0.4, 0.1, 'granite']),
};

const TEMPERATE_HEARTLAND: Geo = [41, 200, 0.3, 0.25, 'limestone'];

/** The geography of one county; an unknown region reads as the temperate heartland. */
export function countyGeography(regionId: string, countyIndex: number): ClimateGeography {
  const region = REGION_GEOGRAPHY[regionId];
  const [latitude, elevation, aridity, maritime, bedrock] = region?.counties?.[countyIndex] ?? region?.base ?? TEMPERATE_HEARTLAND;
  return { latitude, elevation, aridity, maritime, bedrock };
}

export function countyClimate(regionId: string, countyIndex: number): ClimateEnvelope {
  return CLIMATES[classifyClimate(countyGeography(regionId, countyIndex))];
}

/** The climate most of a region's counties share, for the region-level map. */
export function regionClimate(regionId: string): ClimateEnvelope {
  return CLIMATES[classifyClimate(countyGeography(regionId, 0))];
}

/**
 * The biome a county plays. A region's flavor biome stands where it suits the climate; a county
 * whose climate says desert, coast, prairie or mountain takes that zone's biome instead.
 */
export function countyBiome(regionId: string, countyIndex: number, flavorBiome: BiomeId): BiomeId {
  const climate = countyClimate(regionId, countyIndex);
  switch (climate.landscape) {
    case 'desert':
    case 'canyonlands':
    case 'subtropical':
    case 'alpine':
    case 'boreal':
      return climate.biome;
    case 'prairie':
      return 'agricultural-plain';
    case 'forest':
      // Wooded country keeps the flavor's own woods; a desert or coastal flavor biome does not follow a county inland.
      return flavorBiome === 'arid-scrub' || flavorBiome === 'subtropical-coast' ? climate.biome : flavorBiome;
    default: {
      const _never: never = climate.landscape;
      return _never;
    }
  }
}
