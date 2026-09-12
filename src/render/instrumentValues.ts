export const cashDigits = (cash: number): string => Math.max(0, Math.floor(cash)).toFixed(0).padStart(6, '0');
export const wheelDigit = (position: number): number => ((position % 10) + 10) % 10;

/** Choose the next occurrence of a digit in the balance's direction of travel. */
export function wheelDestination(position: number, digit: number, direction: 1 | -1): number {
  const turn = direction === 1 ? Math.ceil((position - digit) / 10) : Math.floor((position - digit) / 10);
  return digit + turn * 10;
}

export function clockValue(seconds: number, elapsed: boolean): { display: string; accessible: string } {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60, secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const display = elapsed && hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(Math.floor(total / 60))}:${pad(secs)}`;
  const unit = (n: number, label: string) => `${n} ${label}${n === 1 ? '' : 's'}`;
  const duration = [hours ? unit(hours, 'hour') : '', unit(minutes, 'minute'), unit(secs, 'second')].filter(Boolean).join(' ');
  return { display, accessible: `${elapsed ? 'Elapsed time' : 'Time remaining'}: ${duration}` };
}
