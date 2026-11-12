import { describe, expect, it } from 'vitest';
import { CLIMATE_IDS, CLIMATES, climateHazard, legalConditions } from '../world/climate';
import { SEASONS, WEATHER_CONDITIONS } from '../world/season';
import { settleRun } from './career';
import { hazardPayLabel, weatherRisk } from './weatherRisk';
import { createDozer, stepDozer } from '../vehicle/dozer';

const SONORAN = CLIMATES['sonoran-desert'];
const GULF = CLIMATES['gulf-subtropical'];

describe('Time Challenge weather stakes', () => {
  it('prices each condition: rain and fog +10%, storms +20%, clear and overcast baseline', () => {
    expect(weatherRisk('spring', 'precip')).toEqual({ slip: 0.09, track: 0, heat: 0, hazardPay: 0.1 });
    expect(weatherRisk('winter', 'precip').hazardPay).toBe(0.1);
    expect(weatherRisk('autumn', 'storm')).toEqual({ slip: 0.15, track: 0.12, heat: 0, hazardPay: 0.2 });
    expect(weatherRisk('winter', 'storm').slip).toBe(0.15);
    expect(weatherRisk('summer', 'fog')).toEqual({ slip: 0, track: 0, heat: 0, hazardPay: 0.1 });
    expect(weatherRisk('summer', 'overcast')).toEqual({ slip: 0, track: 0, heat: 0, hazardPay: 0 });
    expect(weatherRisk('summer', undefined).hazardPay).toBe(0);
  });

  it('keeps the temperate table identical with or without an explicit climate, so recorded runs replay', () => {
    for (const season of SEASONS) for (const condition of ['clear', 'overcast', 'precip', 'storm', 'fog'] as const) {
      expect(weatherRisk(season, condition, CLIMATES.temperate)).toEqual(weatherRisk(season, condition));
    }
    // A winter storm is a blizzard by name and a storm by price.
    expect(climateHazard(CLIMATES.temperate, 'winter', 'storm')).toBe('blizzard');
    expect(weatherRisk('winter', 'storm')).toEqual({ slip: 0.15, track: 0.12, heat: 0, hazardPay: 0.2 });
  });

  it('adds mild engine heat on a clear summer day, at baseline pay', () => {
    for (const season of SEASONS) for (const condition of ['clear', 'overcast', 'precip', 'storm', 'fog'] as const) {
      const risk = weatherRisk(season, condition);
      expect(risk.heat).toBe(season === 'summer' && condition === 'clear' ? 0.08 : 0);
      if (risk.heat) expect(risk.hazardPay).toBe(0);
      expect(risk.slip).toBeLessThanOrEqual(0.15);
    }
  });

  it('pays for a haboob: no slip, dust in the filter and tracks, +20%', () => {
    const haboob = weatherRisk('summer', 'dust', SONORAN);
    expect(haboob).toEqual({ slip: 0, track: 0.08, heat: 0.1, hazardPay: 0.2 });
    expect(hazardPayLabel(haboob)).toBe('+20% HAZARD PAY');
    // Outside the desert the same sky is plain blowing dust: milder, and paid less.
    const plains = weatherRisk('spring', 'dust', CLIMATES['great-plains']);
    expect(plains.hazardPay).toBeGreaterThan(0);
    expect(plains.hazardPay).toBeLessThan(haboob.hazardPay);
    expect(plains.heat).toBeLessThan(haboob.heat);
  });

  it('makes a monsoon the slickest ground in the game, and a Gulf squall worse than a storm', () => {
    const storm = weatherRisk('summer', 'storm');
    const monsoon = weatherRisk('summer', 'storm', SONORAN);
    const squall = weatherRisk('summer', 'storm', GULF);
    expect(monsoon.slip).toBeGreaterThan(squall.slip);
    expect(squall.slip).toBeGreaterThan(storm.slip);
    expect(monsoon.hazardPay).toBeGreaterThan(storm.hazardPay);
    expect(squall.hazardPay).toBeGreaterThanOrEqual(storm.hazardPay);
    expect(hazardPayLabel(monsoon)).toBe('+25% HAZARD PAY');
  });

  it('makes extreme heat a real thermal hazard that pays, well past a clear summer day', () => {
    const heat = weatherRisk('summer', 'heat', SONORAN);
    expect(heat.heat).toBeGreaterThanOrEqual(weatherRisk('summer', 'clear', SONORAN).heat * 2.5);
    expect(heat.hazardPay).toBeGreaterThan(0);
    expect(heat.slip).toBe(0);
    expect(hazardPayLabel(heat)).toBe('+15% HAZARD PAY');
  });

  it('charges no snow or ice slip anywhere snow cannot fall', () => {
    for (const id of CLIMATE_IDS) {
      const climate = CLIMATES[id];
      if (climate.allowsSnow) continue;
      for (const condition of WEATHER_CONDITIONS) {
        const risk = weatherRisk('winter', condition, climate);
        if (condition !== 'precip' && condition !== 'storm') expect(risk.slip, `${id} ${condition}`).toBe(0);
        expect(climateHazard(climate, 'winter', condition)).not.toBe('blizzard');
      }
    }
    // The low desert cannot even roll a winter storm.
    expect(legalConditions(SONORAN, 'winter')).not.toContain('storm');
  });

  it('leaves no snowless zone hazard-free: each one rolls a paying hazard in some season', () => {
    for (const id of CLIMATE_IDS) {
      const climate = CLIMATES[id];
      if (climate.allowsSnow) continue;
      const paying = SEASONS.flatMap(season => legalConditions(climate, season)
        .filter(condition => climateHazard(climate, season, condition) && weatherRisk(season, condition, climate).hazardPay > 0));
      expect(paying.length, id).toBeGreaterThan(0);
    }
  });

  it('labels the badge only when the weather pays', () => {
    expect(hazardPayLabel(weatherRisk('summer', 'storm'))).toBe('+20% HAZARD PAY');
    expect(hazardPayLabel(weatherRisk('winter', 'precip'))).toBe('+10% HAZARD PAY');
    expect(hazardPayLabel(weatherRisk('summer', 'clear'))).toBe('');
  });

  it('folds Hazard Pay into settled escrow in Time Challenge and never in Sandbox', () => {
    const base = { outcome: 'win', escrow: 5000, timeRemaining: 0, replay: false, capitolFirstClear: false } as const;
    const dry = settleRun({ ...base, mode: 'challenge' });
    const storm = settleRun({ ...base, mode: 'challenge', hazardPay: 0.2 });
    expect(dry.hazard).toBe(0);
    expect(storm.hazard).toBe(1000);
    expect(storm.payout - dry.payout).toBe(1000);
    expect(storm.label).toContain('hazard pay +$1,000');
    expect(settleRun({ ...base, mode: 'challenge', outcome: 'fail', hazardPay: 0.2 }).payout).toBe(Math.floor(0.2 * 6000));
    const sandbox = settleRun({ ...base, mode: 'sandbox', hazardPay: 0.2 });
    expect(sandbox.hazard).toBe(0);
    expect(sandbox.payout).toBe(1250);
    const monsoon = settleRun({ ...base, mode: 'challenge', hazardPay: weatherRisk('summer', 'storm', SONORAN).hazardPay });
    expect(monsoon.hazard).toBe(1250);
  });

  it('lets a slick surface carry more sideways slide through a turn', () => {
    const slide = (grip: number) => {
      const dozer = createDozer(0, 0, 0);
      dozer.vx = 0; dozer.vy = 4;
      for (let i = 0; i < 12; i++) stepDozer(dozer, { throttle: 0, steer: 0, blade: false, grip }, 1 / 60);
      return Math.abs(dozer.vy);
    };
    expect(slide(0.85)).toBeGreaterThan(slide(1));
    expect(slide(1)).toBeGreaterThan(0);
    // Monsoon mud wash slides further than a temperate storm.
    expect(slide(1 - weatherRisk('summer', 'storm', SONORAN).slip)).toBeGreaterThan(slide(1 - weatherRisk('summer', 'storm').slip));
  });
});
