import type { CountyProgress } from '../game/countyProgress';
import type { SessionKind } from '../game/session';
import type { AtlasData, AtlasRegion } from '../world/atlas';
import { CAPITOL_COUNTY_INDEX, COUNTIES_PER_REGION, regionCounties, type CountyDef } from '../world/counties';
import { REGIONAL_FLAVORS } from '../world/regionalCatalog';
import type { RegionDef } from '../world/regions';
import { MENU_ICONS } from './menuIcons';
import {
  seasonLabel,
  SEASONS,
  WEATHER_CONDITIONS,
  WEATHER_DETAILS,
  weatherConditionLabel,
  type SeasonId,
  type WeatherConditionId,
  type WeatherDetail,
} from '../world/season';

/**
 * Overworld markup: a full-viewport road atlas of North America (the macro view) and, laid over
 * it, one state or province's atlas sheet split into its seven counties. Geometry comes from the
 * lazily fetched atlas; this module only turns it into SVG and the bottom action bars.
 */

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export interface CountyViewState {
  kind: SessionKind;
  season: SeasonId;
  /** The selected county, if any. */
  selected?: number;
  /** The county being played under a paused run, if it is in this region. */
  current?: number;
  weather(index: number): WeatherConditionId;
}

type CountyStatus = 'cleared' | 'locked' | 'open';

function countyStatus(county: Pick<CountyDef, 'regionId' | 'index'>, progress: CountyProgress, kind: SessionKind): CountyStatus {
  if (progress.isCleared(county.regionId, county.index)) return 'cleared';
  return progress.isUnlocked(kind, county.regionId, county.index) ? 'open' : 'locked';
}

const STATUS_TEXT = { cleared: 'Cleared', locked: 'Locked', open: 'Not cleared' } as const;

function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The map's season, and whether this visit may change it (a paused run's maps may not). */
export interface MapSeason {
  season: SeasonId;
  locked: boolean;
}

