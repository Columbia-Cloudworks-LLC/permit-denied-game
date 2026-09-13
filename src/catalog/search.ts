export interface Card { id: string; name: string; category: string; variants: number; thumbnail: string; detail: string }
export interface Tree { file: string; count: number; min?: string; max?: string }
interface RecordItem { key: string; card: Card }
interface Node { items?: RecordItem[]; children?: Tree[] }
export const normalize = (text: string) => text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function searchPage(root: Tree, load: (key: string) => Promise<Node>, query = '', after = '', limit = 24) {
  const prefix = normalize(query), lower = after || prefix, upper = prefix ? `${prefix}\uffff` : '\uffff';
  const items: Card[] = [], ids = new Set<string>();
  let cursor = after, more = false, reads = 0;
  async function visit(tree: Tree): Promise<void> {
    if (more || (tree.max !== undefined && tree.max < lower) || (tree.min !== undefined && tree.min > upper)) return;
    if (reads >= 32) { more = true; return; }
    reads++;
    const node = await load(tree.file);
    if (node.children) { for (const child of node.children) await visit(child); return; }
    for (const record of node.items ?? []) {
      if (record.key <= after || record.key < lower || record.key > upper) continue;
      if (items.length === limit) { more = true; return; }
      cursor = record.key;
      if (prefix) {
        // An asset can match both its name and ID or multiple word suffixes.
        // Emit only its lexically first matching term, including across pages.
        const terms = new Set<string>();
        for (const text of [record.card.name, record.card.id]) {
          const words = normalize(text).split(' ');
          for (let i = 0; i < words.length; i++) terms.add(words.slice(i).join(' '));
        }
        const first = [...terms].filter(term => term.startsWith(prefix)).sort()[0];
        if (record.key !== `${first}\t${record.card.id}`) continue;
      }
      if (!ids.has(record.card.id)) { ids.add(record.card.id); items.push(record.card); }
    }
  }
  await visit(root);
  return { items, cursor, more };
}
