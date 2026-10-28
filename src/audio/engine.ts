import { createVoiceChain, LIMITER_LOOKAHEAD_MS, loadWorklets, type VoiceChain } from './chain';
import { classifyLabel, cleanLabel, listDevices, outputSelectionSupported, type DeviceInfo, type DeviceKind } from './devices';
import { computePeaks } from './dsp/peaks';
import { NEUTRAL, type VoiceParams } from './params';
import {
  appendChunk,
  encodeChunk,
  newId,
  patchRecording,
  putRecording,
  type RecordingMeta,
  type SampleFormat,
} from '../lib/db';
import { audioCache } from './audioCache';

export type InputStatus = 'off' | 'opening' | 'on' | 'error';
export type EngineErrorCode =
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'notfound'
  | 'busy'
  | 'disconnected'
  | 'worklet'
  | 'unknown';
export type RecordingState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';
export type LatencyMode = 'lowest' | 'interactive' | 'stable';
export type Interruption = 'disconnected' | 'interrupted' | 'storage' | null;

export interface LatencyInfo {
  input: number | null;
  base: number;
  output: number | null;
  processing: number;
  total: number;
  /** All components were reported by the browser (otherwise the total is a lower bound). */
  complete: boolean;
}

export interface EngineState {
  contextState: AudioContextState | 'interrupted' | 'none';
  sampleRate: number;
  permission: 'unknown' | 'prompt' | 'granted' | 'denied';
  input: {
    status: InputStatus;
    error: EngineErrorCode | null;
    errorDetail: string | null;
    deviceId: string | null;
    label: string;
    kind: DeviceKind;
    sampleRate: number | null;
    channelCount: number | null;
    /** Telephone-quality capture (e.g. a Bluetooth headset in hands-free mode). */
    lowQuality: boolean;
  };
  devices: { inputs: DeviceInfo[]; outputs: DeviceInfo[]; labelsAvailable: boolean };
  output: { deviceId: string; label: string; kind: DeviceKind; selectable: boolean; error: string | null };
  live: { enabled: boolean; muted: 'feedback' | null };
  recording: { state: RecordingState; id: string | null; interruption: Interruption; error: string | null };
  bypass: boolean;
}

export interface RecordingStartInfo {
  title: string;
  surah: number | null;
  ayahFrom: number | null;
  ayahTo: number | null;
  presetId: string;
  presetName: string;
  params: VoiceParams;
  format: SampleFormat;
}

export interface FinishedTake {
  id: string;
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

type Listener = () => void;

const initialState: EngineState = {
  contextState: 'none',
  sampleRate: 0,
  permission: 'unknown',
  input: {
    status: 'off',
    error: null,
    errorDetail: null,
    deviceId: null,
    label: '',
    kind: 'unknown',
    sampleRate: null,
    channelCount: null,
    lowQuality: false,
  },
  devices: { inputs: [], outputs: [], labelsAvailable: false },
  output: { deviceId: '', label: '', kind: 'unknown', selectable: false, error: null },
  live: { enabled: false, muted: null },
  recording: { state: 'idle', id: null, interruption: null, error: null },
  bypass: false,
};

/** Accumulates the take in memory and streams it to IndexedDB every ~2 s. */
class TakeWriter {
  readonly chunks: Float32Array[] = [];
  frames = 0;
  private pending: Float32Array[] = [];
  private pendingFrames = 0;
  private seq = 0;
  private writing: Promise<void> = Promise.resolve();
  failed = false;

  constructor(
    readonly id: string,
    readonly sampleRate: number,
    readonly format: SampleFormat,
    private onError: (e: unknown) => void,
  ) {}

  push(s: Float32Array) {
    this.chunks.push(s);
    this.pending.push(s);
    this.frames += s.length;
    this.pendingFrames += s.length;
    if (this.pendingFrames >= this.sampleRate * 2) void this.flush();
  }

  flush(): Promise<void> {
    if (this.pendingFrames === 0) return this.writing;
    const data = concat(this.pending, this.pendingFrames);
    this.pending = [];
    this.pendingFrames = 0;
    const seq = this.seq++;
    const frames = this.frames;
    this.writing = this.writing
      .then(() => appendChunk({ audioId: this.id, seq, frames: data.length, format: this.format, data: encodeChunk(data, this.format) }))
      .then(() => patchRecording(this.id, { frames, duration: frames / this.sampleRate, updatedAt: Date.now() }))
      .then(() => undefined)
      .catch((e) => {
        this.failed = true;
        this.onError(e);
      });
    return this.writing;
  }

