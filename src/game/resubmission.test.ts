import { describe, expect, it } from 'vitest';
import { Resubmission } from './resubmission';

describe('permit resubmission fee', () => {
  it('charges a random portion of cash only once per run', () => {
    const run = new Resubmission();
    expect(run.charge(100, () => 0)).toBe(10);
    expect(run.charge(1000, () => .5)).toBeNull();
    expect(new Resubmission().charge(100, () => .99)).toBe(29);
  });
  it('requires spendable cash without consuming the attempt or overdrawing', () => {
    const run = new Resubmission();
    expect(run.charge(0)).toBeNull();
    expect(run.charge(.9)).toBeNull();
    expect(run.used).toBe(false);
    expect(run.charge(1.5)).toBe(1);
    expect(run.used).toBe(true);
  });
});
