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
  if (!['/', '/catalog', '/privacy', '/terms'].includes(path)) return null;
  return 'https://permitdenied.app' + (path === '/catalog' ? '/catalog/' : path);
}
/** The vendor sends external referrers separately from beforeSend's URL. Drop
 * analytics for unusual full-path referrers rather than leak their contents. */
export function safeReferrer(referrer: string, origin: string): boolean {
  if (!referrer) return true;
  try { const url = new URL(referrer); return url.origin === origin || (url.pathname === '/' && !url.search && !url.hash); }
  catch { return false; }
}
