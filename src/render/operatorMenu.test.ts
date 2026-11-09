// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TITLE } from '../game/constants';
import { MENU_LABELS as L } from '../game/menuLabels';
import { OperatorMenu, type MenuActions } from './operatorMenu';
import { resetSharedCountyProgress, sharedCountyProgress, type ProgressStore } from '../game/countyProgress';
import { countyWeather } from '../world/counties';
import { loadOverworld } from '../game/overworldLoader';
import { resetAtlasCache, schematicAtlas } from '../world/atlas';

let parent: HTMLElement;
let actions: { [K in keyof MenuActions]-?: ReturnType<typeof vi.fn> };
let menu: OperatorMenu;
const running = { session: 'challenge', season: 'winter', effects: 'reduced', regionId: 'US-MI', countyIndex: 3, weather: 'fog', mapSeed: 42 } as const;
const heading = () => menu.root.querySelector('#operator-heading')!.textContent;
const button = (selector: string) => menu.root.querySelector<HTMLButtonElement>(selector)!;
const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
/** The overworld chunk and atlas load on demand; let the imports, fetch and continuation run. */
const settle = async () => {
  await loadOverworld();
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
};
const openMap = async () => {
  button('[data-menu-action="open-map"]').click();
  await settle();
};
/** Map shapes are SVG paths, which have no click(); dispatch the event the browser would. */
const tap = (selector: string) => {
  const el = menu.root.querySelector(selector);
  if (!el) throw new Error(`No map target ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
const region = (id: string) => `.atlas-macro [data-region-id="${id}"]`;
const county = (index: number) => `.atlas-sheet [data-county-index="${index}"]`;
const go = () => [...menu.root.querySelectorAll<HTMLButtonElement>('.atlas-go')].at(-1)!;
/** Single-click a region, then Go to it. */
const openRegion = (id: string) => {
  tap(region(id));
  go().click();
};
const select = (id: string, value: string) => {
  const el = menu.root.querySelector<HTMLSelectElement>(`#${id}`)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  resetAtlasCache();
  // No network in unit tests: the atlas falls back to the schematic map.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  localStorage.clear();
  resetSharedCountyProgress();
  document.body.innerHTML = '<div id="game-root"><canvas tabindex="0"></canvas></div><div id="host"></div>';
  parent = document.querySelector<HTMLElement>('#host')!;
  actions = {
    page: vi.fn(), resume: vi.fn(), start: vi.fn(), mapSeed: vi.fn(() => 1234), restart: vi.fn(), debug: vi.fn(), title: vi.fn(), mute: vi.fn(),
    click: vi.fn(), unlockSound: vi.fn(() => Promise.resolve()), titleSound: vi.fn(), pwaUpdate: vi.fn(),
  };
  menu = new OperatorMenu(parent, actions);
});

it('asks only for mode and season, then opens the full-viewport atlas with nothing selected', async () => {
  menu.show('title');
  expect(menu.root.hidden).toBe(false);
  expect(heading()).toBe(TITLE);
  button('[data-nav="dispatch"]').click();
  expect(heading()).toBe(L.newGame);
  expect(actions.click).toHaveBeenCalled();
  expect([...menu.root.querySelectorAll('.dispatch-fields select')].map(el => el.id)).toEqual(['dispatch-mode', 'dispatch-season']);
  expect(menu.root.querySelector('#dispatch-lot')).toBeNull();
  expect(menu.root.querySelector('#dispatch-effects')).toBeNull();
  expect([...menu.root.querySelectorAll<HTMLOptionElement>('#dispatch-season option')].map(o => o.value)).toEqual(['spring', 'summer', 'autumn', 'winter']);
  select('dispatch-mode', 'challenge');
  select('dispatch-season', 'winter');
  expect(menu.root.querySelector('#mode-description')!.textContent).toMatch(/capitol/);
  await openMap();
  expect(heading()).toBe('North America');
  expect(menu.root.classList.contains('map-open')).toBe(true);
  expect(menu.root.querySelectorAll('.overworld-map [data-region-id]')).toHaveLength(63);
  expect(menu.root.querySelector('.map-chips')!.textContent).toContain('Winter · locked');
  // The searchable sidebar is gone; the map is the picker.
  expect(menu.root.querySelector('#region-search')).toBeNull();
  expect(menu.root.querySelector('.region-list')).toBeNull();
  expect(go().disabled).toBe(true);
  expect(go().textContent).toBe('Select a State or Province');
  expect(menu.root.querySelector('.county-badges')).toBeNull();
  expect(menu.root.querySelector('#county-weather')).toBeNull();
  expect(menu.root.querySelectorAll('.atlas-zoom [data-zoom]')).toHaveLength(3);
  expect(actions.start).not.toHaveBeenCalled();
});