  async finish(): Promise<Float32Array> {
    await this.flush();
    return concat(this.chunks, this.frames);
  }
}

function concat(parts: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function mapError(e: unknown): { code: EngineErrorCode; detail: string } {
  const name = (e as { name?: string })?.name ?? '';
  const detail = (e as { message?: string })?.message ?? String(e);
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return { code: 'denied', detail };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return { code: 'notfound', detail };
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return { code: 'busy', detail };
  if (name === 'NotSupportedError' || name === 'TypeError') return { code: 'unsupported', detail };
  return { code: 'unknown', detail };
}

export class AudioEngine {
  private state: EngineState = initialState;
  private listeners = new Set<Listener>();
  private ctx: AudioContext | null = null;
  private ctxReady: Promise<AudioContext> | null = null;
  private latencyMode: LatencyMode = 'interactive';

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private inputGain: GainNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private recorder: AudioWorkletNode | null = null;
  private recorderSink: GainNode | null = null;
  private liveChain: VoiceChain | null = null;
  private liveConnected = false;
  private monitorGain: GainNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;

  private params: VoiceParams = NEUTRAL;
  private inputGainDb = 0;
  private monitorVolume = 0.9;
  private noiseSuppression = false;
  private preferredInput: string | null = null;
  private preferredOutput = '';

  private writer: TakeWriter | null = null;
  private lastFrames = 0;
  private lastFramesCtxTime = 0;
  private recorderWaiters: { type: string; resolve: (frames: number) => void }[] = [];
  private wakeLock: { release: () => Promise<void> } | null = null;
  private stoppingByUs = false;

  constructor() {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener?.('devicechange', () => void this.onDeviceChange());
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.state.recording.state === 'recording') void this.acquireWakeLock();
      });
    }
    this.state = { ...this.state, output: { ...this.state.output, selectable: outputSelectionSupported() } };
    void this.watchPermission();
  }

  // ---------------------------------------------------------------- state plumbing
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private setInput(patch: Partial<EngineState['input']>) {
    this.set({ input: { ...this.state.input, ...patch } });
  }
  private setRecording(patch: Partial<EngineState['recording']>) {
    this.set({ recording: { ...this.state.recording, ...patch } });
  }
  private setLive(patch: Partial<EngineState['live']>) {
    this.set({ live: { ...this.state.live, ...patch } });
  }

  // ---------------------------------------------------------------- context
  configure(opts: {
    latencyMode?: LatencyMode;
    inputGainDb?: number;
    monitorVolume?: number;
    noiseSuppression?: boolean;
    preferredInput?: string | null;
    preferredOutput?: string;
  }) {
    if (opts.latencyMode) this.latencyMode = opts.latencyMode;
    if (opts.inputGainDb !== undefined) this.setInputGain(opts.inputGainDb);
    if (opts.monitorVolume !== undefined) this.setMonitorVolume(opts.monitorVolume);
    if (opts.noiseSuppression !== undefined) this.noiseSuppression = opts.noiseSuppression;
    if (opts.preferredInput !== undefined) this.preferredInput = opts.preferredInput;
    if (opts.preferredOutput !== undefined) this.preferredOutput = opts.preferredOutput;
  }

  /** Returns a running AudioContext. Call from a user gesture the first time. */
  async context(): Promise<AudioContext> {
    if (!this.ctxReady) {
      this.ctxReady = (async () => {
        const hint: AudioContextLatencyCategory | number =
          this.latencyMode === 'lowest' ? 0 : this.latencyMode === 'stable' ? 'balanced' : 'interactive';
        const ctx = new AudioContext({ latencyHint: hint });
        this.ctx = ctx;
        ctx.onstatechange = () => this.onContextState();
        try {
          await loadWorklets(ctx);
        } catch (e) {
          this.setInput({ status: 'error', error: 'worklet', errorDetail: String(e) });
          throw e;
        }
        if (this.preferredOutput && this.state.output.selectable) {
          try {
            await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(this.preferredOutput);
          } catch {
            this.preferredOutput = '';
          }
        }
        this.monitorGain = new GainNode(ctx, { gain: 0 });
        this.outputAnalyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0 });
        this.monitorGain.connect(ctx.destination);
        this.set({ contextState: ctx.state, sampleRate: ctx.sampleRate });
        return ctx;
      })();
      this.ctxReady.catch(() => {
        this.ctxReady = null;
      });
    }
    const ctx = await this.ctxReady;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* resume can be refused without a gesture; state listener reports it */
      }
    }
    return ctx;
  }

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  private onContextState() {
    const ctx = this.ctx;
    if (!ctx) return;
    const st = ctx.state as AudioContextState | 'interrupted';
    this.set({ contextState: st });
    if (st !== 'running' && this.state.recording.state === 'recording' && !this.stoppingByUs) {
      // The OS took the audio device (phone call, other app, backgrounded tab on mobile).
      void this.pauseRecording().then(() => this.setRecording({ interruption: 'interrupted' }));
    }
  }

  /** Recreate the context (e.g. after changing the latency mode). Not allowed while recording. */
  async restartContext(): Promise<void> {
    if (this.state.recording.state !== 'idle') return;
    const wasOpen = this.state.input.status === 'on';
    const wasLive = this.state.live.enabled;
    this.closeInput();
    const ctx = this.ctx;
    this.ctx = null;
    this.ctxReady = null;
    this.monitorGain = null;
    this.outputAnalyser = null;
    if (ctx) await ctx.close().catch(() => undefined);
    this.set({ contextState: 'none' });
    if (wasOpen) {
      await this.openInput();
      if (wasLive) this.enableLive(true);
    }
  }

  // ---------------------------------------------------------------- permission & devices
  private async watchPermission() {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      if (!status) return;
      const apply = () => this.set({ permission: status.state as EngineState['permission'] });
      apply();
      status.onchange = () => {
        apply();
        void this.refreshDevices();
      };
    } catch {
      /* Not supported (e.g. some Safari versions) — permission stays "unknown". */
    }
  }

  async refreshDevices() {
    try {
      const devices = await listDevices();
      this.set({ devices });
      this.updateOutputInfo();
    } catch {
      /* ignore */
    }
  }

  private updateOutputInfo() {
    const outs = this.state.devices.outputs;
    const id = this.preferredOutput;
    const match =
      outs.find((d) => d.deviceId === id && id !== '') ?? outs.find((d) => d.deviceId === 'default') ?? outs[0];
    const label = match ? cleanLabel(match.label) : '';
    this.set({
      output: {
        ...this.state.output,
        deviceId: id,
        label,
        kind: label ? classifyLabel(label) : 'unknown',
      },
    });
  }

  private async onDeviceChange() {
    const prevInputs = this.state.devices.inputs;
    await this.refreshDevices();
    const inputs = this.state.devices.inputs;
    const cur = this.state.input.deviceId;
    if (this.state.input.status === 'on' && cur && cur !== 'default' && !inputs.some((d) => d.deviceId === cur)) {
      // The track's "ended" event normally handles this; this is a fallback.
      this.handleInputLost();
    } else if (
      this.state.recording.interruption === 'disconnected' &&
      inputs.length > 0 &&
      inputs.length >= prevInputs.length
    ) {
      // A microphone came back: reconnect so the user can resume.
      await this.openInput(this.preferredInput).catch(() => undefined);
    }
    if (this.preferredOutput && !this.state.devices.outputs.some((d) => d.deviceId === this.preferredOutput)) {
      await this.selectOutput('');
      this.set({ output: { ...this.state.output, error: 'disconnected' } });
    }
  }

  async selectOutput(deviceId: string): Promise<boolean> {
    this.preferredOutput = deviceId;
    if (!this.state.output.selectable) return false;
    try {
      const ctx = this.ctx as (AudioContext & { setSinkId(id: string): Promise<void> }) | null;
      if (ctx) await ctx.setSinkId(deviceId);
      this.set({ output: { ...this.state.output, error: null } });
      this.updateOutputInfo();
      return true;
    } catch (e) {
      this.set({ output: { ...this.state.output, error: String((e as Error)?.message ?? e) } });
      return false;
    }
  }

  // ---------------------------------------------------------------- input
  async openInput(deviceId: string | null = this.preferredInput): Promise<void> {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.setInput({ status: 'error', error: 'insecure', errorDetail: null });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setInput({ status: 'error', error: 'unsupported', errorDetail: null });
      return;
    }
    if (this.state.recording.state === 'recording') return;
    this.setInput({ status: 'opening', error: null, errorDetail: null });
    let ctx: AudioContext;
    try {
      ctx = await this.context();
    } catch (e) {
      this.setInput({ status: 'error', error: 'worklet', errorDetail: String(e) });
      return;
    }

    const constraints = (id: string | null): MediaStreamConstraints => ({
      audio: {
        ...(id && id !== 'default' ? { deviceId: { exact: id } } : {}),
        echoCancellation: false,
        noiseSuppression: this.noiseSuppression,
        autoGainControl: false,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: ctx.sampleRate },
      },
      video: false,
    });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
    } catch (e) {
      const m = mapError(e);
      if (m.code === 'notfound' && deviceId) {
        // The remembered microphone is gone — fall back to the system default.
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints(null));
          deviceId = null;
        } catch (e2) {
          const m2 = mapError(e2);
          this.setInput({ status: 'error', error: m2.code, errorDetail: m2.detail });
          await this.refreshDevices();
          return;
        }
      } else {
        this.setInput({ status: 'error', error: m.code, errorDetail: m.detail });
        await this.refreshDevices();
        return;
      }
    }

    this.teardownSource();
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    track.addEventListener('ended', () => {
      if (this.stream === stream) this.handleInputLost();
    });

    this.ensureInputGraph(ctx);
    this.source = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
    this.source.connect(this.inputGain!);

    await this.refreshDevices();
    const label = cleanLabel(track.label || '');
    const sr = settings.sampleRate ?? null;
    this.setInput({
      status: 'on',
      error: null,
      errorDetail: null,
      deviceId: settings.deviceId ?? deviceId ?? null,
      label,
      kind: classifyLabel(label),
      sampleRate: sr,
      channelCount: settings.channelCount ?? null,
      lowQuality: (sr !== null && sr <= 16000) || /hands[- ]?free|\bhfp\b/i.test(label),
    });
    if (this.state.recording.interruption === 'disconnected') this.setRecording({ interruption: null });
  }

  private ensureInputGraph(ctx: AudioContext) {
    if (this.inputGain) return;
    this.inputGain = new GainNode(ctx, { gain: Math.pow(10, this.inputGainDb / 20) });
    this.inputAnalyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0 });
    this.inputGain.connect(this.inputAnalyser);
    this.recorder = new AudioWorkletNode(ctx, 'qari-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { chunkSize: 4096 },
    });
    this.recorder.port.onmessage = (e) => this.onRecorderMessage(e.data);
    this.recorderSink = new GainNode(ctx, { gain: 0 });
    this.inputGain.connect(this.recorder).connect(this.recorderSink).connect(ctx.destination);
    this.liveChain = createVoiceChain(ctx, this.params, { mode: 'live', onOverload: () => this.onFeedback() });
    this.liveChain.output.connect(this.outputAnalyser!);
    this.liveChain.output.connect(this.monitorGain!);
    this.liveChain.setBypass(this.state.bypass, true);
  }

  private teardownSource() {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
  }

  /** Release the microphone (the browser's recording indicator turns off). */
  closeInput() {
    if (this.state.recording.state !== 'idle') return;
    this.enableLive(false);
    this.teardownSource();
    if (this.liveChain) {
      this.liveChain.dispose();
      this.liveChain = null;
    }
    this.liveConnected = false;
    for (const n of [this.inputGain, this.inputAnalyser, this.recorder, this.recorderSink]) n?.disconnect();
    if (this.recorder) this.recorder.port.onmessage = null;
    this.inputGain = this.inputAnalyser = this.recorderSink = null;
    this.recorder = null;
    this.setInput({ status: 'off', error: null, errorDetail: null });
  }

  private handleInputLost() {
    this.teardownSource();
    const wasRecording = this.state.recording.state === 'recording';
    this.enableLive(false);
    this.setInput({ status: 'error', error: 'disconnected', errorDetail: null });
    if (wasRecording || this.state.recording.state === 'paused') {
      void this.pauseRecording().then(() => this.setRecording({ interruption: 'disconnected' }));
    }
    void this.refreshDevices();
  }

  async selectInput(deviceId: string | null) {
    this.preferredInput = deviceId;
    if (this.state.recording.state === 'recording') return;
    await this.openInput(deviceId);
  }

  setInputGain(db: number) {
    this.inputGainDb = db;
    if (this.inputGain && this.ctx) this.inputGain.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.02);
  }

  getInputAnalyser(): AnalyserNode | null {
    return this.state.input.status === 'on' ? this.inputAnalyser : null;
  }

  getOutputAnalyser(): AnalyserNode | null {
    return this.liveConnected ? this.outputAnalyser : null;
  }

  // ---------------------------------------------------------------- live monitoring
  setParams(p: VoiceParams) {
    this.params = p;
    this.liveChain?.update(p);
  }

  setBypass(on: boolean) {
    this.set({ bypass: on });
    this.liveChain?.setBypass(on);
  }

  setMonitorVolume(v: number) {
    this.monitorVolume = v;
    if (this.monitorGain && this.ctx && this.state.live.enabled && !this.state.live.muted) {
      this.monitorGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  enableLive(on: boolean) {
    if (on && this.state.input.status !== 'on') return;
    const ctx = this.ctx;
    if (on && ctx && this.liveChain && this.inputGain && this.monitorGain) {
      if (!this.liveConnected) {
        this.inputGain.connect(this.liveChain.input);
        this.liveConnected = true;
      }
      this.monitorGain.gain.cancelScheduledValues(ctx.currentTime);
      this.monitorGain.gain.setTargetAtTime(this.monitorVolume, ctx.currentTime, 0.015);
      this.setLive({ enabled: true, muted: null });
    } else {
      if (ctx && this.monitorGain) this.monitorGain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
      if (this.liveConnected && this.inputGain && this.liveChain) {
        const chain = this.liveChain;
        const input = this.inputGain;
        this.liveConnected = false;
        setTimeout(() => {
          if (!this.liveConnected) {
            try {
              input.disconnect(chain.input);
            } catch {
              /* already disconnected */
            }
          }
        }, 80);
      }
      if (this.state.live.enabled || this.state.live.muted) this.setLive({ enabled: false, muted: null });
    }
  }

  private onFeedback() {
    if (!this.state.live.enabled || !this.ctx || !this.monitorGain) return;
    this.monitorGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.monitorGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.setLive({ muted: 'feedback' });
  }

  unmuteLive() {
    if (!this.state.live.enabled || !this.ctx || !this.monitorGain) return;
    this.monitorGain.gain.setTargetAtTime(this.monitorVolume, this.ctx.currentTime, 0.05);
    this.setLive({ muted: null });
  }

  getLatency(): LatencyInfo | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const base = ctx.baseLatency || 0;
    const out = typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0 ? ctx.outputLatency : null;
    const settings = this.stream?.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    const input = typeof settings?.latency === 'number' && settings.latency > 0 ? settings.latency : null;
    const processing = LIMITER_LOOKAHEAD_MS / 1000;
    return { input, base, output: out, processing, total: base + (out ?? 0) + (input ?? 0) + processing, complete: input !== null && out !== null };
  }

  // ---------------------------------------------------------------- recording
  private onRecorderMessage(msg: { type: string; samples?: Float32Array; frames: number; time: number }) {
    if (msg.type === 'data' && msg.samples) {
      this.writer?.push(msg.samples);
    }
    this.lastFrames = msg.frames;
    this.lastFramesCtxTime = msg.time;
    const waiters = this.recorderWaiters.filter((w) => w.type === msg.type);
    this.recorderWaiters = this.recorderWaiters.filter((w) => w.type !== msg.type);
    for (const w of waiters) w.resolve(msg.frames);
  }

  private waitFor(type: string, timeoutMs = 1500): Promise<number> {
    return new Promise((resolve) => {
      const entry = { type, resolve };
      this.recorderWaiters.push(entry);
      setTimeout(() => {
        if (this.recorderWaiters.includes(entry)) {
          this.recorderWaiters = this.recorderWaiters.filter((w) => w !== entry);
          resolve(this.lastFrames);
        }
      }, timeoutMs);
    });
  }

  /** Seconds of audio actually captured (sample-accurate, interpolated between chunks). */
  getRecordedSeconds(): number {
    const sr = this.ctx?.sampleRate || 48000;
    const base = this.lastFrames / sr;
    if (this.state.recording.state !== 'recording' || !this.ctx) return base;
    const extra = Math.min(0.25, Math.max(0, this.ctx.currentTime - this.lastFramesCtxTime));
    return base + extra;
  }

  async startRecording(info: RecordingStartInfo): Promise<string | null> {
    if (this.state.recording.state !== 'idle') return null;
    if (this.state.input.status !== 'on' || !this.recorder || !this.ctx) return null;
    this.setRecording({ state: 'starting', error: null, interruption: null });
    const ctx = await this.context();
    const id = newId();
    const now = Date.now();
    const meta: RecordingMeta = {
      id,
      audioId: id,
      title: info.title,
      surah: info.surah,
      ayahFrom: info.ayahFrom,
      ayahTo: info.ayahTo,
      createdAt: now,
      updatedAt: now,
      duration: 0,
      frames: 0,
      sampleRate: ctx.sampleRate,
      format: info.format,
      status: 'recording',
      presetId: info.presetId,
      presetName: info.presetName,
      params: info.params,
      favorite: false,
      peaks: [],
      inputLabel: this.state.input.label,
    };
    try {
      await putRecording(meta);
    } catch (e) {
      // Without durable storage we refuse to start rather than risk losing the take.
      this.setRecording({ state: 'idle', error: String((e as Error)?.message ?? e), interruption: 'storage' });
      return null;
    }
    this.writer = new TakeWriter(id, ctx.sampleRate, info.format, (e) => {
      this.setRecording({ interruption: 'storage', error: String((e as Error)?.message ?? e) });
    });
    this.lastFrames = 0;
    this.lastFramesCtxTime = ctx.currentTime;
    this.recorder.port.postMessage({ type: 'start' });
    this.setRecording({ state: 'recording', id });
    void this.acquireWakeLock();
    return id;
  }

  async pauseRecording(): Promise<void> {
    if (this.state.recording.state !== 'recording' || !this.recorder) return;
    this.recorder.port.postMessage({ type: 'pause' });
    this.setRecording({ state: 'paused' });
    await this.waitFor('paused');
    await this.writer?.flush();
  }

  async resumeRecording(): Promise<boolean> {
    if (this.state.recording.state !== 'paused' || !this.recorder) return false;
    if (this.state.input.status !== 'on') return false;
    const ctx = await this.context();
    if (ctx.state !== 'running') return false;
    this.lastFramesCtxTime = ctx.currentTime;
    this.recorder.port.postMessage({ type: 'resume' });
    this.setRecording({ state: 'recording', interruption: null });
    void this.acquireWakeLock();
    return true;
  }

  async stopRecording(): Promise<FinishedTake | null> {
    const st = this.state.recording.state;
    if ((st !== 'recording' && st !== 'paused') || !this.writer) return null;
    this.stoppingByUs = true;
    this.setRecording({ state: 'stopping' });
    if (this.recorder) {
      this.recorder.port.postMessage({ type: 'stop' });
      await this.waitFor('stopped');
    }
    const writer = this.writer;
    this.writer = null;
    const samples = await writer.finish();
    const sr = writer.sampleRate;
    const duration = samples.length / sr;
    const peaks = computePeaks(samples);
    try {
      await patchRecording(writer.id, { status: 'draft', frames: samples.length, duration, peaks, updatedAt: Date.now() });
    } catch (e) {
      this.setRecording({ interruption: 'storage', error: String((e as Error)?.message ?? e) });
    }
    audioCache.put(writer.id, samples);
    this.releaseWakeLock();
    this.stoppingByUs = false;
    this.setRecording({ state: 'idle', id: null, interruption: writer.failed ? 'storage' : null });
    return { id: writer.id, samples, sampleRate: sr, duration };
  }

  private async acquireWakeLock() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && !this.wakeLock) this.wakeLock = await wl.request('screen');
    } catch {
      /* not available — not critical */
    }
  }

  private releaseWakeLock() {
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  /** Test & diagnostics hook: simulate the microphone being unplugged. */
  simulateInputLoss() {
    const track = this.stream?.getAudioTracks()[0];
    if (track) {
      track.stop();
      this.handleInputLost();
    }
  }
}

export const engine = new AudioEngine();
