// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../render/domTestShims';
import { TERMS_KEY, TERMS_VERSION } from '../privacy/state';
import { CAMPAIGN_LEVELS } from './campaign';
import { COPY, MATCH_SECONDS, SIM_DT } from './constants';

// The game boots against a stand-in Pixi application: no GPU, no ticker. Frames are driven by hand.
vi.mock('pixi.js', async (orig) => {
  const pixi = await orig<typeof import('pixi.js')>();
  class Application {
    canvas = document.createElement('canvas');
    stage = new pixi.Container();
    renderer = { width: 1280, height: 720 };
    async init(): Promise<void> {}
    resize(): void {}
    render(): void {}
    destroy(): void {}
  }
  // No network in tests: the terrain atlas falls back to flat colours.
  const Assets = Object.assign(Object.create(pixi.Assets), { load: async () => { throw new Error('offline'); } });
  return { ...pixi, Application, Assets };
});
vi.mock('./runtime', () => ({ startRuntimeTicker: vi.fn() }));

/** Silent audio graph: every node accepts connections and schedules nothing. */
class SilentAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  private node(): Record<string, unknown> {
    const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    return { gain: param(), frequency: param(), Q: param(), connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  createGain() { return this.node(); }
  createOscillator() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createBufferSource() { return this.node(); }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  async resume(): Promise<void> {}
}
Object.assign(window, { AudioContext: SilentAudioContext });
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };

type GameModule = typeof import('./Game');
type Game = Awaited<ReturnType<GameModule['boot']>>;
/** Private game state the tests read and drive. */
interface GameInternals {
  frame(dt: number): void;
  step(dt: number): void;
  react(events: { kind: string; mag: number; material?: string }[]): void;
  mode: string;
  cash: number;
  timeLeft: number;
  death: string | null;
  campaign: { complete: boolean; levelIndex: number } | null;
  dozer: { x: number; y: number; heat: number; track: number; bladeDown: boolean };
  town: { buildings: unknown[]; yard?: unknown; roadCar: unknown; season: string };
  renderer: { camX: number; zoom: number; debug: { freeze: boolean; perf: boolean; walls: boolean; maxFloor: number }; showNhood: boolean };
  hud: import('../render/hud').Hud;
}

let boot: GameModule['boot'];
beforeAll(async () => {
  localStorage.setItem(TERMS_KEY, TERMS_VERSION);
  ({ boot } = await import('./Game'));
});

let game: Game;
let internal: GameInternals;
const key = (k: string, type: 'keydown' | 'keyup' = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { key: k }));
const frames = (n: number, dt = SIM_DT) => { for (let i = 0; i < n; i++) internal.frame(dt); };
const hud = (selector: string) => document.querySelector<HTMLElement>(`#hud-root ${selector}`)!;

beforeEach(async () => {
  history.replaceState(null, '', '/?mode=sandbox&level=county&seed=7');
  document.body.innerHTML = '<div id="game-root"></div><div id="hud-root"></div>';
  game?.destroy();
  game = await boot();
  internal = game as unknown as GameInternals;
});

