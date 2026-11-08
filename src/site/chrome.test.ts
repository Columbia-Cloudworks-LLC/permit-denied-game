import { describe, expect, it } from 'vitest';
import { TAGLINE, TITLE } from '../game/constants';
import { siteFooterMarkup, siteHeaderMarkup } from './chrome';

describe('site permit chrome', () => {
  it('stamps the game title, tagline, nav and publisher nameplate', () => {
    const header = siteHeaderMarkup('designer');
    expect(header).toContain(TITLE);
    expect(header).toContain(TAGLINE);
    expect(header).toContain('Play');
    expect(header).not.toContain('/catalog/');
    expect(header).toContain('/designer/');
    expect(header).toContain('aria-current="page"');
    expect(siteFooterMarkup()).toContain('Columbia Cloudworks LLC');
    expect(siteFooterMarkup()).toContain('data-privacy-settings');
  });
});
