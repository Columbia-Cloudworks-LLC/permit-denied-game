import { inject, pageview, track } from '@vercel/analytics';
import { ANALYTICS_KEY, TERMS_KEY, TERMS_VERSION, analyticsPage, parseChoice, safeReferrer, type AnalyticsChoice } from './state';
import './style.css';

function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* Session choice still works when storage is unavailable. */ } }
let choice: AnalyticsChoice = parseChoice(read(ANALYTICS_KEY));
let accepted = read(TERMS_KEY) === TERMS_VERSION;
let injected = false, initialized = false;
let active: HTMLDialogElement | undefined;
let termsPending: Promise<boolean> | undefined;
let testSession = false;
let consentEpoch = 0;
export const termsAccepted = () => accepted;
export const privacyOpen = () => !!active?.open;
export function setAnalyticsTestSession(value: boolean): void { testSession = value; }
function allowed(): boolean {
  return import.meta.env.PROD && choice === 'adult-allowed' && !testSession && !!analyticsPage(location.href) && safeReferrer(document.referrer, location.origin);
}
function activate(): void {
  if (!allowed() || injected) return;
  injected = true;
  inject({ mode: 'production', disableAutoTrack: true, beforeSend: event => {
    const url = analyticsPage(event.url);
    return allowed() && url ? { ...event, url } : null;
  } });
  pageview({ path: new URL(analyticsPage(location.href)!).pathname });
}
export function analyticsEvent(name: 'game_started' | 'game_engaged' | 'game_finished' | 'game_restarted' | 'catalog_asset_opened', data: Record<string, string | number>): void {
  if (!allowed()) return;
  activate();
  track(name, data);
}
function choose(value: Exclude<AnalyticsChoice, null>): void {
  choice = value; consentEpoch++; write(ANALYTICS_KEY, value);
  // Drop anything waiting for the external script, including events from a
  // previously allowed period. beforeSend also checks consent at send time.
  if (window.vaq) window.vaq = window.vaq.filter(([kind]) => kind === 'beforeSend');
  activate();
}
function modal(title: string, content: string): { dialog: HTMLDialogElement; close: () => void } {
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog'); dialog.className = 'privacy-dialog';
  dialog.setAttribute('aria-labelledby', 'privacy-heading');
  dialog.innerHTML = `<h2 id="privacy-heading">${title}</h2>${content}`;
  document.body.append(dialog); active = dialog;
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.showModal();
  return { dialog, close: () => { dialog.close(); dialog.remove(); active = undefined; previous?.focus(); } };
}
export function openPrivacySettings(): void {
  if (active?.open) return;
  const { dialog, close } = modal('Your privacy choices', `<p>Optional analytics helps us understand visits and improve the game. It includes basic traffic information and game starts, active play, results, retries, and catalog asset views. No advertising or personal profiles.</p><p>You can play without analytics. Players under 18 must decline.</p><p>Current choice: <strong>${choice === 'adult-allowed' ? 'Allowed' : choice === 'declined' ? 'Declined' : 'Not chosen — off'}</strong></p><label class="privacy-check"><input type="checkbox" id="analytics-adult"> I am 18 or older</label><div class="privacy-actions"><button id="analytics-allow" disabled>Allow analytics</button><button id="analytics-decline">Decline</button></div><p><a href="/privacy" target="_blank" rel="noopener noreferrer">Read the Privacy Policy</a> · <button class="privacy-link" id="privacy-close">Close</button></p><p class="privacy-small">Your choice is remembered in this browser when storage is available. You can withdraw permission here at any time.</p>`);
  const adult = dialog.querySelector<HTMLInputElement>('#analytics-adult')!, allow = dialog.querySelector<HTMLButtonElement>('#analytics-allow')!;
  adult.onchange = () => { allow.disabled = !adult.checked; };
  allow.onclick = () => { if (adult.checked) { choose('adult-allowed'); close(); } };
  dialog.querySelector<HTMLButtonElement>('#analytics-decline')!.onclick = () => { choose('declined'); close(); };
  dialog.querySelector<HTMLButtonElement>('#privacy-close')!.onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
}
export function ensureTerms(): Promise<boolean> {
  if (accepted) return Promise.resolve(true);
  if (termsPending) return termsPending;
  termsPending = new Promise<boolean>(resolve => {
    if (active?.open) { resolve(false); return; }
    const { dialog, close } = modal('Before you play', `<p>PERMIT DENIED is a free game for ages 13 and up.</p><label class="privacy-check"><input type="checkbox" id="terms-agree"> I am at least 13, agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Use</a>, and, if I am under the age of majority where I live, have my parent or guardian’s permission.</label><p>See our <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> for how information is handled. Accepting the terms does not enable analytics.</p><div class="privacy-actions"><button id="terms-continue" disabled>Agree and play</button><button id="terms-back">Back</button></div>`);
    const check = dialog.querySelector<HTMLInputElement>('#terms-agree')!, next = dialog.querySelector<HTMLButtonElement>('#terms-continue')!;
    check.onchange = () => { next.disabled = !check.checked; };
    const done = (yes: boolean) => { if (yes) { accepted = true; write(TERMS_KEY, TERMS_VERSION); } close(); resolve(yes); if (yes && !choice) openPrivacySettings(); };
    next.onclick = () => { if (check.checked) done(true); };
    dialog.querySelector<HTMLButtonElement>('#terms-back')!.onclick = () => done(false);
    dialog.addEventListener('cancel', e => { e.preventDefault(); done(false); });
  }).finally(() => { termsPending = undefined; });
  return termsPending;
}
export function initPrivacy(prompt = false): void {
  if (initialized) return; initialized = true;
  document.addEventListener('click', e => { if ((e.target as Element).closest('[data-privacy-settings]')) { e.preventDefault(); openPrivacySettings(); } });
  window.addEventListener('storage', e => {
    if (e.key === ANALYTICS_KEY || e.key === null) { choice = parseChoice(read(ANALYTICS_KEY)); consentEpoch++; if (window.vaq) window.vaq = window.vaq.filter(([kind]) => kind === 'beforeSend'); activate(); }
    if (e.key === TERMS_KEY || e.key === null) accepted = read(TERMS_KEY) === TERMS_VERSION;
  });
  activate();
  if (prompt && !choice) openPrivacySettings();
}
/** No retrospective reporting: each run begins at its first active step;
 * pauses, hidden tabs, consent changes and debug worlds do not add play time. */
export class RunAnalytics {
  private started = false;
  private engaged = false;
  private seconds = 0;
  private epoch = consentEpoch;
  constructor(private emit = analyticsEvent, private enabled = () => allowed() && !document.hidden) {}
  reset(retry: boolean): void { if (retry && this.started && this.epoch === consentEpoch) this.emit('game_restarted', {}); this.started = false; this.engaged = false; this.seconds = 0; this.epoch = consentEpoch; }
  step(dt: number, mode: string, district: string): void {
    if (this.epoch !== consentEpoch) { this.started = false; this.engaged = false; this.seconds = 0; this.epoch = consentEpoch; }
    if (!this.enabled()) return;
    if (!this.started) { this.emit('game_started', { mode, district }); this.started = true; }
    this.seconds += dt;
    if (!this.engaged && this.seconds >= 60) { this.engaged = true; this.emit('game_engaged', { mode, district }); }
  }
  finish(won: boolean): void { if (this.started && this.epoch === consentEpoch) this.emit('game_finished', { outcome: won ? 'won' : 'lost', duration_seconds: Math.round(this.seconds) }); this.started = false; }
}
