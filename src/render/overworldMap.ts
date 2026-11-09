import type { CountyProgress } from '../game/countyProgress';
import type { SessionKind } from '../game/session';
import type { AtlasData, AtlasRegion } from '../world/atlas';
import { CAPITOL_COUNTY_INDEX, COUNTIES_PER_REGION, regionCounties, type CountyDef } from '../world/counties';
import { REGIONAL_FLAVORS } from '../world/regionalCatalog';
import type { RegionDef } from '../world/regions';
import {
  seasonLabel,
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

export interface MapChips {
  mode: string;
  season: SeasonId;
}

function chipsHtml(chips: MapChips): string {
  return `<p class="map-chips"><span>${escapeHtml(chips.mode)}</span><span>${seasonLabel(chips.season)} · locked</span></p>`;
}

const ZOOM_CONTROLS = '<div class="atlas-zoom" role="group" aria-label="Map zoom"><button type="button" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="out" aria-label="Zoom out">−</button><button type="button" data-zoom="reset">Reset View</button></div>';

const LOCK_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5.5" rx="1"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke-width="1.4"/></svg>';
const CAPITOL_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke-width="1.2"/><circle cx="6" cy="6" r="2.6" fill="none" stroke-width="1.2"/><circle cx="6" cy="6" r=".9"/></svg>';

export function regionLabel(region: RegionDef, progress: CountyProgress): string {
  return `${region.name}, ${progress.clearedCount(region.id)} of ${COUNTIES_PER_REGION} counties cleared`;
}

/** The continental atlas. `selected` gets the grease-pencil outline drawn over its neighbors. */
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
  // Copies of the selected outline drawn over every neighbor. Real paths, not <use>: a <use> clone
  // keeps the region's own stroke rules. Elevation is an offset dark stroke rather than a filter,
  // since filters on a map this large add compositor layers Chromium can tile badly.
  const d = selected ? atlas.regions[selected]!.d : '';
  const hide = selected ? '' : ' hidden';
  const selection = `<path class="atlas-selection-shadow" transform="translate(.8 1.4)" d="${d}"${hide}/><path class="atlas-selection" d="${d}"${hide}/>`;
  return `<svg class="atlas-map overworld-map" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="North America road atlas: 50 states and 13 provinces and territories. Select one, then Go.">
<rect class="atlas-ocean" x="${vx - vw}" y="${vy - vh}" width="${vw * 3}" height="${vh * 3}"/>
<path class="atlas-graticule" d="${atlas.graticule}"/>
<path class="atlas-context" d="${atlas.context}"/>
<g class="atlas-regions">${paths}</g>
<path class="atlas-lakes" d="${atlas.lakes}"/>
<path class="atlas-hwy minor" d="${atlas.highways.minor}"/>
<path class="atlas-hwy major" d="${atlas.highways.major}"/>
${selection}
<g class="atlas-capitols" aria-hidden="true">${capitols}</g>
<g class="atlas-labels" aria-hidden="true" stroke-width="1.1">${labels}</g>
<g class="atlas-insets" aria-hidden="true">${insets}</g>
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

/** Back · county badges · Go to region. */
export function macroBarHtml(region: RegionDef | undefined, progress: CountyProgress, kind: SessionKind): string {
  const center = region
    ? `<p class="atlas-bar-title">${escapeHtml(region.name)}</p>${countyBadgesHtml(region, progress, kind)}`
    : '<p class="atlas-bar-hint">Pick a state or province. Scroll or pinch to zoom; drag to pan. Double-click to open one.</p>';
  const go = region
    ? `<button type="button" class="primary atlas-go" data-menu-action="open-region">Go to ${escapeHtml(region.name)}</button>`
    : '<button type="button" class="primary atlas-go" data-menu-action="open-region" disabled>Select a State or Province</button>';
  return `<button type="button" class="atlas-back" data-nav="back">Back</button><div class="atlas-bar-center">${center}</div>${go}`;
}

export function atlasMacroHtml(atlas: AtlasData, regions: readonly RegionDef[], progress: CountyProgress, kind: SessionKind, chips: MapChips, selected?: RegionDef): string {
  const note = kind === 'challenge' ? 'Clear Counties 1–6 in a state or province to open its capitol.' : 'Sandbox: every county is open.';
  const fallback = atlas.schematic ? '<p class="atlas-note">Road atlas unavailable offline: showing the schematic map.</p>' : '';
  return `<div class="atlas-macro${atlas.schematic ? ' schematic' : ''}">
<div class="atlas-cartouche"><p class="atlas-title">North America</p><p class="atlas-subtitle">Road Atlas · States &amp; Provinces</p>${chipsHtml(chips)}<p class="atlas-note">${note}</p>${fallback}</div>
<div class="atlas-viewport" data-pan-zoom="macro">${atlasMacroSvg(atlas, regions, progress, selected?.id)}${ZOOM_CONTROLS}</div>
<div class="atlas-bar" data-atlas-bar="macro">${macroBarHtml(selected, progress, kind)}</div>
</div>`;
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
    const [x, y] = county.index === CAPITOL_COUNTY_INDEX ? shape.capitol : shape.counties[county.index - 1]!.label;
    const capitol = county.index === CAPITOL_COUNTY_INDEX;
    const name = capitol ? region.capitol : county.archetype.label;
    // Laid out around (0, 0) so the group can counter-scale with zoom. Stamps sit above a
    // county's number; the capitol's goes under its name, clear of the bullseye.
    const top = capitol ? unit * 5.2 : 0;
    const sy = capitol ? top + unit * 6.6 : -unit * 3.4;
    const stamp = status === 'cleared'
      ? `<text class="county-stamp" y="${n(sy)}" font-size="${n(unit * 3)}" transform="rotate(-12 0 ${n(sy)})">CONDEMNED</text>`
      : status === 'locked' ? `<text class="county-lock" y="${n(sy)}" font-size="${n(unit * 2.4)}">LOCKED</text>` : '';
    return `<g class="county-label ${status}" data-county-label="${county.index}" transform="translate(${n(x)} ${n(y)})"><g class="ls"><text class="num" y="${n(top)}" font-size="${n(unit * 4.2)}">${county.index}</text><text class="name" y="${n(top + unit * 3.4)}" font-size="${n(unit * 2.3)}">${escapeHtml(name)}</text>${stamp}</g></g>`;
  }).join('');
  const [cx, cy] = shape.capitol;
  const bullseye = `<g class="capitol-bullseye" transform="translate(${n(cx)} ${n(cy)})"><g class="ls"><circle r="${n(unit * 2.6)}"/><circle r="${n(unit * 1.5)}"/><circle class="dot" r="${n(unit * 0.55)}"/></g></g>`;
  return `<svg class="atlas-map county-map" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${escapeHtml(region.name)}: seven counties. Select one, then Go.">
<defs><clipPath id="atlas-sheet-clip"><path d="${shape.d}"/></clipPath></defs>
<rect class="atlas-ocean" x="${n(vx - vw)}" y="${n(vy - vh)}" width="${n(vw * 3)}" height="${n(vh * 3)}"/>
<path class="atlas-context" d="${atlas.context}"/>
<g class="atlas-neighbors">${near}</g>
<g clip-path="url(#atlas-sheet-clip)"><g class="atlas-counties">${cells}</g><path class="atlas-hwy minor" d="${atlas.highways.minor}"/><path class="atlas-hwy major" d="${atlas.highways.major}"/></g>
<path class="atlas-lakes" d="${atlas.lakes}"/>
<path class="atlas-outline" d="${shape.d}"/>
<g class="atlas-county-labels" aria-hidden="true" stroke-width="${n(unit * 0.7)}">${labels}${bullseye}</g>
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
  if (!view.selected) {
    return '<section class="county-card dossier hint" aria-label="County intel"><p>Select a county on the sheet — double-click to deploy.</p></section>';
  }
  const county = regionCounties(region)[view.selected - 1]!;
  const status = countyStatus(county, progress, view.kind);
  const level = county.level;
  const flavor = REGIONAL_FLAVORS[region.flavor];
  const signatures = [...flavor.signatures, ...county.archetype.signatures].map(spec => spec.label).slice(0, 3).join(', ');
  const objective = view.kind === 'challenge'
    ? `<div><dt>Objective</dt><dd>Demolish ${escapeHtml(level.landmark.label)} and earn $${level.dollarTarget.toLocaleString('en-US')} in ${clock(level.timeLimit)}</dd></div>`
    : `<div><dt>Landmark</dt><dd>${escapeHtml(level.landmark.label)}</dd></div>`;
  const lockNote = status === 'locked'
    ? `<p class="caution" id="county-lock-note">Clear Counties 1–6 in ${escapeHtml(region.name)} to open the capitol.</p>`
    : '';
  const runNote = run.current
    ? `<p class="fine-print county-current">You are playing this county. Resume keeps your run; Restart rebuilds it with the weather below.</p><button type="button" data-menu-action="deploy" aria-describedby="deploy-replace-note">Restart County ${county.index}</button><p class="caution" id="deploy-replace-note">Restarting resets this county's cash, demolition, and upgrades.</p>`
    : run.replacing && status !== 'locked' ? '<p class="caution" id="deploy-replace-note">Deploying ends your current county run. Resume from the pause menu to keep playing it.</p>' : '';
  // Phones start with the facts folded so the dossier does not cover the county map.
  const open = typeof matchMedia !== 'function' || !matchMedia('(max-width: 760px)').matches;
  return `<section class="county-card dossier ${status}" aria-labelledby="county-card-title">
<h3 id="county-card-title">${escapeHtml(county.name)}</h3>
<p class="dossier-status">County ${county.index}/7 · ${escapeHtml(county.archetype.label)} · <strong>${STATUS_TEXT[status]}</strong></p>
<details class="dossier-facts"${open ? ' open' : ''}><summary>County intel</summary>
<dl class="credits-list county-facts">
${objective}
<div><dt>Region</dt><dd>${escapeHtml(flavor.label)}</dd></div>
<div><dt>Watch for</dt><dd>${escapeHtml(signatures)}</dd></div>
</dl></details>
${lockNote}${runNote}
</section>`;
}