/** Line glyphs for the atlas chrome, so the bars and cards read at a glance instead of in sentences. */
function ico(markup: string): string {
  return `<svg class="atlas-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
}
const fromMenu = (svg: string) => svg.replace('class="menu-icon"', 'class="atlas-ico"');
const ICO = {
  back: fromMenu(MENU_ICONS.back),
  go: ico('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  yard: fromMenu(MENU_ICONS.yard),
  reset: ico('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  challenge: ico('<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5v-4M9.5 3h5M12 3v3.5"/>'),
  sandbox: ico('<path d="M7.5 15.5a3.5 3.5 0 1 1 0-7c3 0 6 7 9 7a3.5 3.5 0 1 0 0-7c-3 0-6 7-9 7z"/>'),
  spring: ico('<path d="M12 20v-8"/><path d="M12 12c0-3.5-2.5-5.5-6.5-5.5C5.5 10 8 12 12 12z"/><path d="M12 15c0-3 2-4.5 5.5-4.5 0 3-2 4.5-5.5 4.5z"/>'),
  summer: ico('<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'),
  autumn: ico('<path d="M5 19C5 11 10 5.5 19 5c.5 8-4 13-10.5 12.6"/><path d="M5 19l8-8"/>'),
  winter: ico('<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>'),
  lock: ico('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  weather: ico('<path d="M7 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9.2a4.7 4.7 0 0 1 .4 9.3z"/>'),
  effects: ico('<path d="M8 4v5M16 4v5M12 9.5v5M8 15v5M16 15v5"/>'),
  target: ico('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  cash: ico('<path d="M15.5 8.2C15 6.9 13.7 6 12 6c-2 0-3.5 1.1-3.5 2.8 0 4 7.2 2 7.2 6.2 0 1.8-1.6 3-3.7 3-1.8 0-3.3-.8-3.9-2.3M12 4v16"/>'),
  clock: ico('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
  pin: ico('<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>'),
  eye: fromMenu(MENU_ICONS.eye),
  caution: fromMenu(MENU_ICONS.caution),
  playing: fromMenu(MENU_ICONS.play),
} as const;

/** Text kept for screen readers (and tests) where the page shows only a glyph. */
function sr(text: string): string {
  return `<span class="sr-only">${text}</span>`;
}

const MODE_NAMES: Record<SessionKind, string> = { challenge: 'Time Challenge', sandbox: 'Sandbox' };
const MODE_HINTS: Record<SessionKind, string> = {
  challenge: 'Beat the county clock to clear the county and bank its cash. The capitol opens after Counties 1–6.',
  sandbox: 'No clock, no breakdowns, every county open. Just for fun: nothing is marked off the map.',
};

/** The season keys printed in the atlas's ocean: four round buttons in the title box. */
function seasonPickerHtml({ season, locked }: MapSeason): string {
  const buttons = SEASONS.map(id => `<button type="button" data-pick="season" data-value="${id}" aria-pressed="${id === season}" aria-label="${seasonLabel(id)}" title="${seasonLabel(id)}"${locked && id !== season ? ' disabled' : ''}>${ICO[id]}</button>`).join('');
  const note = locked ? 'The season is set by the county you are playing.' : 'The season applies to every county you play from this map.';
  return `<div class="atlas-seasons" role="group" aria-label="Season"><span class="atlas-legend" aria-hidden="true">Season</span>${buttons}${sr(note)}</div>`;
}

/** Time Challenge or Sandbox, chosen per state sheet in its empty margin. */
export function modePickerHtml(kind: SessionKind): string {
  const buttons = (['challenge', 'sandbox'] as const).map(id => `<button type="button" data-pick="mode" data-value="${id}" aria-pressed="${id === kind}" aria-label="${MODE_NAMES[id]}" title="${MODE_NAMES[id]}: ${MODE_HINTS[id]}">${ICO[id]}<span>${MODE_NAMES[id]}</span></button>`).join('');
  return `<div class="atlas-mode" role="group" aria-label="Mode">${buttons}${sr(MODE_HINTS[kind])}</div>`;
}

const ZOOM_CONTROLS = `<div class="atlas-zoom" role="group" aria-label="Map zoom"><button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in">+</button><button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out">−</button><button type="button" data-zoom="reset" aria-label="Reset View" title="Reset view">${ICO.reset}</button></div>`;

/** Corners of a path in the atlas's compact form: absolute `M`, relative `l` runs, `z`. */
export function pathBox(d: string): [number, number, number, number] {
  let x = 0, y = 0, sx = 0, sy = 0, cmd = 'M', first = true;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const tokens = d.match(/[MmLlZz]|-?\d*\.?\d+/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (/[MmLlZz]/.test(token)) {
      cmd = token; first = true;
      if (/z/i.test(token)) { x = sx; y = sy; }
      continue;
    }
    const a = Number(token), b = Number(tokens[++i]);
    const absolute = cmd === 'M' || cmd === 'L';
    x = absolute ? a : x + a;
    y = absolute ? b : y + b;
    if (first && /m/i.test(cmd)) { sx = x; sy = y; cmd = cmd === 'M' ? 'L' : 'l'; }
    first = false;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}

/**
 * A grease-pencil circle around a box, the way someone marks a map in a hurry: a lopsided,
 * slightly tilted loop that overshoots its own start. Seeded by the place, so each one keeps its
 * own scrawl. `least` is the smallest half-size, which keeps tiny regions findable.
 */
export function scribbleCircle(box: readonly [number, number, number, number], seed: string, least: number, reach = 0.64): string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const [x0, y0, x1, y1] = box;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = Math.max(least, (x1 - x0) * reach), ry = Math.max(least, (y1 - y0) * reach);
  const tilt = (rand() - 0.5) * 0.3, start = -2.6 + rand() * 0.9, turns = 1.16 + rand() * 0.2;
  const p1 = rand() * 6.28, p2 = rand() * 6.28, wobble = 0.05 + rand() * 0.04;
  const steps = 28;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = start + t * turns * Math.PI * 2;
    // Spiral slightly outward so the overlapping pass misses the first one.
    const r = 0.94 + t * 0.13 + wobble * Math.sin(t * 8.2 + p1) + wobble * 0.6 * Math.sin(t * 17 + p2);
    const ex = Math.cos(a) * rx * r, ey = Math.sin(a) * ry * r;
    points.push([cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)]);
  }
  // Catmull-Rom through the points, written as cubic Béziers.
  let d = `M${n(points[0]![0])} ${n(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)]!, b = points[i]!, c = points[i + 1]!, e = points[Math.min(points.length - 1, i + 2)]!;
    d += `C${n(b[0] + (c[0] - a[0]) / 6)} ${n(b[1] + (c[1] - a[1]) / 6)} ${n(c[0] - (e[0] - b[0]) / 6)} ${n(c[1] - (e[1] - b[1]) / 6)} ${n(c[0])} ${n(c[1])}`;
  }
  return d;
}

