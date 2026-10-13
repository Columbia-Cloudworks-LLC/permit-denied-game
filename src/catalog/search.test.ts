import { describe, expect, it } from 'vitest';
import { searchPage, type Card, type Tree } from './search';

const card = (id: string, name: string): Card => ({ id, name, category: 'building', variants: 1, thumbnail: '', detail: '' });
const CARDS = [card('building:ranch', 'Ranch House'), card('building:bakery', 'Neighborhood Bakery'), card('building:barn', 'Gable Barn'),
  card('prop:oak', 'Oak Tree'), card('prop:pine', 'Pine Tree')];

/** Every word suffix of name and id, as the publisher indexes them. */
function searchRecords(cards: Card[]) {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return cards.flatMap((c) => {
    const terms = new Set<string>();
    for (const text of [c.name, c.id]) {
      const words = normalize(text).split(' ');
      words.forEach((_, i) => terms.add(words.slice(i).join(' ')));
    }
    return [...terms].map((term) => ({ key: `${term}\t${c.id}`, card: c }));
  }).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** A two-level tree with small leaves, counting file reads. */
function tree(records: ReturnType<typeof searchRecords>, leafSize = 3) {
  const files = new Map<string, object>();
  const leaves: Tree[] = [];
  for (let i = 0; i < records.length; i += leafSize) {
    const items = records.slice(i, i + leafSize);
    const file = `leaf-${i}`;
    files.set(file, { items });
    leaves.push({ file, count: items.length, min: items[0]!.key, max: items.at(-1)!.key });
  }
  files.set('root', { children: leaves });
  let reads = 0;
  const load = async (key: string) => { reads++; return files.get(key)!; };
  return { root: { file: 'root', count: records.length } as Tree, load, reads: () => reads };
}

describe('catalog search', () => {
  it('finds a prefix once per asset, however many of its words match', async () => {
    const { root, load } = tree(searchRecords(CARDS));
    const page = await searchPage(root, load, 'tree');
    expect(page.items.map((c) => c.id).sort()).toEqual(['prop:oak', 'prop:pine']);
    expect(page.more).toBe(false);
    expect((await searchPage(root, load, 'BUILDING')).items).toHaveLength(3);
    expect((await searchPage(root, load, 'zebra')).items).toEqual([]);
  });

  it('pages through every asset with a cursor and never repeats one', async () => {
    const records = CARDS.map((c) => ({ key: `${c.name.toLowerCase()}\t${c.id}`, card: c })).sort((a, b) => (a.key < b.key ? -1 : 1));
    const { root, load } = tree(records, 2);
    const first = await searchPage(root, load, '', '', 2);
    expect(first.items).toHaveLength(2);
    expect(first.more).toBe(true);
    const second = await searchPage(root, load, '', first.cursor, 2);
    const third = await searchPage(root, load, '', second.cursor, 2);
    const seen = [...first.items, ...second.items, ...third.items].map((c) => c.id);
    expect(new Set(seen).size).toBe(CARDS.length);
    expect(third.more).toBe(false);
  });

  it('stops reading after a bounded number of files and offers more', async () => {
    const many = Array.from({ length: 200 }, (_, i) => card(`prop:crate-${String(i).padStart(3, '0')}`, `Crate ${i}`));
    const { root, load, reads } = tree(searchRecords(many), 1);
    const capped = await searchPage(root, load, 'prop', 'prop crate', 500);
    expect(capped.more).toBe(true);
    expect(reads()).toBeLessThan(80);
  });
});
