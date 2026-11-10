// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { CareerStrip, type CareerStripState } from './careerStrip';

const state = (escrow: number, fill: number): CareerStripState => ({
  run: { escrow, multiplier: 1.38, comboCells: escrow % 40, comboFill: 0.5 },
  rig: { blade: { label: 'CHARGE Mk II', fill, status: fill >= 1 ? 'READY' : 'CHARGING' }, aux: { label: 'JATO Mk I', fill: 1, status: 'READY' } },
  bladeFlash: false,
});

describe('career strip', () => {
  it('keeps its attachment buttons and focus across refreshes, so a press that spans one still lands', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const strip = new CareerStrip(host);
    const onBlade = vi.fn();
    strip.onBlade = onBlade;
    strip.update(state(100, 0.2));
    const button = host.querySelector<HTMLButtonElement>('[data-rig="blade"]')!;
    button.focus();
    for (let i = 1; i <= 20; i++) strip.update(state(100 + i * 37, Math.min(1, 0.2 + i * 0.05)));
    expect(host.querySelector('[data-rig="blade"]')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toContain('READY');
    expect(host.querySelectorAll('.career-cell strong')[1]!.textContent).toBe('$840');
    button.click();
    expect(onBlade).toHaveBeenCalledOnce();
  });

  it('shows the wallet in the yard and hides run readouts and empty slots', () => {
    const host = document.createElement('div');
    const strip = new CareerStrip(host);
    strip.update({ home: { wallet: 1234, hint: 'Stop on the apron.' }, rig: {}, bladeFlash: false });
    const visible = [...host.querySelectorAll<HTMLElement>('.career-strip > *')].filter(n => !n.hidden).map(n => n.textContent);
    expect(visible).toEqual(['BANKED$1,234', 'Stop on the apron.']);
  });
});
