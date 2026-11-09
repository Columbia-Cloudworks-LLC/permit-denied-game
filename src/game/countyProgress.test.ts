import { describe, expect, it } from 'vitest';
import { CountyProgress, resetSharedCountyProgress, sharedCountyProgress, type ProgressStore } from './countyProgress';

function memoryStore(initial: Record<string, string> = {}): ProgressStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
}

describe('county progress', () => {
  it('opens every county in Sandbox and gates the capitol in Time Challenge', () => {
    const progress = new CountyProgress(memoryStore());
    for (let index = 1; index <= 7; index++) expect(progress.isUnlocked('sandbox', 'US-IL', index)).toBe(true);
    for (let index = 1; index <= 6; index++) expect(progress.isUnlocked('challenge', 'US-IL', index)).toBe(true);
    expect(progress.isUnlocked('challenge', 'US-IL', 7)).toBe(false);
    for (let index = 1; index <= 5; index++) progress.markCleared('US-IL', index);
    expect(progress.isUnlocked('challenge', 'US-IL', 7)).toBe(false);
    progress.markCleared('US-IL', 6);
    expect(progress.isUnlocked('challenge', 'US-IL', 7)).toBe(true);
    expect(progress.isUnlocked('challenge', 'US-IN', 7)).toBe(false);
  });

  it('persists clears per county and survives a reload', () => {
    const store = memoryStore();
    new CountyProgress(store).markCleared('CA-YT', 2);
    const reloaded = new CountyProgress(store);
    expect(reloaded.isCleared('CA-YT', 2)).toBe(true);
    expect(reloaded.clearedCount('CA-YT')).toBe(1);
    expect(reloaded.clearedCount('US-YT')).toBe(0);
  });

  it('starts clean on corrupt or unavailable storage', () => {
    expect(new CountyProgress(memoryStore({ 'permit-denied.county-progress.v1': '{oops' })).clearedCount('US-IL')).toBe(0);
    const throwing: ProgressStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const progress = new CountyProgress(throwing);
    progress.markCleared('US-IL', 1);
    expect(progress.isCleared('US-IL', 1)).toBe(true);
    expect(new CountyProgress(undefined).clearedCount('US-IL')).toBe(0);
  });

  it('shares one page record, so a clear outlives a failed write', () => {
    const failing: ProgressStore = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    const shared = resetSharedCountyProgress(failing);
    shared.markCleared('US-GA', 3);
    expect(sharedCountyProgress()).toBe(shared);
    expect(sharedCountyProgress().isCleared('US-GA', 3)).toBe(true);
    resetSharedCountyProgress();
  });

  it('sends Next Level to the next uncleared county, then the capitol, then ends', () => {
    const progress = new CountyProgress(memoryStore());
    progress.markCleared('US-TX', 3);
    expect(progress.nextChallengeCounty('US-TX', 3)).toBe(4);
    for (const index of [4, 5, 6]) progress.markCleared('US-TX', index);
    expect(progress.nextChallengeCounty('US-TX', 6)).toBe(1);
    progress.markCleared('US-TX', 1);
    progress.markCleared('US-TX', 2);
    expect(progress.nextChallengeCounty('US-TX', 2)).toBe(7);
    expect(progress.nextChallengeCounty('US-TX', 7)).toBeNull();
  });
});
