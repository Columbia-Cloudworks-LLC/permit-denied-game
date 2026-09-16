import { TAGLINE, TITLE } from '../game/constants';
import { permitDocument } from '../render/permitIntro';

export type SitePage = 'play' | 'catalog' | 'designer';

const PAGES: { id: SitePage; href: string; label: string }[] = [
  { id: 'play', href: '/', label: 'Play' },
  { id: 'catalog', href: '/catalog/', label: 'Catalog' },
  { id: 'designer', href: '/designer/', label: 'Designer' },
];

export const publisherMarkup = '<a class="publisher-brand" href="https://columbiacloudworks.com/" target="_blank" rel="noopener noreferrer"><img src="/brand/Columbia-Cloudworks-Icon-Small.png" width="28" height="28" alt="" /><span>Columbia Cloudworks LLC</span></a>';
export const copyrightMarkup = `<span>© 2026</span>${publisherMarkup}<span>All rights reserved.</span>`;

export function siteNavMarkup(current: SitePage): string {
  return `<nav class="site-nav" aria-label="Site">${PAGES.map(page => {
    const currentAttr = page.id === current ? ' aria-current="page"' : '';
    return `<a href="${page.href}"${currentAttr}>${page.label}</a>`;
  }).join('')}</nav>`;
}

export function siteHeaderMarkup(current: SitePage): string {
  return `<div class="site-brand" data-site-permit></div><div class="site-titles"><p class="site-eyebrow">COUNTY ARCHIVE</p><h1>${TITLE}</h1><p class="tagline">${TAGLINE}</p></div>${siteNavMarkup(current)}`;
}

export function siteFooterMarkup(): string {
  return `<div class="copyright">${copyrightMarkup}</div><nav class="legal-links" aria-label="Legal and privacy"><a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a><a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Use</a><button type="button" data-privacy-settings>Privacy Settings</button></nav>`;
}

/** Stamp stays visible without the title-menu intro. Pages can still scroll. */
export function hydrateSiteChrome(current: SitePage): void {
  document.body.classList.add('site-page');
  const header = document.querySelector<HTMLElement>('#site-header');
  const footer = document.querySelector<HTMLElement>('#site-footer');
  if (header && !header.querySelector('.site-titles')) header.innerHTML = siteHeaderMarkup(current);
  if (footer && !footer.querySelector('.copyright')) footer.innerHTML = siteFooterMarkup();
  const brand = document.querySelector<HTMLElement>('[data-site-permit]');
  if (brand && !brand.querySelector('.permit-paper')) brand.innerHTML = permitDocument(false);
  const paper = document.querySelector<HTMLElement>('#site-header .permit-paper');
  if (paper) {
    paper.classList.add('permit-ready');
    const verdict = paper.querySelector<HTMLElement>('[data-typed-verdict]');
    if (verdict) verdict.textContent = TAGLINE;
    const caret = paper.querySelector('.typewriter-caret');
    caret?.remove();
  }
}