/** Back · selected county badge and weather · Go to county (or Resume it). */
export function sheetBarHtml(region: RegionDef, progress: CountyProgress, view: CountyViewState, run: CountyCardRun, effects: WeatherDetail = 'on'): string {
  const back = '<button type="button" class="atlas-back" data-nav="back">Back</button>';
  if (!view.selected) {
    return `${back}<div class="atlas-bar-center"><p class="atlas-bar-hint">Select a county. Weather can be changed once one is picked.</p></div><button type="button" class="primary atlas-go" data-menu-action="deploy" disabled>Select a County</button>`;
  }
  const county = regionCounties(region)[view.selected - 1]!;
  const status = countyStatus(county, progress, view.kind);
  const weather = view.weather(county.index);
  const effectOptions = WEATHER_DETAILS.map(id => `<option value="${id}"${id === effects ? ' selected' : ''}>${DETAIL_LABELS[id]}</option>`).join('');
  const weatherOptions = WEATHER_CONDITIONS.map(id => `<option value="${id}"${id === weather ? ' selected' : ''}>${weatherConditionLabel(view.season, id)}</option>`).join('');
  const center = `<ol class="county-badges single">${badgeHtml(county, status)}</ol><div class="atlas-bar-intel"><p class="atlas-bar-title">${escapeHtml(county.shortName)}</p><label class="atlas-weather">Weather<select id="county-weather">${weatherOptions}</select></label><button type="button" class="weather-cycle" data-weather-cycle data-menu-action="cycle-weather" aria-label="Next weather">↻</button><label class="atlas-weather">Effects<select id="county-effects">${effectOptions}</select></label></div>`;
  let go: string;
  if (run.current) go = `<button type="button" class="primary atlas-go" data-menu-action="resume">Resume ${escapeHtml(county.mapName)}</button>`;
  else if (status === 'locked') go = '<button type="button" class="primary atlas-go" data-menu-action="deploy" disabled aria-describedby="county-lock-note">Locked: Clear Counties 1–6</button>';
  else go = `<button type="button" class="primary atlas-go" data-menu-action="deploy"${run.replacing ? ' aria-describedby="deploy-replace-note"' : ''} aria-label="Go to ${escapeHtml(county.name)}">Go to ${escapeHtml(county.mapName)}</button>`;
  return `${back}<div class="atlas-bar-center">${center}</div>${go}`;
}

export function atlasSheetHtml(atlas: AtlasData, region: RegionDef, regions: readonly RegionDef[], progress: CountyProgress, view: CountyViewState, chips: MapChips, effects: WeatherDetail, run: CountyCardRun): string {
  const title = `${region.name} — Capitol: ${region.capitol}`;
  return `<section class="atlas-sheet" role="region" aria-labelledby="atlas-sheet-title" data-region-sheet="${region.id}">
<header class="atlas-sheet-head"><h2 id="atlas-sheet-title">${escapeHtml(title)}</h2><p class="fine-print region-summary">${escapeHtml(region.id)} · ${progress.clearedCount(region.id)}/7 counties cleared</p>${chipsHtml(chips)}</header>
<div class="atlas-sheet-body"><div class="atlas-viewport" data-pan-zoom="sheet">${sheetSvg(atlas, region, regions, progress, view)}${ZOOM_CONTROLS}</div>
<div class="county-card-host">${countyCardHtml(region, progress, view, run)}</div></div>
<div class="atlas-bar" data-atlas-bar="sheet">${sheetBarHtml(region, progress, view, run, effects)}</div>
</section>`;
}
