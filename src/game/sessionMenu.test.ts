import { describe, expect, it } from 'vitest';
import { parseSessionFromSearch, startsAtTitle } from './session';

describe('operator menu entry', () => {
  it('shows the title on normal visits, including touch previews and tracking links', () => {
    for (const query of ['', '?controls=1', '?utm_source=friend']) expect(startsAtTitle(query)).toBe(true);
  });

  it('keeps documented scenario and diagnostic links playable immediately', () => {
    for (const query of ['?sandbox=1&district=d100', '?sandbox=1&ranch=1', '?perf=1', '?tower=1', '?job=brick', '?demo=steel-warehouse', '?seed=19', '?nhood=1']) {
      expect(startsAtTitle(query)).toBe(false);
    }
    expect(parseSessionFromSearch('?sandbox=1&district=d100')).toMatchObject({kind: 'sandbox', district: 'd100'});
    expect(parseSessionFromSearch('?job=brick')).toMatchObject({job: true, demo: 'rivertown'});
  });
});