it('single-click selects a region and shows its seven county badges; Go opens the state sheet over the map', async () => {
  const progress = sharedCountyProgress();
  progress.markCleared('US-IL', 2);
  progress.markCleared('US-IL', 5);
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  select('dispatch-mode', 'challenge');
  await openMap();
  tap(region('US-IL'));
  expect(heading()).toBe('North America');
  expect(menu.root.querySelector(region('US-IL'))!.getAttribute('aria-pressed')).toBe('true');
  expect(menu.root.querySelector('.atlas-selection')!.getAttribute('d')).toBe(menu.root.querySelector(region('US-IL'))!.getAttribute('d'));
  const badges = [...menu.root.querySelectorAll<HTMLElement>('[data-atlas-bar="macro"] [data-county-slot]')];
  expect(badges.map(b => b.dataset.countySlot)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  expect(badges.map(b => b.dataset.countyCompleted)).toEqual(['false', 'true', 'false', 'false', 'true', 'false', 'false']);
  expect(badges[6]!.classList.contains('capitol')).toBe(true);
  expect(badges[6]!.classList.contains('locked')).toBe(true);
  expect(badges[6]!.getAttribute('aria-label')).toContain("Springfield Capitol District — Governor's Mansion. Locked");
  expect(badges[1]!.getAttribute('aria-label')).toContain('Cleared');
  expect(go().disabled).toBe(false);
  expect(go().textContent).toBe('Go to Illinois');
  // Picking another region moves the selection.
  tap(region('CA-ON'));
  expect(go().textContent).toBe('Go to Ontario');
  expect(menu.root.querySelector(region('US-IL'))!.getAttribute('aria-pressed')).toBe('false');
  tap(region('US-IL'));
  go().click();
  expect(heading()).toBe('Illinois');
  expect(menu.root.querySelector('#atlas-sheet-title')!.textContent).toBe('Illinois — Capitol: Springfield');
  expect(menu.root.querySelector<HTMLElement>('.atlas-macro')!.inert).toBe(true);
  expect(menu.root.querySelectorAll('.atlas-sheet [data-county-index]')).toHaveLength(7);
  expect(menu.root.querySelector('#atlas-sheet-clip')).not.toBeNull();
  expect(menu.root.querySelector(county(2))!.getAttribute('data-county-completed')).toBe('true');
  expect(go().disabled).toBe(true);
  expect(go().textContent).toBe('Select a County');
  // Back closes the sheet and keeps the continental map and its selection.
  [...menu.root.querySelectorAll<HTMLButtonElement>('.atlas-sheet [data-nav="back"]')][0]!.click();
  expect(heading()).toBe('North America');
  expect(menu.root.querySelector('.atlas-sheet')).toBeNull();
  expect(menu.root.querySelector<HTMLElement>('.atlas-macro')!.inert).toBe(false);
  expect(go().textContent).toBe('Go to Illinois');
});

it('double-click opens a region, and double-click on an open county deploys it', async () => {
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  await openMap();
  tap(region('US-OH'));
  tap(region('US-OH'));
  expect(heading()).toBe('Ohio');
  tap(county(4));
  expect(actions.start).not.toHaveBeenCalled();
  expect(go().textContent).toBe('Go to Suburban County');
  expect(go().getAttribute('aria-label')).toBe('Go to Ohio Suburban County');
  tap(county(4));
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sandbox', regionId: 'US-OH', countyIndex: 4 }));
});

it('deploys a sandbox county with its rolled weather, and only the sheet changes weather', async () => {
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  select('dispatch-season', 'autumn');
  await openMap();
  openRegion('US-TX');
  expect(heading()).toBe('Texas');
  expect(menu.root.querySelector('#county-weather')).toBeNull();
  tap(county(1));
  expect(menu.root.querySelector('#county-card-title')!.textContent).toBe('Texas Farmstead County');
  expect(go().textContent).toBe('Go to Farmstead County');
  tap(county(7));
  expect(menu.root.querySelector('#county-card-title')!.textContent).toBe("Austin Capitol District — Governor's Mansion");
  expect(go().textContent).toBe('Go to Austin');
  expect(go().disabled).toBe(false);
  expect(menu.root.querySelector('.atlas-bar [data-county-slot="7"]')).not.toBeNull();
  const rolled = menu.root.querySelector<HTMLSelectElement>('#county-weather')!.value;
  expect(rolled).toBe(countyWeather(1234, 'autumn', 'US-TX', 7));
  go().click();
  expect(actions.start).toHaveBeenLastCalledWith({ kind: 'sandbox', season: 'autumn', regionId: 'US-TX', countyIndex: 7, weather: rolled, effects: 'on', mapSeed: 1234 });
  select('county-weather', 'fog');
  select('county-effects', 'reduced');
  expect(document.activeElement?.id).toBe('county-weather');
  go().click();
  expect(actions.start).toHaveBeenLastCalledWith(expect.objectContaining({ countyIndex: 7, weather: 'fog', effects: 'reduced' }));
  // The cycle button steps to the next condition.
  button('[data-weather-cycle]').click();
  expect(menu.root.querySelector<HTMLSelectElement>('#county-weather')!.value).not.toBe('fog');
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('North America');
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe(L.newGame);
});

it('locks the capitol in Time Challenge until Counties 1–6 are cleared', async () => {
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  select('dispatch-mode', 'challenge');
  await openMap();
  openRegion('CA-ON');
  expect(menu.root.querySelector(county(7))!.classList.contains('locked')).toBe(true);
  tap(county(7));
  expect(go().disabled).toBe(true);
  expect(menu.root.querySelector('#county-lock-note')!.textContent).toContain('Ontario');
  tap(county(7));
  go().click();
  expect(actions.start).not.toHaveBeenCalled();
  const progress = sharedCountyProgress();
  for (let index = 1; index <= 6; index++) progress.markCleared('CA-ON', index);
  key(menu.root, { key: 'Escape' });
  expect(menu.root.querySelector(region('CA-ON'))!.getAttribute('aria-label')).toContain('6 of 7');
  expect(menu.root.querySelectorAll('[data-atlas-bar="macro"] [data-county-completed="true"]')).toHaveLength(6);
  // Enter on the selected region opens it, like a double-click.
  key(menu.root.querySelector(region('CA-ON'))!, { key: 'Enter' });
  expect(heading()).toBe('Ontario');
  tap(county(7));
  go().click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'challenge', regionId: 'CA-ON', countyIndex: 7 }));
});

