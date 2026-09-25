import type { WeatherDetail, WeatherKind } from "../world/season";

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private grind: AudioBufferSourceNode | null = null;
  private grindGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  private started = false;
  private ambient: AudioBufferSourceNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private ambientKind: WeatherKind | "off" = "off";
  private ambientDetail: WeatherDetail = "off";

  get ready(): boolean {
    return this.started;
  }

  async unlock(): Promise<void> {
    if (this.started) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.22;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise(this.ctx);
    this.engine = this.ctx.createOscillator();
    this.engine.type = "sawtooth";
    this.engine.frequency.value = 42;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 280;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engine.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engine.start();
    this.grindGain = this.ctx.createGain();
    this.grindGain.gain.value = 0;
    this.grind = this.ctx.createBufferSource();
    this.grind.buffer = this.noiseBuf;
    this.grind.loop = true;
    const gFilter = this.ctx.createBiquadFilter();
    gFilter.type = "bandpass";
    gFilter.frequency.value = 900;
    gFilter.Q.value = 0.7;
    this.grind.connect(gFilter);
    gFilter.connect(this.grindGain);
    this.grindGain.connect(this.master);
    this.grind.start();
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0;
    this.ambientFilter = this.ctx.createBiquadFilter();
    this.ambientFilter.type = "lowpass";
    this.ambientFilter.frequency.value = 500;
    this.ambient = this.ctx.createBufferSource();
    this.ambient.buffer = this.noiseBuf;
    this.ambient.loop = true;
    this.ambient.connect(this.ambientFilter);
    this.ambientFilter.connect(this.ambientGain);
    this.ambientGain.connect(this.master);
    this.ambient.start();
    this.started = true;
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.22;
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  engineLevel(speed: number, heat: number): void {
    if (!this.engine || !this.engineGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.engine.frequency.setTargetAtTime(38 + speed * 9 + heat * 0.2, now, 0.08);
    this.engineGain.gain.setTargetAtTime(0.04 + Math.min(0.12, speed * 0.012), now, 0.08);
  }

  grindLevel(amount: number): void {
    if (!this.grindGain || !this.ctx) return;
    this.grindGain.gain.setTargetAtTime(Math.min(0.16, amount), this.ctx.currentTime, 0.05);
  }

  hush(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, now, 0.04);
    this.grindGain?.gain.setTargetAtTime(0, now, 0.04);
    this.ambientGain?.gain.setTargetAtTime(0, now, 0.08);
    this.ambientKind = "off";
  }

  /** Season bed. Mute, Off, and Reduced stay quieter. It does not change the simulation. */
  syncAmbient(kind: WeatherKind, detail: WeatherDetail): void {
    if (!this.ctx || !this.ambientGain || !this.ambientFilter || this.muted) return;
    const active = detail === "off" || kind === "clear" ? "off" : kind;
    if (active === this.ambientKind && detail === this.ambientDetail) return;
    this.ambientDetail = detail;
    this.ambientKind = active;
    const now = this.ctx.currentTime;
    if (active === "off") {
      this.ambientGain.gain.setTargetAtTime(0, now, 0.2);
      return;
    }
    const freq = active === "rain" ? 900 : active === "flurries" ? 1400 : active === "leaves" ? 600 : 500;
    const gain = detail === "reduced" ? 0.012 : 0.028;
    this.ambientFilter.frequency.setTargetAtTime(freq, now, 0.2);
    this.ambientGain.gain.setTargetAtTime(gain, now, 0.3);
  }

  impact(mag: number): void {
    this.blip(80, 0.09, mag * 0.18, "square");
    this.noiseBurst(0.08, mag * 0.2, 400);
  }

  breakMat(mag: number): void {
    this.noiseBurst(0.14, 0.16 + mag * 0.08, 1200);
    this.blip(140, 0.07, 0.08, "triangle");
  }

  collapse(mag: number): void {
    this.blip(48, 0.35, 0.2 + mag * 0.04, "sine");
    this.noiseBurst(0.32, 0.22, 180);
  }

  scrape(mag: number, material?: string): void {
    const freq = material === "metal" ? 1400 : material === "wood" ? 700 : 420;
    this.noiseBurst(0.07, Math.min(0.12, 0.04 + mag * 0.08), freq);
  }

  clatter(mag: number, material?: string): void {
    const freq = material === "metal" ? 900 : material === "wood" ? 260 : 180;
    this.blip(freq, 0.05, Math.min(0.1, 0.03 + mag * 0.05), "triangle");
    this.noiseBurst(0.06, Math.min(0.1, mag * 0.07), freq * 0.6);
  }

  crunch(mag: number): void {
    this.noiseBurst(0.12, 0.1 + mag * 0.06, 220);
    this.blip(70, 0.08, 0.06, "sine");
  }

  bowlingPins(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, master = this.master, now = ctx.currentTime;
    // A short, staggered cluster of hollow wooden knocks; no timers or sound downloads.
    for (let i = 0; i < 10; i++) {
      const start = now + i * .022 + (i % 3) * .009;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(420 + (i * 137 % 510), start);
      osc.frequency.exponentialRampToValueAtTime(170 + (i * 59 % 140), start + .09);
      gain.gain.setValueAtTime(.13 * (1 - i * .055), start);
      gain.gain.exponentialRampToValueAtTime(.001, start + .13);
      osc.connect(gain); gain.connect(master); osc.start(start); osc.stop(start + .15);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    }
    this.noiseBurst(.12,.12,1800);
  }

  cash(): void {
    this.blip(660, 0.08, 0.09, "square");
    this.blip(880, 0.1, 0.07, "square");
  }

  switchClick(): void {
    this.blip(210, 0.035, 0.07, "triangle");
    this.noiseBurst(0.018, 0.035, 1600);
  }

  permitStamp(): void {
    if (this.muted || this.ctx?.state !== 'running') return;
    this.blip(85, 0.11, 0.25, "sine");
    this.noiseBurst(0.075, 0.25, 850);
  }

  typewriterKey(index: number): void {
    if (this.muted || this.ctx?.state !== 'running') return;
    this.noiseBurst(0.026, 0.12, 2200 + (index % 3) * 240);
    this.blip(1250 + (index % 4) * 110, 0.018, 0.06, "triangle");
    this.blip(165, 0.035, 0.07, "square");
  }

  private blip(freq: number, dur: number, gain: number, type: OscillatorType): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + dur + 0.02);
  }

  private noiseBurst(dur: number, gain: number, freq: number): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
    src.stop(this.ctx.currentTime + dur + 0.02);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
