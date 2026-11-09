export const TERMS_VERSION = '2026-09-13';
export const TERMS_KEY = 'pd.terms';
export const ANALYTICS_KEY = 'pd.analytics';
export type AnalyticsChoice = 'adult-allowed' | 'declined' | null;
export function parseChoice(value: string | null): AnalyticsChoice {
  return value === 'adult-allowed' || value === 'declined' ? value : null;
}
export function analyticsPage(href: string): string | null {
  const url = new URL(href);
  if (url.protocol !== 'https:' || !['permitdenied.app', 'www.permitdenied.app'].includes(url.hostname)) return null;
  if (['capture', 'yard', 'testAsset', 'demo', 'tower', 'ranch', 'perf', 'nhood'].some(key => url.searchParams.has(key))) return null;
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (!['/', '/designer', '/privacy', '/terms'].includes(path)) return null;
  return 'https://permitdenied.app' + (path === '/designer' ? '/designer/' : path);
}
/** The vendor sends external referrers separately from beforeSend's URL. Drop
 * analytics for unusual full-path referrers rather than leak their contents. */
export function safeReferrer(referrer: string, origin: string): boolean {
  if (!referrer) return true;
  try { const url = new URL(referrer); return url.origin === origin || (url.pathname === '/' && !url.search && !url.hash); }
  catch { return false; }
}

/**
 * What the analytics vendor may send for one event: the authored page path only, and nothing
 * at all once consent is gone. `permitted` is read at send time, so a withdrawal applies to
 * events already queued.
 */
export function sendableEvent<T extends { url: string }>(event: T, permitted: boolean): T | null {
  const url = analyticsPage(event.url);
  return permitted && url ? { ...event, url } : null;
}

/** On any consent change, drop events still waiting for the vendor script; keep only its beforeSend hook. */
export function withoutQueuedEvents<Q extends [string, unknown?]>(queue: Q[]): Q[] {
  return queue.filter(([kind]) => kind === 'beforeSend');
}
