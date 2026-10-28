import { createVoiceChain, type VoiceChain } from './chain';
import { integratedLoudness } from './dsp/loudness';
import { measureNoiseProfile } from './dsp/noiseProfile';
import { encodeWav } from './encoders/wav';
import { engine } from './engine';
import type { VoiceParams } from './params';
import { renderEnhanced, resample } from './render';

/**
 * Recording player with sample-synchronised A/B comparison.
 *
 * A single media element feeds three parallel paths — the untouched original, enhancement A and
 * (optionally) enhancement B — so switching between them never loses position. The original is
 * delayed by exactly the chain latency so all paths stay aligned. The media element provides
 * pitch-preserving speed control and native seeking.
 */
export type ListenVersion = 'original' | 'a' | 'b';

export interface PlayerState {
  loadedId: string | null;
  loading: boolean;
  ready: boolean;
  playing: boolean;
  duration: number;
  rate: number;
  volume: number;
  version: ListenVersion;
  compare: boolean;
  loudnessMatch: boolean;
  /** Loudness of each version (LUFS) and the compensation applied when matching. */
  loudness: { original: number | null; a: number | null; b: number | null };
  measuring: boolean;
  error: string | null;
}

type Listener = () => void;
const dbToGain = (db: number) => Math.pow(10, db / 20);