it('keeps same-session clears on the map when storage writes fail', async () => {
  const blocked: ProgressStore = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const progress = resetSharedCountyProgress(blocked);
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  select('dispatch-mode', 'challenge');
  await openMap();
  openRegion('US-GA');
  tap(county(7));
  expect(go().disabled).toBe(true);
  // The game clears 1–6 through the shared record while storage refuses every write.
  for (let index = 1; index <= 6; index++) progress.markCleared('US-GA', index);
  key(menu.root, { key: 'Escape' });
  expect(menu.root.querySelector(region('US-GA'))!.getAttribute('aria-label')).toContain('6 of 7');
  go().click();
  tap(county(7));
  expect(go().disabled).toBe(false);
});

it('keeps only the newest map request when Open Map is clicked again while the atlas loads', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  await settle();
  button('[data-menu-action="open-map"]').click();
  button('[data-menu-action="open-map"]').click();
  release(new Response(JSON.stringify(schematicAtlas())));
  await settle();
  expect(heading()).toBe('North America');
  expect(actions.mapSeed).toHaveBeenCalledOnce();
  // The mounted map's pan/zoom still works: no late request destroyed it.
  const svg = menu.root.querySelector('.overworld-map')!;
  const before = svg.getAttribute('viewBox');
  button('.atlas-macro [data-zoom="in"]').click();
  expect(svg.getAttribute('viewBox')).not.toBe(before);
});

it('drops a run-map load that finishes after the player moved on to New Game', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  menu.show('pause', running);
  button('[data-menu-action="world-map"]').click();
  button('[data-nav="dispatch"]').click();
  select('dispatch-mode', 'sandbox');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  release(new Response(JSON.stringify(schematicAtlas())));
  await settle();
  expect(heading()).toBe(L.newGame);
  expect(menu.root.querySelector<HTMLSelectElement>('#dispatch-mode')!.value).toBe('sandbox');
  await openMap();
  expect(menu.root.querySelector('.map-chips')!.textContent).toContain('Sandbox');
});

