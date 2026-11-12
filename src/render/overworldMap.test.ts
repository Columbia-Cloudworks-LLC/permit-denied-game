// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { WEATHER_CONDITIONS, type SeasonId, type WeatherConditionId } from '../world/season';
import { pathBox, scribbleCircle } from './overworldMap';

it('measures a path in the atlas compact form', () => {
  expect(pathBox('M202 122l36 0 0 36-36 0z')).toEqual([202, 122, 238, 158]);
  expect(pathBox('M10 10l5-.5 .5 5zM-4 2l1 1-2 3z')).toEqual([-5, 2, 15.5, 14.5]);
  expect(pathBox('')).toEqual([0, 0, 0, 0]);
});

it('scrawls a repeatable loop that rings the box and overshoots its own start', () => {
  const box = [100, 100, 140, 120] as const;
  const d = scribbleCircle(box, 'US-CO', 4);
  expect(scribbleCircle(box, 'US-CO', 4)).toBe(d);
  expect(scribbleCircle(box, 'US-WY', 4)).not.toBe(d);
  const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const points = [];
  // The move, then the end point of each cubic segment.
  for (let i = 0; i < numbers.length; i += i === 0 ? 2 : 6) points.push([numbers[i === 0 ? 0 : i + 4]!, numbers[i === 0 ? 1 : i + 5]!]);
  const angles = points.map(([x, y]) => Math.atan2(y! - 110, x! - 120));
  let swept = 0;
  for (let i = 1; i < angles.length; i++) {
    let step = angles[i]! - angles[i - 1]!;
    if (step < -Math.PI) step += Math.PI * 2;
    swept += step;
  }
  expect(swept).toBeGreaterThan(Math.PI * 2.2);
  // Every point stays outside the box's inner half and within a sane reach of it.
  for (const [x, y] of points) {
    const r = Math.hypot((x! - 120) / 20, (y! - 110) / 10);
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(1.7);
  }
});

it('keeps a tiny region findable with a minimum loop size', () => {
  const d = scribbleCircle([50, 50, 50.4, 50.2], 'US-RI', 8);
  const xs = d.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(13);
});

it('gives each region its own sheet of paper, and never the atlas paper', async () => {
  const { ATLAS_PAPER, sheetPaper } = await import('./overworldMap');
  const { REGIONS } = await import('../world/regions');
  const looks = new Set(REGIONS.map(region => JSON.stringify(sheetPaper(region.id))));
  // Two photographs, each mirrored four ways.
  expect(looks.size).toBe(8);
  for (const region of REGIONS) {
    expect(sheetPaper(region.id)).toEqual(sheetPaper(region.id));
    expect(sheetPaper(region.id).href).not.toBe(ATLAS_PAPER.href);
  }
});