describe('sandbox play', () => {
  it('drives the dozer, runs an elapsed clock, and paints the HUD', () => {
    const start = { ...internal.dozer };
    key('w');
    frames(60);
    key('w', 'keyup');
    expect(Math.hypot(internal.dozer.x - start.x, internal.dozer.y - start.y)).toBeGreaterThan(0.5);
    expect(hud('#hud-clock-label').textContent).toBe('Elapsed');
    expect(document.querySelector('#game-root canvas')).not.toBeNull();
  });

  it('pauses on Escape, holds the simulation, and resumes', () => {
    key('Escape');
    frames(1);
    expect(internal.mode).toBe('pause');
    const parked = { ...internal.dozer };
    key('w');
    frames(10);
    expect(internal.dozer.x).toBe(parked.x);
    key('w', 'keyup');
    key('Escape');
    frames(1);
    expect(internal.mode).toBe('play');
  });

  it('answers the play keys: mute, restart, new layout, road car, overview, and perf', () => {
    const seed = (game.snapshot() as { seed: number }).seed;
    key('m'); frames(1);
    key('n'); frames(1);
    expect(game.snapshot().seed).not.toBe(seed);
    key('r'); frames(1);
    key('v'); frames(1);
    expect(internal.town.roadCar).toBeTruthy();
    key('g'); frames(1);
    expect(internal.renderer.showNhood).toBe(true);
    key('`'); frames(1);
    expect(internal.renderer.debug.perf).toBe(true);
    expect(document.querySelector('#perf-root')).not.toBeNull();
    key('`'); frames(1);
  });

  it('shakes and plays sound for each kind of world event', () => {
    for (const kind of ['bowling-strike', 'impact', 'breach', 'collapse', 'cash', 'chip', 'crush', 'blast', 'spark'])
      expect(() => internal.react([{ kind, mag: 1.2 }])).not.toThrow();
    internal.react([{ kind: 'scrape', mag: 1, material: 'metal' }, { kind: 'scrape', mag: 1, material: 'concrete' }]);
  });

  it('frames the town, a street, and open ground on request', () => {
    game.lookAtTown('overview');
    frames(1);
    expect(internal.renderer.showNhood).toBe(true);
    game.lookAtTown('street');
    game.lookAtTown('open');
    game.frameDozer(0.8);
    frames(1);
    expect(internal.renderer.zoom).toBe(0.8);
    game.lookAtWorld(10, 10, 0, 1);
    expect(internal.dozer.x).toBe(10);
  });

  it('charges a permit resubmission fee while playing or paused, never from results', () => {
    internal.cash = 5000;
    const fee = internal.hud.onResubmit!();
    expect(fee).toBeGreaterThan(0);
    expect(internal.cash).toBe(5000 - fee!);
    internal.mode = 'results';
    expect(internal.hud.onResubmit!()).toBeNull();
  });

  it('starts a new game from the menu with the chosen season and effects', () => {
    internal.hud.onStart!('sandbox', 'village', 'winter', 'reduced');
    expect(internal.town.season).toBe('winter');
    expect(internal.campaign).toBeNull();
    expect(location.search).toContain('effects=reduced');
    internal.hud.onStart!('challenge', 'suburb', 'random', 'on');
    expect(internal.campaign?.levelIndex).toBe(CAMPAIGN_LEVELS.findIndex(level => level.id === 'suburb'));
  });

  it('applies debug binder switches to the renderer and steps a frozen world on request', () => {
    internal.hud.onDebugToggle!('walls', false);
    expect(internal.renderer.debug.walls).toBe(false);
    internal.hud.onDebugFloor!(1);
    expect(internal.renderer.debug.maxFloor).toBe(1);
    internal.hud.onDebugReset!();
    expect(internal.renderer.debug.walls).toBe(true);
    internal.hud.onDebugToggle!('freeze', true);
    const elapsed = (game.snapshot() as { elapsed: number }).elapsed;
    frames(5);
    expect(game.snapshot().elapsed).toBe(elapsed);
    internal.hud.onDebugStep!();
    expect(game.snapshot().elapsed).toBeCloseTo(elapsed + SIM_DT);
  });

  it('opens the all-assets yard once the player confirms leaving the run', async () => {
    internal.cash = 100;
    window.confirm = () => false;
    internal.hud.onTestYard!();
    expect(internal.town.yard).toBeUndefined();
    window.confirm = () => true;
    internal.hud.onTestYard!();
    await vi.waitFor(() => expect(internal.town.yard).toBeTruthy());
    expect(document.querySelector('.yard-panel')).not.toBeNull();
    frames(2);
  });
});