it('never offers to resume the paused run from a New Game map', async () => {
  menu.show('pause', running);
  button('[data-nav="dispatch"]').click();
  select('dispatch-mode', 'sandbox');
  select('dispatch-season', 'summer');
  await openMap();
  openRegion('US-MI');
  expect(menu.root.querySelector(county(3))!.classList.contains('current')).toBe(false);
  tap(county(3));
  expect(go().textContent).toBe('Go to Works County');
  expect(menu.root.querySelector('[data-menu-action="resume"]')).toBeNull();
  expect(menu.root.querySelector('#deploy-replace-note')!.textContent).toMatch(/ends your current county run/);
  tap(county(3));
  expect(actions.resume).not.toHaveBeenCalled();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sandbox', season: 'summer', regionId: 'US-MI', countyIndex: 3 }));
});

it('renders the fetched road atlas when it is available', async () => {
  const atlas = { ...schematicAtlas(), source: 'fixture', schematic: undefined };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(atlas)))));
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  await openMap();
  expect(fetch).toHaveBeenCalledWith('/atlas/north-america-atlas.json');
  expect(menu.root.querySelector('.atlas-macro')!.classList.contains('schematic')).toBe(false);
  expect(menu.root.querySelectorAll('.overworld-map [data-region-id]')).toHaveLength(63);
});

it('pauses on the running setup and routes each action', () => {
  menu.show('pause', { session: 'challenge', season: 'spring', effects: 'off', regionId: 'US-IL' });
  expect(heading()).toBe('Paused');
  for (const action of ['resume', 'restart', 'debug', 'title', 'mute'] as const) {
    button(`[data-menu-action="${action}"]`).click();
    expect(actions[action]).toHaveBeenCalledOnce();
  }
  button('[data-nav="dispatch"]').click();
  expect(menu.root.querySelector<HTMLSelectElement>('#dispatch-mode')!.value).toBe('challenge');
  expect(menu.root.querySelector<HTMLSelectElement>('#dispatch-season')!.value).toBe('spring');
  expect(menu.root.querySelector('.caution')).not.toBeNull();
});

/** Pause-menu map buttons load the chunk the same way Open Map does. */
const pauseMap = async (action: 'state-map' | 'world-map') => {
  button(`[data-menu-action="${action}"]`).click();
  await settle();
};

it('opens the state map over a paused run without ending it, and resumes from the running county', async () => {
  menu.show('pause', running);
  expect(button('[data-menu-action="state-map"]').textContent).toBe(L.stateMap);
  await pauseMap('state-map');
  expect(heading()).toBe('Michigan');
  expect(menu.root.querySelector('.atlas-sheet .map-chips')!.textContent).toContain('Winter · locked');
  expect(menu.root.querySelector(county(3))!.classList.contains('current')).toBe(true);
  expect(menu.root.querySelector(county(3))!.classList.contains('selected')).toBe(true);
  expect(menu.root.querySelector<HTMLSelectElement>('#county-weather')!.value).toBe('fog');
  expect(go().textContent).toBe('Resume Works County');
  expect(actions.start).not.toHaveBeenCalled();
  expect(actions.title).not.toHaveBeenCalled();
  go().click();
  expect(actions.resume).toHaveBeenCalledOnce();
  expect(actions.start).not.toHaveBeenCalled();
});

it('browses the world map from pause, warns before replacing the run, and steps back to the pause menu', async () => {
  menu.show('pause', running);
  await pauseMap('world-map');
  expect(heading()).toBe('North America');
  expect(menu.root.querySelector(region('US-MI'))!.getAttribute('aria-pressed')).toBe('true');
  openRegion('US-OH');
  tap(county(1));
  expect(menu.root.querySelector('#deploy-replace-note')!.textContent).toMatch(/ends your current county run/);
  expect(menu.root.querySelector('[data-menu-action="resume"]')).toBeNull();
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('North America');
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('Paused');
  expect(actions.resume).not.toHaveBeenCalled();
  await pauseMap('world-map');
  openRegion('US-OH');
  tap(county(2));
  go().click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'challenge', season: 'winter', regionId: 'US-OH', countyIndex: 2, mapSeed: 42 }));
});

