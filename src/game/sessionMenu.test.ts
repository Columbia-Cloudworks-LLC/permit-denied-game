import { describe, expect, it } from 'vitest';
import { DEFAULT_DISTRICT_SEEDS, gameSetupRules, nextSeed, parseSessionFromSearch, playableDistrict, startsAtTitle } from './session';

describe('operator menu entry', () => {
  it('keeps the development yard out of normal sandbox setup', () => {
    expect(playableDistrict('sandbox', 'classic')).toBe('d10');
    expect(playableDistrict('challenge', 'classic')).toBe('classic');
    expect(gameSetupRules('sandbox', 'classic', 'standard', 19)).toEqual({
      kind: 'sandbox', district: 'd10', seed: DEFAULT_DISTRICT_SEEDS.d10, ranchFocus: false,
    });
  });

  it('starts standard layouts independently of the previous seed and advances randomized layouts once', () => {
    expect(gameSetupRules('challenge', 'd30', 'standard', 19).seed).toBe(DEFAULT_DISTRICT_SEEDS.d30);
    const randomized = gameSetupRules('challenge', 'd30', 'randomized', 19);
    expect(randomized.seed).toBe(nextSeed(19));
    expect(randomized).not.toHaveProperty('job');
    expect(randomized).not.toHaveProperty('demo');
    expect(randomized).not.toHaveProperty('towerTest');
  });
  it('shows the title on normal visits, including touch previews and tracking links', () => {
    for (const query of ['', '?controls=1', '?utm_source=friend']) expect(startsAtTitle(query)).toBe(true);
  });

  it('keeps documented scenario and diagnostic links playable immediately', () => {
    for (const query of ['?sandbox=1&district=d100', '?sandbox=1&ranch=1', '?perf=1', '?tower=1', '?job=brick', '?demo=steel-warehouse', '?seed=19', '?nhood=1']) {
      expect(startsAtTitle(query)).toBe(false);
    }
    expect(parseSessionFromSearch('?sandbox=1&district=d100')).toMatchObject({kind: 'sandbox', district: 'd100'});
    expect(parseSessionFromSearch('?job=brick')).toMatchObject({job: true, demo: 'rivertown'});
  });
});