describe('time challenge', () => {
  beforeEach(() => {
    game.setSession('challenge');
  });

  it('opens a campaign level on its briefing, then plays it', () => {
    expect(internal.mode).toBe('briefing');
    expect(internal.campaign?.levelIndex).toBe(0);
    frames(1);
    expect(hud('#hud-panel .campaign-briefing')).not.toBeNull();
    hud('#hud-panel [data-act="begin"]').click();
    frames(1);
    expect(internal.mode).toBe('play');
    expect(internal.timeLeft).toBeLessThanOrEqual(CAMPAIGN_LEVELS[0]!.timeLimit);
    expect(internal.timeLeft).toBeGreaterThan(CAMPAIGN_LEVELS[0]!.timeLimit - 1);
  });

  it('ends the level when the engine cooks', () => {
    hud('#hud-panel [data-act="begin"]')?.click();
    internal.mode = 'play';
    internal.dozer.heat = 120;
    internal.step(SIM_DT);
    expect(internal.mode).toBe('results');
    expect(internal.death).toBe(COPY.engineCooked);
    frames(1);
    expect(hud('#result-heading').textContent).toBe(COPY.engineCooked);
    hud('#hud-panel [data-act="retry"]').click();
    expect(internal.mode).toBe('briefing');
  });

  it('moves to the next level only after this one is complete', () => {
    internal.hud.onNextLevel!();
    expect(internal.campaign?.levelIndex).toBe(0);
    internal.campaign!.complete = true;
    internal.hud.onNextLevel!();
    expect(internal.campaign?.levelIndex).toBe(1);
    internal.hud.onNewCampaign!();
    expect(internal.campaign?.levelIndex).toBe(0);
  });

  it('jumps between levels from the debug session bar', () => {
    game.jumpCampaignLevel('village');
    expect(internal.campaign?.levelIndex).toBe(CAMPAIGN_LEVELS.findIndex(level => level.id === 'village'));
    expect(game.urbanSnapshot()).toMatchObject({ level: 'village' });
  });
});

describe('arcade challenge rules', () => {
  it('runs the county clock out', () => {
    history.replaceState(null, '', '/?mode=challenge&district=classic&seed=7');
    game.startJob();
    expect(internal.town.buildings.length).toBeGreaterThan(0);
    game.setDistrict('classic');
    internal.mode = 'play';
    internal.timeLeft = SIM_DT / 2;
    internal.step(SIM_DT);
    expect(internal.mode === 'results' || internal.timeLeft < MATCH_SECONDS).toBe(true);
  });
});

describe('test maps', () => {
  it('loads a focused asset map and frames its bay', () => {
    game.setDemo('ranch');
    frames(2);
    expect(internal.town.yard).toBeTruthy();
    expect(hud('#debug-reset-test').hidden).toBe(false);
  });
});

describe('debug bridge', () => {
  it('poses the dozer and reports the town, the scene and the camera', () => {
    const pd = window.__pd!;
    pd.setDozerPose({ x: 5, y: 6, heading: 1, bladeDown: true, vx: 2, motionStartX: 5, motionStartY: 6 });
    expect(pd.dozerSnapshot()).toMatchObject({ x: 5, y: 6, heading: 1, bladeDown: true, vx: 2, motionStartX: 5, motionStartY: 6 });
    const town = pd.townSnapshot() as { features: { kind: string }[] };
    expect(town.features.length).toBeGreaterThan(0);
    expect(pd.inspect()).toMatchObject({ mode: 'play' });
    expect(pd.cameraSnapshot().zoom).toBeGreaterThan(0);
  });

  it('inspects a test yard and times its vehicle fleet', async () => {
    game.setDemo('ranch');
    expect(window.__pd!.yardInspect()).toBeTruthy();
    const report = await window.__pd!.runVehiclePerfHarness();
    expect(report.vehicles).toBeGreaterThan(0);
    expect(report.simP95Ms).toBeGreaterThanOrEqual(0);
  });
});

describe('upgrades', () => {
  it('stops a campaign for an upgrade at each cash milestone, then resumes on a pick', () => {
    game.setSession('challenge');
    frames(1);
    hud('#hud-panel [data-act="begin"]').click();
    expect(internal.mode).toBe('play');
    (internal.campaign as unknown as { campaignEarned: number }).campaignEarned = 1e9;
    internal.step(SIM_DT);
    expect(internal.mode).toBe('upgrade');
    // Below the next milestone, so the pick returns to play.
    (internal.campaign as unknown as { campaignEarned: number }).campaignEarned = 0;
    // The first frame in a menu releases held input, as the overlay opens.
    frames(1);
    key('2');
    frames(1);
    expect((internal as unknown as { upgrades: Record<string, number> }).upgrades.engine).toBe(1);
    expect(internal.mode).toBe('play');
  });
});