it('restarts the running county from its card with the chosen weather', async () => {
  menu.show('pause', running);
  await pauseMap('state-map');
  select('county-weather', 'clear');
  button('.county-card [data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ regionId: 'US-MI', countyIndex: 3, weather: 'clear', effects: 'reduced' }));
});

it('opens run maps on the running setup after a canceled New Game draft', async () => {
  menu.show('pause', running);
  button('[data-nav="dispatch"]').click();
  select('dispatch-mode', 'sandbox');
  select('dispatch-season', 'summer');
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('Paused');
  await pauseMap('state-map');
  expect(menu.root.querySelector('.atlas-sheet .map-chips')!.textContent).toContain('Time Challenge');
  expect(menu.root.querySelector('.atlas-sheet .map-chips')!.textContent).toContain('Winter · locked');
  tap(county(7));
  expect(go().disabled).toBe(true);
  tap(county(3));
  button('.county-card [data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'challenge', season: 'winter', effects: 'reduced', regionId: 'US-MI', countyIndex: 3, weather: 'fog' }));
  // A deliberate New Game map still uses the draft.
  key(menu.root, { key: 'Escape' });
  key(menu.root, { key: 'Escape' });
  button('[data-nav="dispatch"]').click();
  select('dispatch-mode', 'sandbox');
  select('dispatch-season', 'summer');
  await openMap();
  expect(menu.root.querySelector('.map-chips')!.textContent).toContain('Sandbox');
  expect(menu.root.querySelector('.map-chips')!.textContent).toContain('Summer · locked');
});

it('offers only the world map when the paused run is not an overworld county', () => {
  menu.show('pause', { session: 'sandbox' });
  expect(menu.root.querySelector('[data-menu-action="state-map"]')).toBeNull();
  expect(menu.root.querySelector('[data-menu-action="world-map"]')).not.toBeNull();
});

it('walks the info pages, and Escape steps back before it resumes', () => {
  menu.show('pause', { session: 'sandbox' });
  button('[data-nav="controls"]').click();
  expect(heading()).toBe(L.controls);
  expect(menu.root.querySelector('.control-list')).not.toBeNull();
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('Paused');
  expect(actions.resume).not.toHaveBeenCalled();
  button('[data-nav="about"]').click();
  expect(heading()).toBe(L.about);
  expect(menu.root.querySelector('pre')!.textContent!.length).toBeGreaterThan(0);
  expect(menu.root.querySelector<HTMLElement>('.nameplate')!.hidden).toBe(false);
  button('[data-nav="back"]').click();
  button('[data-nav="equipment"]').click();
  expect(menu.root.querySelector('.menu-permit-host')).not.toBeNull();
  expect(actions.page).toHaveBeenLastCalledWith('equipment', expect.any(HTMLElement));
  key(menu.root, { key: 'Escape' });
  key(menu.root, { key: 'Escape' });
  expect(actions.resume).toHaveBeenCalledOnce();
});

it('toggles sound with M except while typing in a field', () => {
  menu.show('title', { session: 'sandbox' });
  key(menu.root, { key: 'm' });
  expect(actions.mute).toHaveBeenCalledOnce();
  key(menu.root, { key: 'M', repeat: true });
  expect(actions.mute).toHaveBeenCalledOnce();
  button('[data-nav="dispatch"]').click();
  key(menu.root.querySelector('#dispatch-mode')!, { key: 'm' });
  expect(actions.mute).toHaveBeenCalledOnce();
});

it('reflects mute state and the pending build on the home page', () => {
  menu.show('pause', { session: 'sandbox' });
  menu.syncMuted(true);
  expect(button('[data-menu-action="mute"]').getAttribute('aria-label')).toBe(L.soundOff);
  expect(button('[data-menu-action="mute"]').getAttribute('aria-pressed')).toBe('false');
  menu.setUpdateAvailable(true);
  button('[data-menu-action="pwa-update"]').click();
  expect(actions.pwaUpdate).toHaveBeenCalledOnce();
  menu.setUpdateAvailable(false);
  expect(menu.root.querySelector('.pwa-update')).toBeNull();
});

it('hands focus back to the game when it closes', () => {
  menu.show('pause', { session: 'sandbox' });
  menu.show(null);
  expect(menu.root.hidden).toBe(true);
  expect(actions.page).toHaveBeenLastCalledWith(null);
  expect(document.activeElement).toBe(document.querySelector('#game-root canvas'));
});

it('wraps Tab within the visible controls, and parks focus on the heading when none are laid out', () => {
  menu.show('pause', { session: 'sandbox' });
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  const controls = [...menu.root.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [tabindex="0"]')]
    .filter(el => !el.closest('[hidden]') && !el.matches(':disabled'));
  const first = controls[0]!, last = controls.at(-1)!;
  last.focus();
  key(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  key(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  rects.mockReturnValue([] as unknown as DOMRectList);
  key(last, { key: 'Tab' });
  expect(document.activeElement).toBe(menu.root.querySelector('#operator-heading'));
  rects.mockRestore();
});
