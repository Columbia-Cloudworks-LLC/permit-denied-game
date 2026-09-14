import './style.css';
import { initPrivacy, analyticsEvent } from '../privacy/privacy';
initPrivacy(true);
import { searchPage, type Card, type Tree } from './search';

interface Frame { file: string; width: number; height: number; label: string; seconds: number }
interface Series { id: string; name: string; frames: Frame[] }
interface Variant { variant: number; destructionUnsupported?: string; series: Series[] }
interface Detail { id: string; name: string; variants: Variant[] }
interface Release { schema: number; commit: string; version: string; assetCount: number; byId: Tree; indexes: Record<string, { count: number; browse: Tree; search: Tree }> }
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = element<HTMLDialogElement>('viewer'), grid = element('grid');
const search = element<HTMLInputElement>('search'), category = element<HTMLSelectElement>('category');
const variantSelect = element<HTMLSelectElement>('variant'), seriesSelect = element<HTMLSelectElement>('series');
const frameImage = element<HTMLImageElement>('frame'), scrubber = element<HTMLInputElement>('scrubber');
let release: Release, base: URL, detail: Detail | undefined, frameIndex = 0;
let browseEpoch = 0, viewerEpoch = 0, page = 0, cursors = [''], nextCursor = '', opener: HTMLElement | null = null;
const cache = new Map<string, unknown>();
let neighbors: HTMLImageElement[] = [];
const status = (text: string) => { element('status').textContent = text; };
const fileUrl = (key: string) => {
  if (!/^(objects|releases)\/[a-f0-9]{64}\.(json|webp)$/.test(key)) throw new Error('Invalid catalog file');
  return new URL(key, base).href;
};
async function load<T>(key: string): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const response = await fetch(fileUrl(key));
  if (!response.ok) throw new Error('An archive file could not be loaded. Please try again.');
  const data: T = await response.json();
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, data); return data;
}
function addOption(select: HTMLSelectElement, value: string, text: string) {
  const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
}
function setUrl(replace = true) {
  const url = new URL(location.href);
  url.searchParams.set('q', search.value); url.searchParams.set('category', category.value);
  if (detail && dialog.open) {
    url.searchParams.set('asset', detail.id); url.searchParams.set('variant', variantSelect.value);
    url.searchParams.set('series', seriesSelect.value); url.searchParams.set('frame', String(frameIndex));
  } else for (const key of ['asset', 'variant', 'series', 'frame']) url.searchParams.delete(key);
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
}
function cardNode(card: Card) {
  const link = document.createElement('a'); link.className = 'card';
  const url = new URL(location.href); url.searchParams.set('asset', card.id); link.href = url.href;
  const image = document.createElement('img'); image.src = fileUrl(card.thumbnail); image.loading = 'lazy'; image.decoding = 'async'; image.width = 360; image.height = 270; image.alt = card.name;
  const info = document.createElement('div'); info.className = 'card-info';
  const tag = document.createElement('span'); tag.className = 'card-category'; tag.textContent = card.category.replaceAll('-', ' ');
  const title = document.createElement('h2'); title.textContent = card.name;
  const bottom = document.createElement('div'); bottom.className = 'card-bottom';
  const variants = document.createElement('span'); variants.textContent = `${card.variants} variant${card.variants === 1 ? '' : 's'}`;
  const action = document.createElement('span'); action.textContent = 'INSPECT ↗'; bottom.append(variants, action);
  info.append(tag, title, bottom); link.append(image, info);
  link.onclick = event => { if (event.ctrlKey || event.metaKey || event.shiftKey) return; event.preventDefault(); opener = link; void openAsset(card); };
  return link;
}
async function browse() {
  const epoch = ++browseEpoch;
  status('Loading collection…');
  element<HTMLButtonElement>('next').disabled = true;
  try {
    const index = release.indexes[category.value] || release.indexes.all;
    const result = await searchPage(search.value.trim() ? index.search : index.browse, load, search.value, cursors[page]);
    if (epoch !== browseEpoch) return;
    grid.replaceChildren(...result.items.map(cardNode)); nextCursor = result.cursor;
    status(result.items.length ? `${result.items.length} assets on this page · ${index.count.toLocaleString()} in collection` : result.more ? 'Search continues in the next section. Select Next to keep browsing.' : 'No matching assets. Try a name, ID, or word prefix.');
    element<HTMLButtonElement>('previous').disabled = page === 0;
    element<HTMLButtonElement>('next').disabled = !result.more;
    element('page-number').textContent = `Page ${page + 1}`;
  } catch (error) { if (epoch === browseEpoch) status(String(error)); }
}
function currentVariant() { return detail!.variants.find(v => String(v.variant) === variantSelect.value)!; }
function currentSeries() { return currentVariant().series.find(s => s.id === seriesSelect.value)!; }
function showFrame(index: number) {
  const series = currentSeries(); frameIndex = Math.max(0, Math.min(series.frames.length - 1, Number.isFinite(index) ? index : 0));
  const frame = series.frames[frameIndex], url = fileUrl(frame.file);
  element('image-status').textContent = 'Loading frame…'; frameImage.hidden = false;
  frameImage.onload = () => { if (frameImage.src === url) element('image-status').textContent = ''; };
  frameImage.onerror = () => { if (frameImage.src === url) { frameImage.hidden = true; element('image-status').textContent = 'Frame unavailable. Step away and back to retry.'; } };
  frameImage.alt = `${detail!.name} · ${frame.label}`; frameImage.src = url;
  scrubber.max = String(series.frames.length - 1); scrubber.value = String(frameIndex);
  element('frame-label').textContent = frame.label;
  element('counter').textContent = `${frameIndex + 1} / ${series.frames.length} · ${frame.seconds.toFixed(2)} simulation seconds`;
  element<HTMLButtonElement>('back').disabled = frameIndex === 0;
  element<HTMLButtonElement>('forward').disabled = frameIndex === series.frames.length - 1;
  neighbors.forEach(image => { image.src = ''; });
  neighbors = [series.frames[frameIndex - 1], series.frames[frameIndex + 1]].filter(Boolean).map(f => { const img = new Image(); img.src = fileUrl(f.file); return img; });
  setUrl();
}
function chooseVariant(seriesId = 'destruction', index = 0) {
  seriesSelect.replaceChildren();
  const variant = currentVariant();
  variant.series.forEach(s => addOption(seriesSelect, s.id, s.name));
  seriesSelect.value = variant.series.some(s => s.id === seriesId) ? seriesId : variant.series[0].id;
  element('explanation').textContent = variant.destructionUnsupported || 'Captured in a fixed camera. Fully cleared is a separate, additional full-damage step.';
  showFrame(index);
}
async function openAsset(card: Card, params?: URLSearchParams) {
  const epoch = ++viewerEpoch;
  try {
    const data = await load<Detail>(card.detail); if (epoch !== viewerEpoch) return;
    analyticsEvent('catalog_asset_opened', { asset: data.id });
    detail = data; element('viewer-title').textContent = data.name; element('asset-id').textContent = data.id;
    variantSelect.replaceChildren(); data.variants.forEach(v => addOption(variantSelect, String(v.variant), `Variant ${v.variant + 1}`));
    if (data.variants.some(v => String(v.variant) === params?.get('variant'))) variantSelect.value = params!.get('variant')!;
    if (!dialog.open) dialog.showModal();
    chooseVariant(params?.get('series') || 'destruction', Number(params?.get('frame') || 0));
    element('stage').focus();
  } catch (error) { status(String(error)); }
}
function closeViewer() { viewerEpoch++; dialog.close(); detail = undefined; neighbors.forEach(image => { image.src = ''; }); neighbors = []; frameImage.removeAttribute('src'); setUrl(); opener?.focus(); }
element('close').onclick = closeViewer;
dialog.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
dialog.addEventListener('keydown', event => {
  if (!detail || (event.target as HTMLElement).matches('input,select,textarea')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); showFrame(frameIndex + (event.key === 'ArrowLeft' ? -1 : 1)); }
});
let touch: { x: number; y: number; id: number } | undefined;
const stage = element('stage');
stage.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && e.isPrimary) touch = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
stage.addEventListener('pointerup', e => {
  if (touch?.id !== e.pointerId || !detail) return;
  const dx = e.clientX - touch.x, dy = e.clientY - touch.y; touch = undefined;
  if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) showFrame(frameIndex + (dx < 0 ? 1 : -1));
});
stage.addEventListener('pointercancel', () => { touch = undefined; });
variantSelect.onchange = () => chooseVariant(seriesSelect.value);
seriesSelect.onchange = () => showFrame(0); scrubber.oninput = () => showFrame(Number(scrubber.value));
element('back').onclick = () => showFrame(frameIndex - 1); element('forward').onclick = () => showFrame(frameIndex + 1);
element('share').onclick = async () => { try { await navigator.clipboard.writeText(location.href); element('share').textContent = 'Link copied'; } catch { element('share').textContent = 'Copy the browser URL'; } };
element<HTMLFormElement>('filters').onsubmit = event => { event.preventDefault(); page = 0; cursors = ['']; setUrl(); void browse(); };
category.onchange = () => { page = 0; cursors = ['']; setUrl(); void browse(); };
element('previous').onclick = () => { if (page > 0) { page--; void browse(); } };
element('next').onclick = () => { cursors[++page] = nextCursor; void browse(); };

