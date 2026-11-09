// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { TITLE } from '../game/constants';
import { MENU_LABELS as L } from '../game/menuLabels';
import { OperatorMenu, type MenuActions } from './operatorMenu';
import { CountyProgress } from '../game/countyProgress';
import { countyWeather } from '../world/counties';
import { loadOverworld } from '../game/overworldLoader';

let parent: HTMLElement;
let actions: { [K in keyof MenuActions]-?: ReturnType<typeof vi.fn> };
let menu: OperatorMenu;
const heading = () => menu.root.querySelector('#operator-heading')!.textContent;
const button = (selector: string) => menu.root.querySelector<HTMLButtonElement>(selector)!;
const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
/** The overworld chunk loads on demand; let the import and its continuation run. */
const openMap = async () => {
  button('[data-menu-action="open-map"]').click();
  await loadOverworld();
  await new Promise(resolve => setTimeout(resolve, 0));
};
const select = (id: string, value: string) => {
  const el = menu.root.querySelector<HTMLSelectElement>(`#${id}`)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="game-root"><canvas tabindex="0"></canvas></div><div id="host"></div>';
  parent = document.querySelector<HTMLElement>('#host')!;
  actions = {
    page: vi.fn(), resume: vi.fn(), start: vi.fn(), mapSeed: vi.fn(() => 1234), restart: vi.fn(), debug: vi.fn(), title: vi.fn(), mute: vi.fn(),
    click: vi.fn(), unlockSound: vi.fn(() => Promise.resolve()), titleSound: vi.fn(), pwaUpdate: vi.fn(),
  };
  menu = new OperatorMenu(parent, actions);
});

it('asks only for mode and season, then opens the overworld map', async () => {
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
  expect(menu.root.querySelectorAll('.overworld-map [data-region]')).toHaveLength(63);
  expect(menu.root.querySelector('.map-chips')!.textContent).toContain('Winter · locked');
  expect(menu.root.querySelector('#county-weather')).toBeNull();
  expect(actions.start).not.toHaveBeenCalled();
});

it('filters the region list by name, code, or capitol', async () => {
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  await openMap();
  const search = menu.root.querySelector<HTMLInputElement>('#region-search')!;
  const listed = () => [...menu.root.querySelectorAll<HTMLElement>('.region-list [data-region]')].map(el => el.dataset.region);
  expect(listed()).toHaveLength(63);
  for (const [query, expected] of [['rhode', ['US-RI']], ['YT', ['CA-YT']], ['springfield', ['US-IL']]] as const) {
    search.value = query;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(listed()).toEqual(expected);
  }
});

it('deploys a sandbox county with its rolled weather, and only the county card changes weather', async () => {
  menu.show('title');
  button('[data-nav="dispatch"]').click();
  select('dispatch-season', 'autumn');
  await openMap();
  button('.region-list [data-region="US-TX"]').click();
  expect(heading()).toBe('Texas');
  expect(menu.root.querySelectorAll('.county-map [data-county]')).toHaveLength(7);
  expect(menu.root.querySelector('#county-card-title')!.textContent).toBe('Texas Farmstead County');
  menu.root.querySelector<SVGElement>('.county-map [data-county="7"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(menu.root.querySelector('#county-card-title')!.textContent).toBe("Austin Capitol District — Governor's Mansion");
  expect(button('[data-menu-action="deploy"]').disabled).toBe(false);
  const rolled = menu.root.querySelector<HTMLSelectElement>('#county-weather')!.value;
  expect(rolled).toBe(countyWeather(1234, 'autumn', 'US-TX', 7));
  button('[data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenLastCalledWith({ kind: 'sandbox', season: 'autumn', regionId: 'US-TX', countyIndex: 7, weather: rolled, effects: 'on', mapSeed: 1234 });
  select('county-weather', 'fog');
  select('county-effects', 'reduced');
  button('[data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenLastCalledWith(expect.objectContaining({ countyIndex: 7, weather: 'fog', effects: 'reduced' }));
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
  button('.region-list [data-region="CA-ON"]').click();
  button('.county-list [data-county="7"]').click();
  expect(button('[data-menu-action="deploy"]').disabled).toBe(true);
  expect(menu.root.querySelector('#county-lock-note')!.textContent).toContain('Ontario');
  button('[data-menu-action="deploy"]').click();
  expect(actions.start).not.toHaveBeenCalled();
  const progress = new CountyProgress();
  for (let index = 1; index <= 6; index++) progress.markCleared('CA-ON', index);
  key(menu.root, { key: 'Escape' });
  expect(menu.root.querySelector('[data-region="CA-ON"]')!.getAttribute('aria-label')).toContain('6/7');
  menu.root.querySelector<SVGElement>('.overworld-map [data-region="CA-ON"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(heading()).toBe('Ontario');
  button('.county-list [data-county="7"]').click();
  button('[data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'challenge', regionId: 'CA-ON', countyIndex: 7 }));
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
  await loadOverworld();
  await new Promise(resolve => setTimeout(resolve, 0));
};
const running = { session: 'challenge', season: 'winter', effects: 'reduced', regionId: 'US-MI', countyIndex: 3, weather: 'fog', mapSeed: 42 } as const;

it('opens the state map over a paused run without ending it, and resumes from the running county', async () => {
  menu.show('pause', running);
  expect(button('[data-menu-action="state-map"]').textContent).toBe(L.stateMap);
  await pauseMap('state-map');
  expect(heading()).toBe('Michigan');
  expect(menu.root.querySelector('.map-chips')!.textContent).toContain('Winter · locked');
  expect(menu.root.querySelector('.county-map [data-county="3"]')!.classList.contains('current')).toBe(true);
  expect(menu.root.querySelector('.county-list [data-county="3"]')!.textContent).toContain('Playing');
  expect(menu.root.querySelector<HTMLSelectElement>('#county-weather')!.value).toBe('fog');
  expect(actions.start).not.toHaveBeenCalled();
  expect(actions.title).not.toHaveBeenCalled();
  button('.county-card [data-menu-action="resume"]').click();
  expect(actions.resume).toHaveBeenCalledOnce();
  expect(actions.start).not.toHaveBeenCalled();
});

it('browses the world map from pause, warns before replacing the run, and steps back to the pause menu', async () => {
  menu.show('pause', running);
  await pauseMap('world-map');
  expect(heading()).toBe('North America');
  button('.region-list [data-region="US-OH"]').click();
  expect(menu.root.querySelector('#deploy-replace-note')!.textContent).toMatch(/ends your current county run/);
  expect(menu.root.querySelector('.county-card [data-menu-action="resume"]')).toBeNull();
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('North America');
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('Paused');
  expect(actions.resume).not.toHaveBeenCalled();
  await pauseMap('world-map');
  button('.region-list [data-region="US-OH"]').click();
  button('.county-list [data-county="2"]').click();
  button('[data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'challenge', season: 'winter', regionId: 'US-OH', countyIndex: 2, mapSeed: 42 }));
});

it('restarts the running county from its card with the chosen weather', async () => {
  menu.show('pause', running);
  await pauseMap('state-map');
  select('county-weather', 'clear');
  button('.county-card [data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ regionId: 'US-MI', countyIndex: 3, weather: 'clear', effects: 'reduced' }));
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
