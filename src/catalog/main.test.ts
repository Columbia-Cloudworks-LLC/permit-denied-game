// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_KEY } from '../privacy/state';

/** A content-addressed archive key; the page only accepts 64-hex object names. */
const key = (kind: 'objects' | 'releases', n: number, ext: 'json' | 'webp') => `${kind}/${n.toString(16).padStart(64, '0')}.${ext}`;
const frames = (n: number) => [0, 1, 2].map((i) => ({ file: key('objects', n * 10 + i, 'webp'), width: 4, height: 3, label: `frame ${i}`, seconds: i * 0.5 }));
const ASSETS = [
  { id: 'building:bakery', name: 'Neighborhood Bakery', category: 'building', detail: key('objects', 1, 'json'), thumbnail: key('objects', 2, 'webp'), variants: 2 },
  { id: 'prop:oak', name: 'Oak Tree', category: 'vegetation', detail: key('objects', 3, 'json'), thumbnail: key('objects', 4, 'webp'), variants: 1 },
];
const DETAILS = {
  [ASSETS[0]!.detail]: { id: 'building:bakery', name: 'Neighborhood Bakery', variants: [
    { variant: 0, series: [{ id: 'destruction', name: 'Destruction', frames: frames(5) }, { id: 'model', name: 'Model', frames: frames(6).slice(0, 1) }] },
    { variant: 1, series: [{ id: 'model', name: 'Model', frames: frames(7).slice(0, 1) }] },
  ] },
  [ASSETS[1]!.detail]: { id: 'prop:oak', name: 'Oak Tree', variants: [{ variant: 0, destructionUnsupported: 'Trees fall over.', series: [{ id: 'model', name: 'Model', frames: frames(8) }] }] },
};

/** One-leaf trees: browse by name, search by word suffix, and look up by id. */
function archive() {
  const files = new Map<string, unknown>(Object.entries(DETAILS));
  let next = 100;
  const leaf = (items: { key: string; card: (typeof ASSETS)[number] }[]) => {
    const file = key('objects', next++, 'json');
    const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : 1));
    files.set(file, { items: sorted });
    return { file, count: sorted.length, min: sorted[0]?.key, max: sorted.at(-1)?.key };
  };
  const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  const suffixes = (c: (typeof ASSETS)[number]) => [c.name, c.id].flatMap((t) => words(t).map((_, i, all) => all.slice(i).join(' ')));
  const indexFor = (cards: typeof ASSETS) => ({
    count: cards.length,
    browse: leaf(cards.map((card) => ({ key: `${words(card.name).join(' ')}\t${card.id}`, card }))),
    search: leaf(cards.flatMap((card) => [...new Set(suffixes(card))].map((term) => ({ key: `${term}\t${card.id}`, card })))),
  });
  const release = { schema: 1, commit: 'abc1234567', version: '1.0.46', assetCount: ASSETS.length,
    indexes: { all: indexFor(ASSETS), building: indexFor([ASSETS[0]!]), vegetation: indexFor([ASSETS[1]!]) },
    byId: leaf(ASSETS.map((card) => ({ key: card.id, card }))) };
  const releaseFile = key('releases', 9, 'json');
  files.set(releaseFile, release);
  files.set('pointer', { url: `/catalog/${releaseFile}`, commit: release.commit, version: release.version });
  return files;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const until = (check: () => boolean) => vi.waitFor(() => { if (!check()) throw new Error(`not yet: ${$('status').textContent} | open=${$<HTMLDialogElement>('viewer').open} | ${$('viewer-title').textContent} | ${$('counter').textContent}`); });

beforeAll(async () => {
  localStorage.setItem(ANALYTICS_KEY, 'declined');
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  const page = readFileSync('catalog/index.html', 'utf8');
  document.body.innerHTML = page.slice(page.indexOf('<body'), page.lastIndexOf('</body>')).replace(/<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const files = archive();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const path = new URL(String(input), location.href).pathname;
    const body = path === '/catalog/release.json' ? files.get('pointer') : files.get(path.replace('/catalog/', ''));
    return { ok: body !== undefined, json: async () => body };
  }));
  history.replaceState(null, '', '/catalog/');
  await import('./main');
  await until(() => $('grid').children.length > 0);
});

