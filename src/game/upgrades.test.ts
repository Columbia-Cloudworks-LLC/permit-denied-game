import { describe, expect, it } from 'vitest';
import { upgradeModifiers, upgradePercent } from './upgrades';

describe('installed upgrade modifiers', () => {
  it.each([
    [{ blade: 0, engine: 0, push: 0 }, [1, 1, 1]],
    [{ blade: 1, engine: 1, push: 1 }, [1.42, 1.28, 1.35]],
    [{ blade: 2, engine: 2, push: 2 }, [1.84, 1.56, 1.70]],
    [{ blade: 3, engine: 1, push: 0 }, [2.26, 1.28, 1]],
    [{ blade: 30, engine: 40, push: 50 }, [13.6, 12.2, 18.5]],
  ])('adds upgrade bonuses without compounding or capping: %j', (levels, expected) => {
    const result = upgradeModifiers(levels);
    [result.bladeMul, result.engineMul, result.pushMul].forEach((value, i) => expect(value).toBeCloseTo(expected[i]!));
  });
  it('labels each available upgrade with its actual increment', () => {
    expect(['blade', 'engine', 'push'].map(key => upgradePercent(key as 'blade' | 'engine' | 'push'))).toEqual(['+42%', '+28%', '+35%']);
  });
});