describe('county climate parity', () => {
  const FROZEN = /snow|blizzard|frost|\bice\b|freez/i;
  const FROZEN_ICON = /data-menu-icon="weather-(snow|blizzard)"/;
  // The snowflake glyph, however it is wrapped.
  const SNOWFLAKE = 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9';
  const load = async () => {
    const map = await import('./overworldMap');
    const { regionById } = await import('../world/regions');
    const { countyClimate } = await import('../world/regionClimate');
    const { sharedCountyProgress } = await import('../game/countyProgress');
    const { schematicAtlas } = await import('../world/atlas');
    const { REGIONS } = await import('../world/regions');
    return { ...map, regionById, countyClimate, progress: sharedCountyProgress(), atlas: schematicAtlas(REGIONS) };
  };
  const view = (season: SeasonId, selected: number, weather: WeatherConditionId, kind: 'challenge' | 'sandbox' = 'challenge') =>
    ({ kind, season, selected, weather: () => weather });

  it('offers a Sonoran winter no snow, blizzard or ice: in the bar, the tooltips and the loading card', async () => {
    const { sheetBarHtml, splashHtml, atlasSheetHtml, countyConditions, regionById, countyClimate, progress, atlas } = await load();
    const arizona = regionById('US-AZ')!;
    expect(countyClimate('US-AZ', 2).id).toBe('sonoran-desert');
    const offered = countyConditions('US-AZ', 2, 'winter');
    expect(offered).not.toContain('storm');
    expect(offered).toContain('dust');
    for (const weather of [...offered, ...WEATHER_CONDITIONS]) {
      const bar = sheetBarHtml(arizona, progress, view('winter', 2, weather), { current: false, replacing: false });
      expect(bar, weather).not.toMatch(FROZEN);
      expect(bar).not.toMatch(FROZEN_ICON);
      expect(bar).not.toContain(SNOWFLAKE);
      const splash = splashHtml(arizona, 2, 'challenge', 'winter', weather);
      expect(splash).not.toMatch(FROZEN);
      expect(splash).not.toContain(SNOWFLAKE);
      expect(splash).toContain('Winter');
    }
    // County 2's tooltip on the sheet never reads Snow, even with precipitation.
    const sheet = atlasSheetHtml(atlas, arizona, [arizona], progress, view('winter', 2, 'precip'), 'on', { current: false, replacing: false });
    const tip = /data-county-index="2"[^>]*aria-label="([^"]+)"/.exec(sheet)![1]!;
    expect(tip).toContain('Rain');
    expect(tip).not.toMatch(FROZEN);
    expect(sheet).toContain('Sonoran Desert');
  });

  it('shows dust, monsoon and heat indicators with their hazard pay when active', async () => {
    const { sheetBarHtml, splashHtml, regionById, progress } = await load();
    const arizona = regionById('US-AZ')!;
    const bar = (weather: WeatherConditionId, kind: 'challenge' | 'sandbox' = 'challenge') =>
      sheetBarHtml(arizona, progress, view('summer', 2, weather, kind), { current: false, replacing: false });
    expect(bar('dust')).toContain('data-weather="dust"');
    expect(bar('dust')).toContain('data-menu-icon="weather-dust"');
    expect(bar('dust')).toContain('Haboob');
    expect(bar('dust')).toContain('+20% HAZARD PAY');
    expect(bar('storm')).toContain('data-menu-icon="weather-monsoon"');
    expect(bar('storm')).toContain('Monsoon');
    expect(bar('storm')).toContain('+25% HAZARD PAY');
    expect(bar('heat')).toContain('data-menu-icon="weather-heat"');
    expect(bar('heat')).toContain('Extreme Heat');
    expect(bar('heat')).toContain('+15% HAZARD PAY');
    // Sandbox keeps the indicator and drops the pay.
    expect(bar('heat', 'sandbox')).toContain('data-menu-icon="weather-heat"');
    expect(bar('heat', 'sandbox')).not.toContain('HAZARD PAY');
    expect(splashHtml(arizona, 2, 'challenge', 'summer', 'dust')).toContain('Haboob');
    // A Gulf county's summer storm is a squall.
    const texas = regionById('US-TX')!;
    const gulf = sheetBarHtml(texas, progress, view('summer', 3, 'storm'), { current: false, replacing: false });
    expect(gulf).toContain('Squall');
    expect(gulf).toContain('data-menu-icon="weather-squall"');
  });

  it('keeps snow, blizzards and the snowflake in cold counties, the Arizona high country included', async () => {
    const { sheetBarHtml, splashHtml, atlasSheetHtml, countyConditions, regionById, countyClimate, progress, atlas } = await load();
    for (const [regionId, index] of [['US-MI', 3], ['US-MN', 2], ['CA-ON', 4], ['US-CO', 1], ['US-AZ', 1]] as const) {
      const region = regionById(regionId)!;
      expect(countyClimate(regionId, index).allowsSnow, regionId).toBe(true);
      expect(countyConditions(regionId, index, 'winter')).toEqual(expect.arrayContaining(['precip', 'storm']));
      const run = { current: false, replacing: false };
      const snow = sheetBarHtml(region, progress, view('winter', index, 'precip'), run);
      expect(snow).toContain('data-menu-icon="weather-snow"');
      expect(snow).toContain('>Snow<');
      expect(snow).toContain('+10% HAZARD PAY');
      const blizzard = sheetBarHtml(region, progress, view('winter', index, 'storm'), run);
      expect(blizzard).toContain('data-menu-icon="weather-blizzard"');
      expect(blizzard).toContain('>Blizzard<');
      expect(splashHtml(region, index, 'challenge', 'winter', 'precip')).toContain(SNOWFLAKE);
      expect(atlasSheetHtml(atlas, region, [region], progress, view('winter', index, 'precip'), 'on', run)).toContain(SNOWFLAKE);
      // Summer never shows any of it.
      expect(sheetBarHtml(region, progress, view('summer', index, 'precip'), run)).not.toMatch(FROZEN);
    }
  });

  it('drops the snowflake from a wholly snowless state sheet', async () => {
    const { atlasSheetHtml, regionById, countyClimate, progress, atlas } = await load();
    for (const regionId of ['US-HI', 'US-FL'] as const) {
      const region = regionById(regionId)!;
      for (let index = 1; index <= 7; index++) expect(countyClimate(regionId, index).allowsSnow, `${regionId} ${index}`).toBe(false);
      const sheet = atlasSheetHtml(atlas, region, [region], progress, view('winter', 1, 'precip'), 'on', { current: false, replacing: false });
      expect(sheet).not.toContain(SNOWFLAKE);
      expect(sheet).not.toMatch(FROZEN);
      expect(sheet).toContain('Winter');
    }
  });

  it('keeps a running county\'s forced sky listed even when its climate would not roll it', async () => {
    const { countyConditions } = await load();
    expect(countyConditions('US-AZ', 2, 'winter', 'storm')).toContain('storm');
    expect(countyConditions('US-AZ', 2, 'winter', 'clear')).toEqual(countyConditions('US-AZ', 2, 'winter'));
  });
});