async function restoreUrl() {
  const params = new URLSearchParams(location.search); search.value = params.get('q') || '';
  category.value = params.get('category') && release.indexes[params.get('category')!] ? params.get('category')! : 'all';
  page = 0; cursors = ['']; void browse();
  const id = params.get('asset');
  if (id) {
    // IDs are indexed separately; a deep link doesn't scan the browsing index.
    async function find(tree: Tree): Promise<Card | undefined> {
      const node = await load<{ items?: { key: string; card: Card }[]; children?: Tree[] }>(tree.file);
      if (node.items) return node.items.find(item => item.key === id)?.card;
      const child = node.children?.find(c => c.min! <= id! && c.max! >= id!);
      return child ? find(child) : undefined;
    }
    const card = await find(release.byId); if (card) await openAsset(card, params); else status('That asset is not in this catalog release.');
  } else if (dialog.open) closeViewer();
}
window.addEventListener('popstate', () => { void restoreUrl(); });
void (async () => {
  try {
    const pointerResponse = await fetch('/catalog/release.json', { cache: 'no-store' });
    if (!pointerResponse.ok) throw new Error('The catalog has not been generated for this build yet.');
    const pointer = await pointerResponse.json(); const releaseUrl = new URL(pointer.url, location.href);
    if (releaseUrl.origin !== location.origin && releaseUrl.origin !== 'https://assets.permitdenied.app') throw new Error('Unexpected catalog origin');
    base = new URL('../', releaseUrl);
    const response = await fetch(releaseUrl); if (!response.ok) throw new Error('The archive is temporarily unavailable. Please reload to retry.');
    release = await response.json();
    if (release.schema !== 1 || release.commit !== pointer.commit || release.version !== pointer.version) throw new Error('Catalog release does not match this build.');
    element('release').textContent = `${release.assetCount.toLocaleString()} assets · v${release.version} · ${release.commit.slice(0, 8)}`;
    Object.keys(release.indexes).filter(k => k !== 'all').sort().forEach(k => addOption(category, k, k.replaceAll('-', ' ')));
    await restoreUrl();
  } catch (error) { element('release').textContent = 'Archive unavailable'; status(String(error)); }
})();
// Hold only the adjacent image elements, not a growing playback history.
window.addEventListener('pagehide', () => { neighbors.forEach(image => { image.src = ''; }); neighbors = []; });