/** The scribble for one region on the continental map. */
export function regionScribble(atlas: AtlasData, id: string): string {
  return scribbleCircle(atlas.regions[id]!.bbox, id, atlas.viewBox[2] * 0.012);
}

/** The scribble for one county on its sheet, kept inside the region so it stays on the paper. */
export function countyScribble(shape: AtlasRegion, index: number, regionId: string): string {
  const [a, b, c, e] = pathBox(shape.counties[index - 1]!.d), [x0, y0, x1, y1] = shape.bbox;
  const box = [Math.max(a, x0), Math.max(b, y0), Math.min(c, x1), Math.min(e, y1)] as const;
  return scribbleCircle(box, `${regionId}:${index}`, Math.max(x1 - x0, y1 - y0) * 0.05, 0.56);
}

/** A sheet of paper: which photographed relief it carries, and how it is turned. */
export interface Paper { href: string; flipX: boolean; flipY: boolean }

export const ATLAS_PAPER: Paper = { href: '/atlas/paper-atlas.webp', flipX: false, flipY: false };
const SHEET_PAPERS = ['/atlas/paper-sheet-a.webp', '/atlas/paper-sheet-b.webp'];

/**
 * Every state and province is its own sheet with its own creases: one of the sheet photographs,
 * mirrored one of four ways, chosen by the region so the same state always unfolds the same.
 */
