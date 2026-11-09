import { MODE_LABELS, SITE_LABELS } from './menuLabels';
import { describe, expect, it } from 'vitest';
import { countySeed } from '../world/counties';
import { resolveCountyLink } from './overworld';
import { DEFAULT_DISTRICT_SEEDS, gameSetupRules, nextSeed, parseSessionFromSearch, playableDistrict, startsAtTitle } from './session';

describe('operator menu entry', () => {
  it('defaults to sandbox and retires the seven-building map in both modes', () => {
    expect(parseSessionFromSearch('')).toMatchObject({kind:'sandbox',district:'d10',seed:DEFAULT_DISTRICT_SEEDS.d10});
    for (const kind of ['sandbox','challenge'] as const) {
      expect(playableDistrict(kind,'classic')).toBe('d10');
      expect(gameSetupRules(kind,'classic',19)).toEqual({kind,district:'d10',seed:nextSeed(19),ranchFocus:false,level:'county',season:'summer',seasonExplicit:false,weatherDetail:'on'});
      expect(parseSessionFromSearch('?mode='+kind+'&district=classic')).toMatchObject({kind,district:'d10',seed:DEFAULT_DISTRICT_SEEDS.d10});
    }
  });
  it('generates a fresh layout for each new game without carrying diagnostic scenarios', () => {
    const first=gameSetupRules('sandbox','d30',19);
    expect(first.seed).toBe(nextSeed(19));
    expect(gameSetupRules('sandbox','d30',first.seed).seed).toBe(nextSeed(first.seed));
    expect(first).not.toHaveProperty('job');
    expect(first).not.toHaveProperty('demo');
    expect(first).not.toHaveProperty('towerTest');
  });
  it('offers sandbox first, time challenge second, and only road-and-lot map sizes', () => {
    expect(Object.entries(MODE_LABELS)).toEqual([['sandbox','Sandbox'],['challenge','Time Challenge']]);
    expect(Object.keys(SITE_LABELS)).toEqual(['d10','d30','d100']);
    expect(parseSessionFromSearch('?yard=1')).toMatchObject({kind:'sandbox',district:'classic'});
    expect(startsAtTitle('?yard=1')).toBe(false);
  });
  it('opens an overworld county link on its level, seed, biome, and weather', () => {
    const link = (search: string) => { const rules = parseSessionFromSearch(search); resolveCountyLink(rules, search); return rules; };
    const rules = link('?mode=challenge&region=US-IL&county=3&season=winter&weather=storm');
    expect(rules).toMatchObject({ kind: 'challenge', regionId: 'US-IL', countyIndex: 3, level: 'township', seed: countySeed('US-IL', 3), season: 'winter', weather: 'storm', biomeId: 'agricultural-plain' });
    expect(link('?region=US-IL&county=3&seed=5&level=suburb')).toMatchObject({ seed: 5, level: 'suburb', countyIndex: 3 });
    expect(link('?region=US-ZZ&county=3')).not.toHaveProperty('regionId');
    expect(link('?region=illinois&county=3')).not.toHaveProperty('regionId');
    expect(link('?region=US-IL&county=9')).not.toHaveProperty('regionId');
    expect(parseSessionFromSearch('?yard=1&region=US-IL&county=2')).not.toHaveProperty('regionId');
    expect(parseSessionFromSearch('?weather=hail')).not.toHaveProperty('weather');
    expect(startsAtTitle('?region=US-IL&county=1')).toBe(false);
  });

  it('keeps legacy level links free of county flavor', () => {
    const rules = parseSessionFromSearch('?mode=challenge&level=city-downtown&nhood=1');
    expect(rules.level).toBe('city-downtown');
    expect(rules).not.toHaveProperty('regionId');
    expect(rules).not.toHaveProperty('weather');
  });

  it('shows the title on normal visits, including touch previews and tracking links', () => {
    for (const query of ['', '?controls=1', '?utm_source=friend']) expect(startsAtTitle(query)).toBe(true);
  });

  it('keeps documented scenario and diagnostic links playable immediately', () => {
    for (const query of ['?sandbox=1&district=d100', '?sandbox=1&ranch=1', '?perf=1', '?tower=1', '?job=brick', '?demo=steel-warehouse', '?seed=19', '?nhood=1']) {
      expect(startsAtTitle(query)).toBe(false);
    }
    expect(parseSessionFromSearch('?sandbox=1&district=d100')).toMatchObject({kind: 'sandbox', district: 'd100', level: 'city-downtown'});
    expect(parseSessionFromSearch('?job=brick')).toMatchObject({job: true, demo: 'rivertown'});
  });
});