describe('catalog page', () => {
  it('lists the release and every asset card', () => {
    expect($('release').textContent).toBe('2 assets · v1.0.46 · abc12345');
    expect([...$<HTMLSelectElement>('category').options].map((o) => o.value)).toEqual(['all', 'building', 'vegetation']);
    expect([...$('grid').querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Neighborhood Bakery', 'Oak Tree']);
    expect($('status').textContent).toBe('2 assets on this page · 2 in collection');
    expect($<HTMLButtonElement>('next').disabled).toBe(true);
    expect(document.querySelector('#site-header .site-titles')).not.toBeNull();
  });

  it('searches by word prefix and filters by collection, keeping both in the link', async () => {
    $<HTMLInputElement>('search').value = 'bak';
    $<HTMLFormElement>('filters').dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => $('grid').children.length === 1);
    expect(location.search).toContain('q=bak');
    $<HTMLInputElement>('search').value = 'zebra';
    $<HTMLFormElement>('filters').dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => $('grid').children.length === 0);
    expect($('status').textContent).toBe('No matching assets. Try a name, ID, or word prefix.');
    $<HTMLInputElement>('search').value = '';
    $<HTMLSelectElement>('category').value = 'vegetation';
    $<HTMLSelectElement>('category').dispatchEvent(new Event('change'));
    await until(() => $('grid').children.length === 1 && $('grid').textContent!.includes('Oak'));
    $<HTMLSelectElement>('category').value = 'all';
    $<HTMLSelectElement>('category').dispatchEvent(new Event('change'));
    await until(() => $('grid').children.length === 2);
  });

  it('opens an asset and steps through its frames, variants and series', async () => {
    ($('grid').querySelector('a') as HTMLAnchorElement).click();
    await until(() => $<HTMLDialogElement>('viewer').open);
    expect($('viewer-title').textContent).toBe('Neighborhood Bakery');
    expect($('counter').textContent).toBe('1 / 3 · 0.00 simulation seconds');
    expect($<HTMLButtonElement>('back').disabled).toBe(true);
    $('viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect($('counter').textContent).toBe('2 / 3 · 0.50 simulation seconds');
    $('forward').click();
    expect($<HTMLButtonElement>('forward').disabled).toBe(true);
    expect(location.search).toContain('frame=2');
    $<HTMLInputElement>('scrubber').value = '0';
    $('scrubber').dispatchEvent(new Event('input'));
    expect($('frame-label').textContent).toBe('frame 0');
    $<HTMLSelectElement>('series').value = 'model';
    $('series').dispatchEvent(new Event('change'));
    expect($('counter').textContent).toBe('1 / 1 · 0.00 simulation seconds');
    $<HTMLSelectElement>('variant').value = '1';
    $('variant').dispatchEvent(new Event('change'));
    expect($<HTMLSelectElement>('series').value).toBe('model');
    $('share').click();
    await until(() => $('share').textContent !== 'Copy link');
    $('close').click();
    expect($<HTMLDialogElement>('viewer').open).toBe(false);
    expect(location.search).not.toContain('asset=');
  });

  it('restores a deep link to an asset frame, and reports assets the release lacks', async () => {
    history.replaceState(null, '', '/catalog/?asset=prop%3Aoak&variant=0&series=model&frame=2');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await until(() => $<HTMLDialogElement>('viewer').open && $('viewer-title').textContent === 'Oak Tree');
    expect($('counter').textContent).toBe('3 / 3 · 1.00 simulation seconds');
    expect($('explanation').textContent).toBe('Trees fall over.');
    history.replaceState(null, '', '/catalog/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await until(() => !$<HTMLDialogElement>('viewer').open);
    history.replaceState(null, '', '/catalog/?asset=building%3Anowhere');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await until(() => $('status').textContent === 'That asset is not in this catalog release.');
  });
});