export function sheetPaper(regionId: string): Paper {
  let h = 2166136261;
  for (const ch of regionId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return { href: SHEET_PAPERS[h % SHEET_PAPERS.length]!, flipX: (h >>> 8) % 2 === 1, flipY: (h >>> 12) % 2 === 1 };
}

/**
 * The paper's folds and wrinkles, drawn in map units as the top layer of the map so they pan and
 * zoom with it: the creases belong to the sheet, not to the window. `AtlasView.fitPaper` stretches
 * it to exactly the area the unzoomed map shows.
 */
function reliefSvg(paper: Paper, [x, y, w, h]: readonly [number, number, number, number]): string {
  return `<image class="atlas-relief" href="${paper.href}" preserveAspectRatio="none" data-flip="${paper.flipX ? 'x' : ''}${paper.flipY ? 'y' : ''}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`;
}

/** One selection loop; `pathLength` lets CSS draw it on with a dash offset. */
function scribbleSvg(d: string, width: number): string {
  return `<path class="atlas-selection${d ? ' draw' : ''}" pathLength="1" style="--sw:${n(width)}" d="${d}"${d ? '' : ' hidden'}/>`;
}

const LOCK_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5.5" rx="1"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke-width="1.4"/></svg>';
const CAPITOL_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke-width="1.2"/><circle cx="6" cy="6" r="2.6" fill="none" stroke-width="1.2"/><circle cx="6" cy="6" r=".9"/></svg>';

export function regionLabel(region: RegionDef, progress: CountyProgress): string {
  return `${region.name}, ${progress.clearedCount(region.id)} of ${COUNTIES_PER_REGION} counties cleared`;
}

/** The continental atlas. `selected` gets a grease-pencil circle scrawled around it. */
export function atlasMacroSvg(atlas: AtlasData, regions: readonly RegionDef[], progress: CountyProgress, selected?: string): string {
  const [vx, vy, vw, vh] = atlas.viewBox;
  // Tab order follows the map, north to south in bands and west to east within each band, not
  // the manifest's alphabet.
  const band = vh / 14;
  const ordered = [...regions].sort((a, b) => {
    const [ax, ay] = atlas.regions[a.id]!.label, [bx, by] = atlas.regions[b.id]!.label;
    return Math.floor(ay / band) - Math.floor(by / band) || ax - bx;
  });
  const paths = ordered.map(region => {
    const shape = atlas.regions[region.id]!;
    const cleared = progress.clearedCount(region.id);
    const state = cleared === COUNTIES_PER_REGION ? ' done' : cleared > 0 ? ' started' : '';
    const label = escapeHtml(regionLabel(region, progress));
    return `<path class="atlas-region tint-${shape.tint}${state}${region.id === selected ? ' selected' : ''}" id="atlas-region-${region.id}" data-region-id="${region.id}" role="button" tabindex="0" aria-pressed="${region.id === selected}" aria-label="${label}" d="${shape.d}"><title>${label}</title></path>`;
  }).join('');
  const labels = regions.map(region => {
    const shape = atlas.regions[region.id]!;
    const [x0, y0, x1, y1] = shape.bbox;
    const size = Math.max(3.2, Math.min(11, Math.min(x1 - x0, y1 - y0) * 0.32));
    return `<g transform="translate(${n(shape.label[0])} ${n(shape.label[1])})"><text class="ls" font-size="${n(size)}">${region.postal}</text></g>`;
  }).join('');
  const capitols = regions.map(region => {
    const [x, y] = atlas.regions[region.id]!.capitol;
    return `<g transform="translate(${n(x)} ${n(y)})"><circle class="ls" r="1.3"/></g>`;
  }).join('');
  const insets = atlas.insets.map(({ box: [x, y, w, h], label }) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}"/><text x="${n(x + 4)}" y="${n(y + 8)}">${escapeHtml(label)}</text>`).join('');
  // The hover highlight and the selection scribble are their own paths over every neighbor, so
  // no sibling region paints across them. Plain strokes: no filters on a map this large.
  const selection = scribbleSvg(selected ? regionScribble(atlas, selected) : '', vw * 0.0026);
  return `<svg class="atlas-map overworld-map" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="North America road atlas: 50 states and 13 provinces and territories. Select one, then Go.">
<rect class="atlas-ocean" x="${vx - vw}" y="${vy - vh}" width="${vw * 3}" height="${vh * 3}"/>
<path class="atlas-graticule" d="${atlas.graticule}"/>
<path class="atlas-context" d="${atlas.context}"/>
<g class="atlas-regions">${paths}</g>
<path class="atlas-hover" hidden/>
<path class="atlas-lakes" d="${atlas.lakes}"/>
<path class="atlas-hwy minor" d="${atlas.highways.minor}"/>
<path class="atlas-hwy major" d="${atlas.highways.major}"/>
${selection}
<g class="atlas-capitols" aria-hidden="true">${capitols}</g>
<g class="atlas-labels" aria-hidden="true" stroke-width="1.1">${labels}</g>
<g class="atlas-insets" aria-hidden="true">${insets}</g>
${reliefSvg(ATLAS_PAPER, atlas.viewBox)}
</svg>`;
}

function badgeHtml(county: CountyDef, status: CountyStatus, extraClass = ''): string {
  const capitol = county.index === CAPITOL_COUNTY_INDEX;
  const label = `County ${county.index}: ${county.name}. ${STATUS_TEXT[status]}.`;
  const mark = status === 'locked' ? LOCK_ICON : capitol ? CAPITOL_ICON : `<span>${county.index}</span>`;
  const stamp = status === 'cleared' ? '<b class="stamp" aria-hidden="true">✕</b>' : '';
  return `<li class="county-badge ${status}${capitol ? ' capitol' : ''}${extraClass}" data-county-slot="${county.index}" data-county-completed="${status === 'cleared'}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${mark}${stamp}</li>`;
}

/** The seven county stamps for one region, County 7 (the capitol) last. */
function countyBadgesHtml(region: RegionDef, progress: CountyProgress, kind: SessionKind, selected?: number): string {
  const badges = regionCounties(region).map(county => badgeHtml(county, countyStatus(county, progress, kind), county.index === selected ? ' selected' : '')).join('');
  return `<ol class="county-badges" aria-label="${escapeHtml(region.name)}: ${progress.clearedCount(region.id)} of 7 counties cleared">${badges}</ol>`;
}

/** Back and Home Yard share the bar's left cell on both map pages. */
const ATLAS_NAV = `<div class="atlas-back"><button type="button" class="icon-btn" data-nav="back" aria-label="Back" title="Back">${ICO.back}</button><button type="button" class="icon-btn" data-menu-action="home-yard" aria-label="Home Yard" title="Home Yard">${ICO.yard}</button></div>`;
const GO_ARROW = `<span class="atlas-go-arrow">${ICO.go}</span>`;

/** Back · county badges · Go to region. */
export function macroBarHtml(region: RegionDef | undefined, progress: CountyProgress): string {
  const kind: SessionKind = 'challenge';
  const center = region
    ? `<p class="atlas-bar-title">${escapeHtml(region.name)}</p>${countyBadgesHtml(region, progress, kind)}`
    : '<p class="atlas-bar-hint sr-only">Pick a state or province. Scroll or pinch to zoom; drag to pan. Double-click to open one.</p>';
  const go = region
    ? `<button type="button" class="primary atlas-go" data-menu-action="open-region">Go to ${escapeHtml(region.name)}${GO_ARROW}</button>`
    : '<button type="button" class="primary atlas-go" data-menu-action="open-region" disabled>Select a State or Province</button>';
  return `${ATLAS_NAV}<div class="atlas-bar-center">${center}</div>${go}`;
}

export function atlasMacroHtml(atlas: AtlasData, regions: readonly RegionDef[], progress: CountyProgress, season: MapSeason, selected?: RegionDef): string {
  const fallback = atlas.schematic ? '<p class="atlas-note">Road atlas unavailable offline: showing the schematic map.</p>' : '';
  return `<div class="atlas-macro${atlas.schematic ? ' schematic' : ''}">
<div class="atlas-paper"><div class="atlas-cartouche"><p class="atlas-title">North America</p><p class="atlas-subtitle">Official Road Atlas · States, Provinces &amp; Territories</p>${seasonPickerHtml(season)}${fallback}</div>
<div class="atlas-viewport" data-pan-zoom="macro">${atlasMacroSvg(atlas, regions, progress, selected?.id)}${ZOOM_CONTROLS}</div></div>
<div class="atlas-bar" data-atlas-bar="macro">${macroBarHtml(selected, progress)}</div>
</div>`;
}

/**
 * The other side of the paper, seen while a map is still folded: the atlas's printed cover, or
 * the plain back of a state sheet with its title block.
 */
export function coverHtml(region?: RegionDef): string {
  return region
    ? `<div class="atlas-cover sheet" style="--relief:url(${sheetPaper(region.id).href})"><p class="cover-kicker">County Sheet · ${escapeHtml(region.id)}</p><p class="cover-title">${escapeHtml(region.name)}</p><p class="cover-sub">Capitol: ${escapeHtml(region.capitol)}</p><p class="cover-edition">Seven counties · Scale varies</p></div>`
    : '<div class="atlas-cover"><p class="cover-kicker">Official Road Atlas</p><img src="/atlas/globe.webp" alt="" width="420" height="420" decoding="async"><p class="cover-title">North America</p><p class="cover-sub">States · Provinces · Territories</p><p class="cover-edition">County Building Department · 63 regions · 441 counties</p></div>';
}

/** The card shown while a county loads, after the maps have been swept off the desk. */
export function splashHtml(region: RegionDef, index: number, kind: SessionKind, season: SeasonId, weather: WeatherConditionId): string {
  const county = regionCounties(region)[index - 1]!;
  return `<div class="atlas-splash" role="status" aria-live="polite"><div class="splash-card"><p class="splash-kicker">Dispatching to</p><h2>${escapeHtml(county.name)}</h2><p class="splash-sub">${escapeHtml(region.name)} · County ${county.index} of ${COUNTIES_PER_REGION}</p><p class="map-chips"><span>${ICO[kind]}${MODE_NAMES[kind]}</span><span>${ICO[season]}${seasonLabel(season)}</span><span>${ICO.weather}${weatherConditionLabel(season, weather)}</span></p><div class="splash-bar" aria-hidden="true"><i></i></div><p class="splash-note">Loading the county…</p></div></div>`;
}

/** The sheet's starting view: the region with a margin. */
export function sheetViewBox(shape: AtlasRegion): [number, number, number, number] {
  const [x0, y0, x1, y1] = shape.bbox;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.08 + 1;
  // Extra headroom at the top keeps the dossier card off the northern counties at the start.
  const top = (y1 - y0) * 0.12;
  return [x0 - pad, y0 - pad - top, x1 - x0 + pad * 2, y1 - y0 + pad * 2 + top];
}

function sheetSvg(atlas: AtlasData, region: RegionDef, regions: readonly RegionDef[], progress: CountyProgress, view: CountyViewState): string {
  const shape = atlas.regions[region.id]!;
  const [vx, vy, vw, vh] = sheetViewBox(shape);
  const unit = Math.max(vw, vh) / 100;
  const near = regions.filter(other => {
    if (other.id === region.id) return false;
    const [a, b, c, d] = atlas.regions[other.id]!.bbox;
    return c > vx - vw && a < vx + vw * 2 && d > vy - vh && b < vy + vh * 2;
  }).map(other => `<path d="${atlas.regions[other.id]!.d}"/>`).join('');
  const counties = regionCounties(region);
  const cells = counties.map(county => {
    const status = countyStatus(county, progress, view.kind);
    const label = `County ${county.index}: ${county.name}. ${STATUS_TEXT[status]}. ${weatherConditionLabel(view.season, view.weather(county.index))}.`;
    const classes = `atlas-county ${status} tint-${(county.index - 1) % 4}${county.index === view.selected ? ' selected' : ''}${county.index === view.current ? ' current' : ''}`;
    return `<path class="${classes}" data-county-index="${county.index}" data-county-completed="${status === 'cleared'}" role="button" tabindex="0" aria-pressed="${county.index === view.selected}" aria-label="${escapeHtml(label)}" d="${shape.counties[county.index - 1]!.d}"><title>${escapeHtml(label)}</title></path>`;
  }).join('');
  const labels = counties.map(county => {
    const status = countyStatus(county, progress, view.kind);
    // Every county, the capitol included, labels at its precomputed interior point: labels let
    // clicks through to the clipped cell, so a label outside the outline would be untappable.
    // The bullseye alone marks the actual capitol.
    const [x, y] = shape.counties[county.index - 1]!.label;
    const capitol = county.index === CAPITOL_COUNTY_INDEX;
    const name = capitol ? region.capitol : county.archetype.label;
    // Laid out around (0, 0) so the group can counter-scale with zoom. Stamps sit above a
    // county's number; the capitol's goes under its name, clear of the bullseye.
    const sy = capitol ? unit * 6.6 : -unit * 3.4;
    const stamp = status === 'cleared'
      ? `<text class="county-stamp" y="${n(sy)}" font-size="${n(unit * 3)}" transform="rotate(-12 0 ${n(sy)})">CONDEMNED</text>`
      : status === 'locked' ? `<text class="county-lock" y="${n(sy)}" font-size="${n(unit * 2.4)}">LOCKED</text>` : '';
    return `<g class="county-label ${status}" data-county-label="${county.index}" transform="translate(${n(x)} ${n(y)})"><g class="ls"><text class="num" font-size="${n(unit * 4.2)}">${county.index}</text><text class="name" y="${n(unit * 3.4)}" font-size="${n(unit * 2.3)}">${escapeHtml(name)}</text>${stamp}</g></g>`;
  }).join('');
  const [cx, cy] = shape.capitol;
  const bullseye = `<g class="capitol-bullseye" transform="translate(${n(cx)} ${n(cy)})"><g class="ls"><circle r="${n(unit * 2.6)}"/><circle r="${n(unit * 1.5)}"/><circle class="dot" r="${n(unit * 0.55)}"/></g></g>`;
  return `<svg class="atlas-map county-map" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${escapeHtml(region.name)}: seven counties. Select one, then Go.">
<defs><clipPath id="atlas-sheet-clip"><path d="${shape.d}"/></clipPath></defs>
<rect class="atlas-ocean" x="${n(vx - vw)}" y="${n(vy - vh)}" width="${n(vw * 3)}" height="${n(vh * 3)}"/>
<path class="atlas-context" d="${atlas.context}"/>
<g class="atlas-neighbors">${near}</g>
<g clip-path="url(#atlas-sheet-clip)"><g class="atlas-counties">${cells}</g><path class="atlas-hover" hidden/><path class="atlas-hwy minor" d="${atlas.highways.minor}"/><path class="atlas-hwy major" d="${atlas.highways.major}"/></g>
<path class="atlas-lakes" d="${atlas.lakes}"/>
<path class="atlas-outline" d="${shape.d}"/>
<g class="atlas-county-labels" aria-hidden="true" stroke-width="${n(unit * 0.7)}">${labels}${bullseye}</g>
${scribbleSvg(view.selected ? countyScribble(shape, view.selected, region.id) : '', unit * 0.4)}
${reliefSvg(sheetPaper(region.id), [vx, vy, vw, vh])}
</svg>`;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** `current`: the selected county is the one being played. `replacing`: deploying would end a paused run. */
export interface CountyCardRun {
  current: boolean;
  replacing: boolean;
}

const DETAIL_LABELS: Record<WeatherDetail, string> = { on: 'On', reduced: 'Reduced', off: 'Off' };

/** The county dossier pinned over the sheet: status, objective, regional flavor, and run warnings. */
export function countyCardHtml(region: RegionDef, progress: CountyProgress, view: CountyViewState, run: CountyCardRun = { current: false, replacing: false }): string {
  // Nothing picked: no card. The bar's Go button already says what to do.
  if (!view.selected) return '';
  const county = regionCounties(region)[view.selected - 1]!;
  const status = countyStatus(county, progress, view.kind);
  const level = county.level;
  const flavor = REGIONAL_FLAVORS[region.flavor];
  const signatures = [...flavor.signatures, ...county.archetype.signatures].slice(0, 3).map(spec => `<li>${escapeHtml(spec.label)}</li>`).join('');
  const fact = (icon: string, label: string, value: string) => `<div><dt title="${label}">${icon}${sr(label)}</dt><dd>${value}</dd></div>`;
  const objective = view.kind === 'challenge'
    ? fact(ICO.target, 'Objective', `${sr('Demolish ')}${escapeHtml(level.landmark.label)}`)
      + fact(ICO.cash, 'Earn', `$${level.dollarTarget.toLocaleString('en-US')}`)
      + fact(ICO.clock, 'County clock', clock(level.timeLimit))
    : fact(ICO.target, 'Landmark', escapeHtml(level.landmark.label));
  const lockNote = status === 'locked'
    ? `<p class="caution" id="county-lock-note">${ICO.lock}Clear Counties 1–6 in ${escapeHtml(region.name)} to open the capitol.</p>`
    : '';
  const runNote = run.current
    ? `<p class="county-current">${ICO.playing}Playing now</p><button type="button" data-menu-action="deploy" aria-describedby="deploy-replace-note">Restart County ${county.index}</button><p class="caution" id="deploy-replace-note">${ICO.caution}Restarting resets this county's cash and demolition.</p>`
    : run.replacing && status !== 'locked' ? `<p class="caution" id="deploy-replace-note">${ICO.caution}Deploying ends your current county run.</p>` : '';
  // Phones start with the facts folded so the dossier does not cover the county map.
  const open = typeof matchMedia !== 'function' || !matchMedia('(max-width: 760px)').matches;
  return `<section class="county-card dossier ${status}" aria-labelledby="county-card-title">
<h3 id="county-card-title">${escapeHtml(county.name)}</h3>
<p class="dossier-status"><span class="county-no">${county.index}${sr('/7')}</span>${sr(' · ')}${escapeHtml(county.archetype.label)}${sr(' · ')}<strong>${STATUS_TEXT[status]}</strong></p>
<details class="dossier-facts"${open ? ' open' : ''}><summary>County intel</summary>
<dl class="credits-list county-facts">
${objective}
${fact(ICO.pin, 'Region', escapeHtml(flavor.label))}
${fact(ICO.eye, 'Watch for', `<ul class="watch-list">${signatures}</ul>`)}
</dl></details>
${lockNote}${runNote}
</section>`;
}

/** Back · selected county badge and weather · Go to county (or Resume it). */
export function sheetBarHtml(region: RegionDef, progress: CountyProgress, view: CountyViewState, run: CountyCardRun, effects: WeatherDetail = 'on'): string {
  const back = ATLAS_NAV;
  if (!view.selected) {
    return `${back}<div class="atlas-bar-center"><p class="atlas-bar-hint sr-only">Select a county. Weather can be changed once one is picked.</p></div><button type="button" class="primary atlas-go" data-menu-action="deploy" disabled>Select a County</button>`;
  }
  const county = regionCounties(region)[view.selected - 1]!;
  const status = countyStatus(county, progress, view.kind);
  const weather = view.weather(county.index);
  const effectOptions = WEATHER_DETAILS.map(id => `<option value="${id}"${id === effects ? ' selected' : ''}>${DETAIL_LABELS[id]}</option>`).join('');
  const weatherOptions = WEATHER_CONDITIONS.map(id => `<option value="${id}"${id === weather ? ' selected' : ''}>${weatherConditionLabel(view.season, id)}</option>`).join('');
  const center = `<ol class="county-badges single">${badgeHtml(county, status)}</ol><div class="atlas-bar-intel"><p class="atlas-bar-title">${escapeHtml(county.shortName)}</p><label class="atlas-weather" title="Weather">${ICO.weather}${sr('Weather')}<select id="county-weather">${weatherOptions}</select></label><button type="button" class="weather-cycle" data-weather-cycle data-menu-action="cycle-weather" aria-label="Next weather" title="Next weather">↻</button><label class="atlas-weather" title="Weather effects">${ICO.effects}${sr('Effects')}<select id="county-effects">${effectOptions}</select></label></div>`;
  let go: string;
  if (run.current) go = `<button type="button" class="primary atlas-go" data-menu-action="resume">Resume ${escapeHtml(county.mapName)}</button>`;
  else if (status === 'locked') go = '<button type="button" class="primary atlas-go" data-menu-action="deploy" disabled aria-describedby="county-lock-note">Locked: Clear Counties 1–6</button>';
  else go = `<button type="button" class="primary atlas-go" data-menu-action="deploy"${run.replacing ? ' aria-describedby="deploy-replace-note"' : ''} aria-label="Go to ${escapeHtml(county.name)}">Go to ${escapeHtml(county.mapName)}${GO_ARROW}</button>`;
  return `${back}<div class="atlas-bar-center">${center}</div>${go}`;
}

export function atlasSheetHtml(atlas: AtlasData, region: RegionDef, regions: readonly RegionDef[], progress: CountyProgress, view: CountyViewState, effects: WeatherDetail, run: CountyCardRun): string {
  const title = `${region.name} — Capitol: ${region.capitol}`;
  return `<section class="atlas-sheet" role="region" aria-labelledby="atlas-sheet-title" data-region-sheet="${region.id}">
<div class="atlas-paper"><header class="atlas-sheet-head"><h2 id="atlas-sheet-title">${escapeHtml(title)}</h2><p class="region-summary" title="Counties cleared">${sr(`${escapeHtml(region.id)} · `)}${progress.clearedCount(region.id)}/7${sr(' counties cleared')}</p><p class="map-chips"><span>${ICO[view.season]}${seasonLabel(view.season)}</span></p></header>
<div class="atlas-sheet-body"><div class="atlas-viewport" data-pan-zoom="sheet">${sheetSvg(atlas, region, regions, progress, view)}${ZOOM_CONTROLS}</div>
<div class="county-card-host">${countyCardHtml(region, progress, view, run)}</div>${modePickerHtml(view.kind)}</div></div>
<div class="atlas-bar" data-atlas-bar="sheet">${sheetBarHtml(region, progress, view, run, effects)}</div>
</section>`;
}
