export interface Card { id: string; name: string; category: string; variants: number; thumbnail: string; detail: string }
export interface Tree { file: string; count: number; min?: string; max?: string }
interface RecordItem { key: string; card: Card }
interface Node { items?: RecordItem[]; children?: Tree[] }
const normalize = (text: string) => text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Most tree files one page may read before it stops and offers more. */
const MAX_READS = 32;

export async function searchPage(root: Tree, load: (key: string) => Promise<Node>, query = '', after = '', limit = 24) {
  const search = new PageSearch(load, normalize(query), after, limit);
  await search.visit(root);
  return { items: search.items, cursor: search.cursor, more: search.more };
}

/** One page of a prefix search over the catalog's immutable B+ tree, resuming after a cursor. */
class PageSearch {
  readonly items: Card[] = [];
  private readonly ids = new Set<string>();
  private readonly lower: string;
  private readonly upper: string;
  cursor: string;
  more = false;
  private reads = 0;

  constructor(private readonly load: (key: string) => Promise<Node>, private readonly prefix: string, private readonly after: string, private readonly limit: number) {
    this.lower = after || prefix;
    this.upper = prefix ? `${prefix}￿` : '￿';
    this.cursor = after;
  }

  async visit(tree: Tree): Promise<void> {
    if (this.more || this.outOfRange(tree)) return;
    if (this.reads >= MAX_READS) { this.more = true; return; }
    this.reads++;
    const node = await this.load(tree.file);
    if (node.children) {
      for (const child of node.children) await this.visit(child);
      return;
    }
    for (const record of node.items ?? []) {
      if (!this.inRange(record.key)) continue;
      if (this.items.length === this.limit) { this.more = true; return; }
      this.cursor = record.key;
      if (this.isFirstTerm(record)) this.add(record.card);
    }
  }

  private outOfRange(tree: Tree): boolean {
    return (tree.max !== undefined && tree.max < this.lower) || (tree.min !== undefined && tree.min > this.upper);
  }

  private inRange(key: string): boolean {
    return key > this.after && key >= this.lower && key <= this.upper;
  }

  /**
   * An asset can match both its name and ID or multiple word suffixes.
   * Emit only its lexically first matching term, including across pages.
   */
  private isFirstTerm(record: RecordItem): boolean {
    if (!this.prefix) return true;
    const terms = new Set<string>();
    for (const text of [record.card.name, record.card.id]) {
      const words = normalize(text).split(' ');
      for (let i = 0; i < words.length; i++) terms.add(words.slice(i).join(' '));
    }
    const first = [...terms].filter(term => term.startsWith(this.prefix)).sort()[0];
    return record.key === `${first}\t${record.card.id}`;
  }

  private add(card: Card): void {
    if (this.ids.has(card.id)) return;
    this.ids.add(card.id);
    this.items.push(card);
  }
}
