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

  cash(): void {
    this.blip(660, 0.08, 0.09, "square");
    this.blip(880, 0.1, 0.07, "square");
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