export class RecordingPlayer {
  private state: PlayerState = {
    loadedId: null,
    loading: false,
    ready: false,
    playing: false,
    duration: 0,
    rate: 1,
    volume: 0.9,
    version: 'a',
    compare: false,
    loudnessMatch: true,
    loudness: { original: null, a: null, b: null },
    measuring: false,
    error: null,
  };
  private listeners = new Set<Listener>();
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;
  private nodes: AudioNode[] = [];
  private chainA: VoiceChain | null = null;
  private chainB: VoiceChain | null = null;
  private gOrig: GainNode | null = null;
  private gA: GainNode | null = null;
  private gB: GainNode | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array | null = null;
  private sampleRate = 48000;
  private profile: Float32Array | null = null;
  private paramsA: VoiceParams | null = null;
  private paramsB: VoiceParams | null = null;
  private measureToken = 0;
  private measureTimer: ReturnType<typeof setTimeout> | null = null;
  private loadToken = 0;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get currentTime(): number {
    return this.el?.currentTime ?? 0;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  async load(id: string, samples: Float32Array, sampleRate: number, params: VoiceParams): Promise<void> {
    const token = ++this.loadToken;
    this.unload();
    // Always start on the enhanced version: a "b" or "original" choice from a previous
    // recording would otherwise route to a missing chain (silence) or skip the preset.
    this.set({ loading: true, ready: false, loadedId: id, error: null, playing: false, version: 'a', compare: false, duration: samples.length / sampleRate, loudness: { original: null, a: null, b: null } });
    try {
      const ctx = await engine.context();
      if (token !== this.loadToken) return;
      this.samples = samples;
      this.sampleRate = sampleRate;
      this.paramsA = params;
      // Measured once per load (at the context's rate, where the chain runs) so any preset with
      // noise reduction can use it.
      const atCtxRate = sampleRate === ctx.sampleRate ? samples : (await resample([samples], sampleRate, ctx.sampleRate))[0];
      if (token !== this.loadToken) return;
      this.profile = measureNoiseProfile(atCtxRate, ctx.sampleRate);

      const el = new Audio();
      el.preload = 'auto';
      const pitch = el as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
      pitch.preservesPitch = true;
      pitch.webkitPreservesPitch = true; // older Safari
      el.playbackRate = this.state.rate;
      this.url = URL.createObjectURL(encodeWav([samples], sampleRate, 16));
      el.src = this.url;
      el.addEventListener('ended', () => this.set({ playing: false }));
      el.addEventListener('pause', () => this.set({ playing: false }));
      el.addEventListener('play', () => this.set({ playing: true }));
      el.addEventListener('error', () => this.set({ error: 'media', playing: false }));
      this.el = el;

      const src = new MediaElementAudioSourceNode(ctx, { mediaElement: el });
      const chainA = createVoiceChain(ctx, params, { mode: 'preview', noiseProfile: this.profile });
      const latency = chainA.latencySamples / ctx.sampleRate;
      const origDelay = new DelayNode(ctx, { maxDelayTime: 0.2, delayTime: latency });
      const gOrig = new GainNode(ctx, { gain: 0 });
      const gA = new GainNode(ctx, { gain: 0 });
      const gB = new GainNode(ctx, { gain: 0 });
      const master = new GainNode(ctx, { gain: this.state.volume });
      const analyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.6 });
      const mono = new GainNode(ctx, { gain: 1, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      src.connect(mono);
      mono.connect(origDelay).connect(gOrig).connect(master);
      mono.connect(chainA.input);
      chainA.output.connect(gA).connect(master);
      gB.connect(master);
      master.connect(analyser);
      master.connect(ctx.destination);
      this.nodes = [src, mono, origDelay, gOrig, gA, gB, master, analyser];
      this.chainA = chainA;
      this.gOrig = gOrig;
      this.gA = gA;
      this.gB = gB;
      this.master = master;
      this.analyser = analyser;
      this.applyRouting(true);
      this.set({ loading: false, ready: true });
      this.scheduleMeasure(0);
    } catch (e) {
      if (token === this.loadToken) this.set({ loading: false, error: String((e as Error)?.message ?? e) });
    }
  }

  unload() {
    if (this.measureTimer) clearTimeout(this.measureTimer);
    this.measureToken++;
    if (this.el) {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
      this.el = null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    this.chainA?.dispose();
    this.chainB?.dispose();
    this.chainA = this.chainB = null;
    this.gOrig = this.gA = this.gB = this.master = this.analyser = null;
    this.samples = null;
    this.paramsB = null;
    if (this.state.loadedId) this.set({ loadedId: null, ready: false, playing: false, compare: false });
  }

  isLoaded(id: string) {
    return this.state.loadedId === id && this.state.ready;
  }

  async play() {
    if (!this.el) return;
    await engine.context();
    try {
      await this.el.play();
    } catch (e) {
      this.set({ error: String((e as Error)?.message ?? e) });
    }
  }

  pause() {
    this.el?.pause();
  }

  toggle() {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    if (!this.el) return;
    this.el.currentTime = Math.max(0, Math.min(this.state.duration, t));
  }

  restart() {
    this.seek(0);
    void this.play();
  }

  setRate(r: number) {
    if (this.el) this.el.playbackRate = r;
    this.set({ rate: r });
  }

  setVolume(v: number) {
    const ctx = engine.audioContext;
    if (this.master && ctx) this.master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    this.set({ volume: v });
  }

  setVersion(v: ListenVersion) {
    if (v === 'b' && !this.chainB) return;
    this.set({ version: v });
    this.applyRouting(false);
  }

  setLoudnessMatch(on: boolean) {
    this.set({ loudnessMatch: on });
    this.applyRouting(false);
  }

  /** Update enhancement A (the recording's preset) live. */
  setParamsA(p: VoiceParams) {
    this.measureToken++; // a measurement in flight belongs to the previous preset
    this.paramsA = p;
    this.chainA?.update(p);
    this.set({ loudness: { ...this.state.loudness, a: null } });
    this.applyRouting(false);
    this.scheduleMeasure(500);
  }

  /** Enable comparison against a second preset (B), or disable with null. */
  async setCompare(p: VoiceParams | null) {
    this.measureToken++;
    const ctx = engine.audioContext;
    if (!ctx || !this.nodes.length) return;
    if (!p) {
      this.chainB?.dispose();
      this.chainB = null;
      this.paramsB = null;
      this.set({ compare: false, version: this.state.version === 'b' ? 'a' : this.state.version, loudness: { ...this.state.loudness, b: null } });
      this.applyRouting(false);
      return;
    }
    this.paramsB = p;
    if (!this.chainB) {
      const mono = this.nodes[1];
      this.chainB = createVoiceChain(ctx, p, { mode: 'preview', noiseProfile: this.profile });
      mono.connect(this.chainB.input);
      this.chainB.output.connect(this.gB!);
    } else {
      this.chainB.update(p);
    }
    this.set({ compare: true, loudness: { ...this.state.loudness, b: null } });
    this.applyRouting(false);
    this.scheduleMeasure(500);
  }

  /** Gain offset (dB) applied to a version when loudness matching is on. */
  offsetDb(v: ListenVersion): number {
    const L = this.state.loudness;
    if (!this.state.loudnessMatch || L.original === null || v === 'original') return 0;
    const x = v === 'a' ? L.a : L.b;
    if (x === null || !Number.isFinite(x) || !Number.isFinite(L.original)) return 0;
    return Math.max(-12, Math.min(12, L.original - x));
  }

  private applyRouting(immediate: boolean) {
    const ctx = engine.audioContext;
    if (!ctx || !this.gOrig || !this.gA || !this.gB) return;
    const v = this.state.version;
    const target = (g: GainNode, value: number) => {
      if (immediate) g.gain.setValueAtTime(value, ctx.currentTime);
      else g.gain.setTargetAtTime(value, ctx.currentTime, 0.012);
    };
    target(this.gOrig, v === 'original' ? 1 : 0);
    target(this.gA, v === 'a' ? dbToGain(this.offsetDb('a')) : 0);
    target(this.gB, v === 'b' ? dbToGain(this.offsetDb('b')) : 0);
  }

  private scheduleMeasure(delay: number) {
    if (this.measureTimer) clearTimeout(this.measureTimer);
    this.measureTimer = setTimeout(() => void this.measure(), delay);
  }

  /** Measure integrated loudness of each version (first 45 s) for loudness-matched A/B. */
  private async measure() {
    const token = ++this.measureToken;
    const samples = this.samples;
    if (!samples) return;
    this.set({ measuring: true });
    const span = samples.subarray(0, Math.min(samples.length, Math.round(45 * this.sampleRate)));
    try {
      const original = this.state.loudness.original ?? integratedLoudness([span], this.sampleRate);
      const measureOne = async (p: VoiceParams | null) => {
        if (!p) return null;
        // Render at the context's rate, which is the rate the noise profile was measured at.
        const r = await renderEnhanced(span, this.sampleRate, p, { noiseProfile: this.profile, targetRate: engine.audioContext?.sampleRate });
        return integratedLoudness(r.channels, r.sampleRate);
      };
      const a = this.state.loudness.a ?? (await measureOne(this.paramsA));
      if (token !== this.measureToken) return;
      const b = this.paramsB ? (this.state.loudness.b ?? (await measureOne(this.paramsB))) : null;
      if (token !== this.measureToken) return;
      this.set({ loudness: { original, a, b }, measuring: false });
      this.applyRouting(false);
    } catch {
      if (token === this.measureToken) this.set({ measuring: false });
    }
  }
}

export const player = new RecordingPlayer();
