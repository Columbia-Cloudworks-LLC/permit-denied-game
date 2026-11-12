import { describe, expect, it } from 'vitest';
import { CLIMATES } from '../world/climate';
import { weatherPresetFor, type WeatherKind } from '../world/season';
import { hazeVeil, SeasonWeather, windHeading } from './seasonWeather';

describe('season weather lifecycle', () => {
  const input = {dt:1/60,kind:'flurries' as const,detail:'on' as const,camX:0,camY:0,seed:19};
  const run = (weather:SeasonWeather, frames=120) => {for(let i=0;i<frames;i++) weather.step(input);return structuredClone(weather.flakes);};
  it('replays a separate seeded stream after restarting the same town', () => {
    const a = new SeasonWeather(), b = new SeasonWeather();
    const first=run(a); expect(first.length).toBeGreaterThan(0); expect(run(b)).toEqual(first);
    a.reset(''); expect(run(a)).toEqual(first);
  });
  it('bounds long runs and releases particles on detail and camera changes', () => {
    const weather=new SeasonWeather();
    for(let i=0;i<36000;i++) {weather.step(input);expect(weather.flakes.length).toBeLessThanOrEqual(36);}
    weather.step({...input,camX:100});expect(weather.flakes.every(f=>Math.hypot(f.x-100,f.y)<=16)).toBe(true);
    weather.step({...input,detail:'off'});expect(weather.flakes).toEqual([]);
    run(weather); weather.step({...input,detail:'reduced'});expect(weather.flakes).toEqual([]);
  });
});

describe('arid and subtropical weather beds', () => {
  const base = { dt: 1 / 60, detail: 'on' as const, camX: 0, camY: 0, seed: 19 };
  const run = (kind: WeatherKind, intensity: number, frames = 240, seed = 19) => {
    const weather = new SeasonWeather();
    for (let i = 0; i < frames; i++) weather.step({ ...base, seed, kind, intensity });
    return weather.flakes;
  };

  it('streaks haboob dust along one seeded wind, with faster gust grit among the sheets', () => {
    const wind = windHeading(19);
    expect(windHeading(19)).toBe(wind);
    expect(windHeading(20)).not.toBe(wind);
    const flakes = run('dust', 2.2);
    expect(flakes.length).toBeGreaterThan(20);
    for (const flake of flakes) {
      expect(flake.kind).toBe('dust');
      expect(flake.heading).toBe(wind);
      // Every flake travels down the wind: its ground velocity points along the heading.
      const speed = Math.hypot(flake.vx, flake.vy);
      expect(flake.vx / speed).toBeCloseTo(Math.cos(wind), 6);
      expect(flake.vy / speed).toBeCloseTo(Math.sin(wind), 6);
      // Sheets blow sideways far faster than they settle.
      expect(speed).toBeGreaterThan(Math.abs(flake.vz) * 5);
    }
    const sheets = flakes.filter(f => f.len > 1), gusts = flakes.filter(f => f.len < 1);
    expect(sheets.length).toBeGreaterThan(gusts.length);
    expect(gusts.length).toBeGreaterThan(0);
    const mean = (list: typeof flakes) => list.reduce((sum, f) => sum + Math.hypot(f.vx, f.vy), 0) / list.length;
    expect(mean(gusts)).toBeGreaterThan(mean(sheets));
    // Another town's wind blows another way.
    expect(run('dust', 2.2, 60, 20)[0]!.heading).toBe(windHeading(20));
  });

  it('pours a monsoon denser and steeper than rain', () => {
    const rain = run('rain', 1), downpour = run('downpour', 3);
    expect(downpour.length).toBeGreaterThan(rain.length * 1.5);
    const fall = (list: typeof rain) => Math.min(...list.map(f => f.vz));
    expect(fall(downpour)).toBeLessThan(fall(rain) * 2);
    expect(downpour.every(f => f.len > 1 && f.kind === 'downpour')).toBe(true);
  });

  it('keeps heat shimmer to a few low bands with no precipitation', () => {
    const shimmer = run('shimmer', 1);
    expect(shimmer.length).toBeGreaterThan(0);
    expect(shimmer.length).toBeLessThanOrEqual(15);
    for (const flake of shimmer) {
      // Bands hug the ground and rise; nothing falls.
      expect(flake.z).toBeLessThan(1);
      expect(flake.vz).toBeGreaterThan(0);
    }
  });

  it('holds every new bed under its cap and replays it from the key', () => {
    for (const [kind, intensity, cap] of [['dust', 2.2, 79], ['downpour', 3, 130], ['shimmer', 1, 14]] as const) {
      const weather = new SeasonWeather();
      for (let i = 0; i < 6000; i++) {
        weather.step({ ...base, kind, intensity });
        expect(weather.flakes.length).toBeLessThanOrEqual(cap);
      }
      expect(structuredClone(run(kind, intensity))).toEqual(structuredClone(run(kind, intensity)));
      for (const detail of ['reduced', 'off'] as const) {
        weather.step({ ...base, kind, intensity, detail });
        expect(weather.flakes).toEqual([]);
      }
    }
  });

  it('leaves the legacy snow stream untouched by the new beds', () => {
    const flurries = run('flurries', 1, 120);
    expect(flurries.every(f => f.len === 1 && f.vz < 0)).toBe(true);
  });
});

describe('haze veil', () => {
  const haboob = weatherPresetFor('summer', 'dust', CLIMATES['sonoran-desert']);
  const heat = weatherPresetFor('summer', 'heat', CLIMATES['sonoran-desert']);
  const fog = weatherPresetFor('autumn', 'fog');
  const clear = weatherPresetFor('summer', 'clear');

  it('closes a haboob in with distance, in ochre', () => {
    const veil = hazeVeil(haboob, 'on')!;
    expect(veil.color).toBe(haboob.hazeTint);
    // Clearer at the dozer than a fog bank, far thicker at the edge of the view.
    expect(veil.alpha).toBeLessThan(hazeVeil(fog, 'on')!.alpha);
    expect(veil.alpha + veil.edge).toBeGreaterThan(hazeVeil(fog, 'on')!.alpha * 2);
    const blowing = hazeVeil(weatherPresetFor('spring', 'dust', CLIMATES['great-plains']), 'on')!;
    expect(blowing.edge).toBeLessThan(veil.edge);
  });

  it('keeps fog a uniform veil and a clear day bare', () => {
    expect(hazeVeil(fog, 'on')).toEqual({ color: fog.light, alpha: fog.haze * 0.9, edge: 0 });
    expect(hazeVeil(clear, 'on')).toBeNull();
  });

  it('gives heat only a faint warm rim', () => {
    const veil = hazeVeil(heat, 'on')!;
    expect(veil.alpha).toBe(0);
    expect(veil.edge).toBeGreaterThan(0);
    expect(veil.edge).toBeLessThan(0.15);
  });

  it('halves under reduced effects and vanishes when off', () => {
    const on = hazeVeil(haboob, 'on')!, reduced = hazeVeil(haboob, 'reduced')!;
    expect(reduced.alpha).toBeCloseTo(on.alpha / 2);
    expect(reduced.edge).toBeCloseTo(on.edge / 2);
    expect(hazeVeil(haboob, 'off')).toBeNull();
    expect(hazeVeil(fog, 'off')).toBeNull();
  });
});
