import { describe, expect, it } from 'vitest';
import { SEASONS, WEATHER_CONDITIONS } from '../world/season';
import { settleRun } from './career';
import { hazardPayLabel, weatherRisk } from './weatherRisk';
import { createDozer, stepDozer } from '../vehicle/dozer';

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

  it('adds engine heat only on a clear summer day, at baseline pay', () => {
    for (const season of SEASONS) for (const condition of WEATHER_CONDITIONS) {
      const risk = weatherRisk(season, condition);
      expect(risk.heat).toBe(season === 'summer' && condition === 'clear' ? 0.08 : 0);
      if (risk.heat) expect(risk.hazardPay).toBe(0);
      expect(risk.slip).toBeLessThanOrEqual(0.15);
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
  });
});
