import { describe, expect, it, vi } from 'vitest';
import { analyticsPage, parseChoice, safeReferrer } from './state';
import { RunAnalytics } from './privacy';

describe('analytics privacy boundary', () => {
  it('requires the explicit adult choice, rejecting stale and malformed values', () => {
    for (const value of [null, '', 'true', 'allowed', '13', '{}']) expect(parseChoice(value)).toBeNull();
    expect(parseChoice('adult-allowed')).toBe('adult-allowed');
    expect(parseChoice('declined')).toBe('declined');
  });
  it('reports only authored paths and never query strings or fragments', () => {
    expect(analyticsPage('https://permitdenied.app/catalog/?q=email@example.com&asset=x#secret')).toBe('https://permitdenied.app/catalog/');
    expect(analyticsPage('https://permitdenied.app/?mode=challenge&district=d30&seed=120')).toBe('https://permitdenied.app/');
    expect(analyticsPage('https://www.permitdenied.app/privacy/')).toBe('https://permitdenied.app/privacy');
    for (const url of ['http://localhost:5178/', 'https://preview.vercel.app/', 'https://permitdenied.app/user@example.com', 'http://permitdenied.app/']) expect(analyticsPage(url)).toBeNull();
  });
  it('excludes diagnostic worlds even when a flag is malformed', () => {
    for (const flag of ['capture', 'yard', 'testAsset', 'demo', 'tower', 'ranch', 'perf', 'nhood']) expect(analyticsPage('https://permitdenied.app/?' + flag + '=0')).toBeNull();
  });
  it('guards the separate external referrer field', () => {
    const origin = 'https://permitdenied.app';
    expect(safeReferrer('', origin)).toBe(true);
    expect(safeReferrer('https://example.com/', origin)).toBe(true);
    for (const url of ['https://example.com/private', 'https://example.com/?secret=x', 'https://example.com/#secret', 'bad']) expect(safeReferrer(url, origin)).toBe(false);
  });
});
describe('run events', () => {
  it('starts on active play, engages once at 60 active seconds, and finishes once', () => {
    const emit = vi.fn(), run = new RunAnalytics(emit, () => true);
    expect(emit).not.toHaveBeenCalled();
    for (let i = 0; i < 61; i++) run.step(1, 'challenge', 'd10');
    run.finish(true); run.finish(true);
    expect(emit.mock.calls).toEqual([
      ['game_started', { mode: 'challenge', district: 'd10' }],
      ['game_engaged', { mode: 'challenge', district: 'd10' }],
      ['game_finished', { outcome: 'won', duration_seconds: 61 }],
    ]);
  });
  it('does not backfill inactive time and restarts only a begun run', () => {
    const emit = vi.fn(); let enabled = false;
    const run = new RunAnalytics(emit, () => enabled);
    run.reset(true); run.step(100, 'sandbox', 'd10'); expect(emit).not.toHaveBeenCalled();
    enabled = true; run.step(30, 'sandbox', 'd10');
    enabled = false; run.step(500, 'sandbox', 'd10');
    enabled = true; run.step(29, 'sandbox', 'd10');
    expect(emit).toHaveBeenCalledTimes(1);
    run.reset(true); run.step(1, 'sandbox', 'd10');
    expect(emit.mock.calls.map(c => c[0])).toEqual(['game_started', 'game_restarted', 'game_started']);
  });
});
