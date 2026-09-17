import { describe, expect, it, beforeEach } from 'vitest';
import { applyPwaUpdate, onPwaUpdate, pwaUpdatePending, resetPwaUpdateForTests, setPwaUpdateHandler, setPwaUpdatePending } from './update';

describe('PWA update prompt', () => {
  beforeEach(() => {
    resetPwaUpdateForTests();
  });

  it('notifies existing and future listeners when a waiting worker is ready', () => {
    const seen: boolean[] = [];
    const stop = onPwaUpdate(pending => { seen.push(pending); });
    expect(seen).toEqual([false]);
    expect(pwaUpdatePending()).toBe(false);
    setPwaUpdatePending(true);
    expect(pwaUpdatePending()).toBe(true);
    expect(seen).toEqual([false, true]);
    stop();
    setPwaUpdatePending(false);
    expect(seen).toEqual([false, true]);
  });

  it('applies a waiting worker only when the operator asks', async () => {
    let applied = 0;
    setPwaUpdateHandler(async () => { applied += 1; });
    setPwaUpdatePending(true);
    expect(applied).toBe(0);
    await applyPwaUpdate();
    expect(applied).toBe(1);
  });
});
