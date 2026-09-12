import { describe, expect, it } from 'vitest';
import { cashDigits, clockValue, wheelDestination, wheelDigit } from './instrumentValues';

describe('cash instrument values', () => {
  it('pads six wheels and expands without truncating the balance', () => {
    expect(cashDigits(1250.9)).toBe('001250');
    expect(cashDigits(0)).toBe('000000');
    expect(cashDigits(1234567)).toBe('1234567');
  });
  it.each([[9, 10], [99, 100], [1000, 999], [20, 12500], [999999, 1000000]])('rolls %i to %i in the balance direction', (from, to) => {
    const before = cashDigits(from).padStart(cashDigits(to).length, '0');
    [...cashDigits(to)].forEach((digit, i) => {
      const position = Number(before[i]);
      const target = wheelDestination(position, Number(digit), to > from ? 1 : -1);
      expect(wheelDigit(target)).toBe(Number(digit));
      expect(to > from ? target >= position : target <= position).toBe(true);
      expect(Math.abs(target - position)).toBeLessThan(10);
    });
  });
  it('reverses smoothly from a fractional position during a deduction', () => {
    expect(wheelDestination(8.25, 2, -1)).toBe(2);
    expect(wheelDestination(8.25, 2, 1)).toBe(12);
    expect(wheelDestination(-0.4, 9, -1)).toBe(-1);
    expect(wheelDigit(-1)).toBe(9);
  });
});

describe('equipment clock', () => {
  it('preserves floor rounding and clamps the countdown at zero', () => {
    expect(clockValue(180, false).display).toBe('03:00');
    expect(clockValue(179.99, false).display).toBe('02:59');
    expect(clockValue(60, false).display).toBe('01:00');
    expect(clockValue(59.99, false).display).toBe('00:59');
    expect(clockValue(-1, false).display).toBe('00:00');
  });
  it('shows elapsed hours and readable accessible durations', () => {
    expect(clockValue(3599, true).display).toBe('59:59');
    expect(clockValue(3600, true).display).toBe('1:00:00');
    expect(clockValue(3661, true)).toEqual({ display: '1:01:01', accessible: 'Elapsed time: 1 hour 1 minute 1 second' });
    expect(clockValue(134, false).accessible).toBe('Time remaining: 2 minutes 14 seconds');
  });
});
