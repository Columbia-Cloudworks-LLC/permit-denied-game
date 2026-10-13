import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioBus } from './synth';

/** An audio param that records every scheduled value. */
class Param {
  value = 0;
  readonly targets: number[] = [];
  setTargetAtTime(v: number): void { this.targets.push(v); this.value = v; }
  setValueAtTime(v: number): void { this.value = v; }
  exponentialRampToValueAtTime(v: number): void { this.targets.push(v); }
}

class Node {
  connect(): void {}
  disconnect(): void {}
}

class FakeContext {
  static created: FakeContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 1;
  sampleRate = 100;
  readonly destination = new Node();
  readonly oscillators: { frequency: Param; started: number }[] = [];
  readonly gains: { gain: Param }[] = [];
  readonly filters: { frequency: Param; Q: Param; type: string }[] = [];
  readonly sources: { buffer: unknown; started: number }[] = [];
  constructor() { FakeContext.created.push(this); }
  async resume(): Promise<void> { this.state = 'running'; }
  createGain() { const g = Object.assign(new Node(), { gain: new Param() }); this.gains.push(g); return g; }
  createOscillator() {
    const o = Object.assign(new Node(), { type: 'sine', frequency: new Param(), started: 0, onended: null as null | (() => void),
      start() { o.started++; }, stop() {} });
    this.oscillators.push(o);
    return o;
  }
  createBiquadFilter() { const f = Object.assign(new Node(), { type: '', frequency: new Param(), Q: new Param() }); this.filters.push(f); return f; }
  createBufferSource() {
    const s = Object.assign(new Node(), { buffer: null as unknown, loop: false, started: 0, start() { s.started++; }, stop() {} });
    this.sources.push(s);
    return s;
  }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
}

beforeEach(() => {
  FakeContext.created = [];
  vi.stubGlobal('window', { AudioContext: FakeContext });
});
afterEach(() => vi.unstubAllGlobals());

it('stays silent until unlocked, then builds its engine, grind and ambient beds once', async () => {
  const bus = new AudioBus();
  bus.impact(1);
  bus.engineLevel(3, 10);
  bus.syncAmbient('rain', 'on');
  expect(FakeContext.created).toHaveLength(0);
  await bus.unlock();
  await bus.unlock();
  expect(FakeContext.created).toHaveLength(1);
  const ctx = FakeContext.created[0]!;
  expect(ctx.state).toBe('running');
  expect(ctx.oscillators[0]!.started).toBe(1);
  expect(ctx.sources.filter(s => s.started)).toHaveLength(2);
  bus.engineLevel(4, 50);
  expect(ctx.oscillators[0]!.frequency.targets.at(-1)).toBe(38 + 4 * 9 + 50 * .2);
});

it('follows the weather with the ambient bed and goes quiet when muted', async () => {
  const bus = new AudioBus();
  await bus.unlock();
  const ctx = FakeContext.created[0]!;
  const ambientGain = ctx.gains[3]!.gain, ambientFilter = ctx.filters[2]!.frequency;
  bus.syncAmbient('rain', 'on');
  expect(ambientFilter.value).toBe(900);
  expect(ambientGain.value).toBe(.028);
  bus.syncAmbient('flurries', 'reduced');
  expect(ambientFilter.value).toBe(1400);
  expect(ambientGain.value).toBe(.012);
  const scheduled = ambientGain.targets.length;
  bus.syncAmbient('flurries', 'reduced');
  expect(ambientGain.targets).toHaveLength(scheduled);
  bus.syncAmbient('leaves', 'on');
  expect(ambientFilter.value).toBe(600);
  bus.syncAmbient('clear', 'on');
  expect(ambientGain.value).toBe(0);
  expect(bus.toggleMute()).toBe(true);
  expect(ctx.gains[0]!.gain.value).toBe(0);
  bus.syncAmbient('rain', 'on');
  expect(ambientFilter.value).toBe(600);
  bus.toggleMute();
  expect(ctx.gains[0]!.gain.value).toBe(.22);
});

it('plays effects through fresh voices, and the title sounds only while running and unmuted', async () => {
  const bus = new AudioBus();
  await bus.unlock();
  const ctx = FakeContext.created[0]!;
  const voices = () => ctx.oscillators.length + ctx.sources.length;
  let before = voices();
  for (const play of [() => bus.impact(1), () => bus.breakMat(1), () => bus.collapse(1), () => bus.crunch(1), () => bus.cash(),
    () => bus.switchClick(), () => bus.scrape(1, 'metal'), () => bus.scrape(1, 'wood'), () => bus.scrape(1), () => bus.clatter(1, 'metal'),
    () => bus.clatter(1, 'wood'), () => bus.clatter(1)]) {
    play();
    expect(voices()).toBeGreaterThan(before);
    before = voices();
  }
  bus.bowlingPins();
  expect(voices()).toBe(before + 11);
  before = voices();
  bus.permitStamp();
  bus.typewriterKey(2);
  expect(voices()).toBe(before + 5);
  bus.setMuted(true);
  before = voices();
  bus.permitStamp();
  bus.typewriterKey(1);
  bus.bowlingPins();
  expect(voices()).toBe(before);
  bus.hush();
  expect(ctx.gains[1]!.gain.value).toBe(0);
  bus.grindLevel(.5);
  expect(ctx.gains[2]!.gain.value).toBe(.16);
});
