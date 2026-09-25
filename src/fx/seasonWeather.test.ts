import { describe, expect, it } from 'vitest';
import { SeasonWeather } from './seasonWeather';

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
