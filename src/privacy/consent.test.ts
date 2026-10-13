// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { ANALYTICS_KEY, TERMS_KEY, TERMS_VERSION } from './state';

type Privacy = typeof import('./privacy');
let privacy: Privacy;
const dialog = () => document.querySelector<HTMLDialogElement>('dialog.privacy-dialog');
const button = (id: string) => dialog()!.querySelector<HTMLButtonElement>(`#${id}`)!;
const tick = (id: string) => {
  const box = dialog()!.querySelector<HTMLInputElement>(`#${id}`)!;
  box.checked = true;
  box.dispatchEvent(new Event('change'));
};

beforeAll(async () => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  localStorage.clear();
  document.body.innerHTML = '<button id="previous">Back to play</button><a href="/privacy#settings" data-privacy-settings>Privacy Settings</a>';
  privacy = await import('./privacy');
});

describe('privacy choices', () => {
  it('asks first-time visitors, and allows analytics only after the adult check', () => {
    document.querySelector<HTMLElement>('#previous')!.focus();
    privacy.initPrivacy(true);
    expect(privacy.privacyOpen()).toBe(true);
    expect(button('analytics-allow').disabled).toBe(true);
    button('analytics-allow').click();
    expect(privacy.privacyOpen()).toBe(true);
    tick('analytics-adult');
    expect(button('analytics-allow').disabled).toBe(false);
    button('analytics-allow').click();
    expect(localStorage.getItem(ANALYTICS_KEY)).toBe('adult-allowed');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('#previous'));
  });

  it('reopens from a settings link, records a decline, and closes on cancel', () => {
    document.querySelector<HTMLElement>('[data-privacy-settings]')!.click();
    expect(dialog()!.textContent).toContain('Current choice: Allowed');
    button('analytics-decline').click();
    expect(localStorage.getItem(ANALYTICS_KEY)).toBe('declined');
    document.querySelector<HTMLElement>('[data-privacy-settings]')!.click();
    expect(dialog()!.textContent).toContain('Current choice: Declined');
    dialog()!.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(privacy.privacyOpen()).toBe(false);
    document.querySelector<HTMLElement>('[data-privacy-settings]')!.click();
    button('privacy-close').click();
    expect(dialog()).toBeNull();
  });

  it('keeps analytics off outside production whatever the choice', () => {
    expect(() => privacy.analyticsEvent('game_started', { mode: 'sandbox' })).not.toThrow();
  });
});

describe('terms gate', () => {
  it('holds play until the terms are accepted, and remembers the acceptance', async () => {
    expect(privacy.termsAccepted()).toBe(false);
    const declined = privacy.ensureTerms();
    button('terms-back').click();
    expect(await declined).toBe(false);
    const pending = privacy.ensureTerms();
    expect(privacy.ensureTerms()).toBe(pending);
    expect(button('terms-continue').disabled).toBe(true);
    tick('terms-agree');
    button('terms-continue').click();
    expect(await pending).toBe(true);
    expect(privacy.termsAccepted()).toBe(true);
    expect(localStorage.getItem(TERMS_KEY)).toBe(TERMS_VERSION);
    expect(await privacy.ensureTerms()).toBe(true);
  });
});
