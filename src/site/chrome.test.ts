import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TAGLINE, TITLE } from '../game/constants';
import { siteFooterMarkup, siteHeaderMarkup } from './chrome';

describe('site permit chrome', () => {
  it('stamps the game title, tagline, nav and publisher nameplate', () => {
    const header = siteHeaderMarkup('catalog');
    expect(header).toContain(TITLE);
    expect(header).toContain(TAGLINE);
    expect(header).toContain('Play');
    expect(header).toContain('/catalog/');
    expect(header).toContain('/designer/');
    expect(header).toContain('aria-current="page"');
    expect(siteFooterMarkup()).toContain('Columbia Cloudworks LLC');
    expect(siteFooterMarkup()).toContain('data-privacy-settings');
  });

  it('keeps catalog production HTML on the permit brand', () => {
    const html = readFileSync('catalog/index.html', 'utf8');
    expect(html).toContain(TITLE);
    expect(html).toContain(TAGLINE);
    expect(html).not.toContain('THE DEMOLITION COLLECTION');
  });
});
