import { impulseBuffer, impulseKey } from './dsp/impulse';
import { denoiseFftSize, denoiseLatency } from './dsp/noiseProfile';
import type { VoiceParams } from './params';

/**
 * The Qari Studio voice chain. One implementation serves live monitoring, real-time preview of
 * recordings and offline export rendering, so what you hear is what you export.
 *
 *  input ─► high-pass ─► [spectral NR]* ─► expander+compressor ─► EQ (warmth, de-mud, mid,
 *  presence, air) ─┬─► dry ─────────────────────────────────────────────┐
 *                  ├─► echo (feedback delay, tone-filtered) ─┬─► wet bus ┼─► output level ─► limiter ─► out
 *                  └─► reverb (pre-delay ─► convolution) ◄───┘   (M/S width)
 *
 *  * spectral noise reduction is used for recordings only (it adds ~16 ms of latency).
 */
export type ChainMode = 'live' | 'preview' | 'render';

export const LIMITER_LOOKAHEAD_MS = 1.5;
export const WORKLET_URL = `${import.meta.env.BASE_URL}worklets/qari-processors.js?v=${__APP_VERSION__}`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

export function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(WORKLET_URL);
    loaded.set(ctx, p);
    p.catch(() => loaded.delete(ctx));
  }
  return p;
}

export interface ChainOptions {
  mode: ChainMode;
  noiseProfile?: Float32Array | null;
  /** Report sustained heavy limiting (likely acoustic feedback). Live only. */
  onOverload?: () => void;
}

export interface VoiceChain {
  readonly input: GainNode;
  readonly output: GainNode;
  /** Fixed latency of the processed path, in samples. */
  readonly latencySamples: number;
  update(p: VoiceParams, immediate?: boolean): void;
  setBypass(on: boolean, immediate?: boolean): void;
  setNoiseProfile(profile: Float32Array | null): void;
  dispose(): void;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

export function chainLatencySamples(mode: ChainMode, sampleRate: number): number {
  return (mode === 'live' ? 0 : denoiseLatency(sampleRate)) + Math.round((LIMITER_LOOKAHEAD_MS * sampleRate) / 1000);
}

export function createVoiceChain(ctx: BaseAudioContext, initial: VoiceParams, opts: ChainOptions): VoiceChain {
  const live = opts.mode === 'live';
  const realtime = opts.mode !== 'render';
  const sr = ctx.sampleRate;
  const latencySamples = chainLatencySamples(opts.mode, sr);
  const nodes: AudioNode[] = [];
  const track = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const mono = { channelCount: 1, channelCountMode: 'explicit' as const, channelInterpretation: 'speakers' as const };
  const stereo = { channelCount: 2, channelCountMode: 'explicit' as const, channelInterpretation: 'speakers' as const };

  const input = track(new GainNode(ctx, { gain: 1, ...mono }));
  const output = track(new GainNode(ctx, { gain: 1, ...stereo }));

  // ---- Bypass (original voice), latency-aligned with the processed path ----
  const bypassDelay = track(new DelayNode(ctx, { maxDelayTime: 0.2, delayTime: latencySamples / sr }));
  const bypassGain = track(new GainNode(ctx, { gain: 0 }));
  const procGain = track(new GainNode(ctx, { gain: 1 }));
  input.connect(bypassDelay).connect(bypassGain).connect(output);

  // ---- Tone & dynamics ----
  const hp = track(new BiquadFilterNode(ctx, { type: 'highpass', frequency: initial.highpassHz, Q: 0.707 }));
  const denoise = live
    ? null
    : track(
        new AudioWorkletNode(ctx, 'qari-denoise', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          ...mono,
          processorOptions: { fftSize: denoiseFftSize(sr), profile: opts.noiseProfile ?? null },
        }),
      );
  const dynamics = track(
    new AudioWorkletNode(ctx, 'qari-dynamics', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], ...mono }),
  );
  const lowShelf = track(new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: initial.lowFreq, gain: 0 }));
  const mud = track(new BiquadFilterNode(ctx, { type: 'peaking', frequency: 280, Q: 1.1, gain: 0 }));
  const mid = track(new BiquadFilterNode(ctx, { type: 'peaking', frequency: initial.midFreq, Q: 0.9, gain: 0 }));
  const presence = track(new BiquadFilterNode(ctx, { type: 'peaking', frequency: 3200, Q: 0.9, gain: 0 }));
  const air = track(new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8500, gain: 0 }));
  const post = track(new GainNode(ctx, { gain: 1, ...mono }));

  let node: AudioNode = input.connect(hp);
  if (denoise) node = node.connect(denoise);
  node.connect(dynamics).connect(lowShelf).connect(mud).connect(mid).connect(presence).connect(air).connect(post);

  // ---- Mix busses ----
  const mix = track(new GainNode(ctx, { gain: 1, ...stereo }));
  const dry = track(new GainNode(ctx, { gain: 1 }));
  post.connect(dry).connect(mix);
  const wetBus = track(new GainNode(ctx, { gain: 1, ...stereo }));

  // ---- Echo: feedback delay with band-limited repeats (hard-capped feedback) ----
  const echoSend = track(new GainNode(ctx, { gain: 0 }));
  const echoDelay = track(new DelayNode(ctx, { maxDelayTime: 1, delayTime: initial.echoDelayMs / 1000 }));
  const echoLp = track(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: initial.echoToneHz, Q: 0.6 }));
  const echoHp = track(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 180, Q: 0.6 }));
  const echoFb = track(new GainNode(ctx, { gain: 0 }));
  const echoOut = track(new GainNode(ctx, { gain: 1 }));
  post.connect(echoSend).connect(echoDelay).connect(echoLp).connect(echoHp).connect(echoOut).connect(wetBus);
  echoHp.connect(echoFb).connect(echoDelay);

  // ---- Reverb: high-passed send, pre-delay, convolution (cross-faded on change) ----
  const reverbSend = track(new GainNode(ctx, { gain: 0 }));
  const echoToReverb = track(new GainNode(ctx, { gain: 0.35 }));
  const revHp = track(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 160, Q: 0.6 }));
  const preDelay = track(new DelayNode(ctx, { maxDelayTime: 0.25, delayTime: initial.preDelayMs / 1000 }));
  post.connect(reverbSend);
  echoOut.connect(echoToReverb).connect(reverbSend);
  reverbSend.connect(revHp).connect(preDelay);

  let conv: { node: ConvolverNode; gain: GainNode; key: string } | null = null;
  let irTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingParams: VoiceParams | null = null;

  const applyImpulse = (p: VoiceParams, immediate: boolean) => {
    const o = { decay: p.reverbDecay, size: p.roomSize, early: p.earlyReflections, damping: p.damping };
    const key = impulseKey({ ...o, sampleRate: sr });
    if (conv && conv.key === key) return;
    const buffer = impulseBuffer(ctx, o);
    const node = new ConvolverNode(ctx, { buffer, disableNormalization: true });
    const gain = new GainNode(ctx, { gain: immediate || !conv ? 1 : 0 });
    preDelay.connect(node).connect(gain).connect(wetBus);
    const old = conv;
    conv = { node, gain, key };
    if (old) {
      // Disconnect the input side too, or the old convolver (and its kernels) stays alive.
      const release = () => {
        try {
          preDelay.disconnect(old.node);
        } catch {
          /* already disconnected */
        }
        old.node.disconnect();
        old.gain.disconnect();
      };
      if (immediate) release();
      else {
        const t = ctx.currentTime;
        gain.gain.setTargetAtTime(1, t, 0.03);
        old.gain.gain.setTargetAtTime(0, t, 0.03);
        setTimeout(release, 300);
      }
    }
  };

  // ---- Stereo width (mid/side) on the wet bus ----
  const splitter = track(new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }));
  const merger = track(new ChannelMergerNode(ctx, { numberOfInputs: 2 }));
  const gLL = track(new GainNode(ctx, { gain: 1 }));
  const gLR = track(new GainNode(ctx, { gain: 0 }));
  const gRL = track(new GainNode(ctx, { gain: 0 }));
  const gRR = track(new GainNode(ctx, { gain: 1 }));
  wetBus.connect(splitter);
  splitter.connect(gLL, 0).connect(merger, 0, 0);
  splitter.connect(gLR, 0).connect(merger, 0, 1);
  splitter.connect(gRL, 1).connect(merger, 0, 0);
  splitter.connect(gRR, 1).connect(merger, 0, 1);
  merger.connect(mix);

  // ---- Output level & protection ----
  const outGain = track(new GainNode(ctx, { gain: 1, ...stereo }));
  const limiter = track(
    new AudioWorkletNode(ctx, 'qari-limiter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      ...stereo,
      processorOptions: { lookaheadMs: LIMITER_LOOKAHEAD_MS, ceilingDb: -1, releaseMs: 80, guard: Boolean(opts.onOverload) },
    }),
  );
  if (opts.onOverload) {
    limiter.port.onmessage = (e) => {
      if (e.data?.type === 'overload') opts.onOverload?.();
    };
  }
  mix.connect(outGain).connect(limiter).connect(procGain).connect(output);

  // ---- Parameter application ----
  const set = (param: AudioParam, value: number, immediate: boolean) => {
    if (!realtime || immediate) {
      param.cancelScheduledValues(0);
      param.value = value;
      if (realtime) param.setValueAtTime(value, ctx.currentTime);
    } else {
      param.setTargetAtTime(value, ctx.currentTime, 0.03);
    }
  };

  const update = (p: VoiceParams, immediate = false) => {
    set(hp.frequency, p.highpassHz, immediate);
    set(lowShelf.frequency, p.lowFreq, immediate);
    set(lowShelf.gain, p.lowDb, immediate);
    set(mud.gain, -2.5 * p.clarity, immediate);
    set(mid.frequency, p.midFreq, immediate);
    set(mid.gain, p.midDb, immediate);
    set(presence.gain, p.presenceDb + 4 * p.clarity, immediate);
    set(air.gain, p.highDb + 2 * p.clarity, immediate);

    const gate = dynamics.parameters.get('gate');
    const comp = dynamics.parameters.get('comp');
    if (gate) set(gate, live ? p.noiseReduction : p.noiseReduction * 0.5, immediate);
    if (comp) set(comp, p.compression, immediate);
    const amount = denoise?.parameters.get('amount');
    if (amount) set(amount, p.noiseReduction, immediate);

    set(echoSend.gain, p.echoMix, immediate);
    set(echoDelay.delayTime, p.echoDelayMs / 1000, immediate);
    set(echoFb.gain, Math.min(0.7, Math.max(0, p.echoFeedback)), immediate);
    set(echoLp.frequency, p.echoToneHz, immediate);

    set(reverbSend.gain, p.reverbMix, immediate);
    set(preDelay.delayTime, p.preDelayMs / 1000, immediate);

    const w = live ? Math.min(1, p.width) : p.width;
    const a = 0.5 * (1 + w);
    const b = 0.5 * (1 - w);
    set(gLL.gain, a, immediate);
    set(gRR.gain, a, immediate);
    set(gLR.gain, b, immediate);
    set(gRL.gain, b, immediate);

    set(outGain.gain, dbToGain(p.outputDb), immediate);

    if (immediate || !realtime || !conv) {
      if (irTimer) clearTimeout(irTimer);
      irTimer = null;
      applyImpulse(p, true);
    } else {
      // Regenerating an impulse response takes a few milliseconds; coalesce slider drags.
      pendingParams = p;
      if (!irTimer) {
        irTimer = setTimeout(() => {
          irTimer = null;
          if (pendingParams) applyImpulse(pendingParams, false);
          pendingParams = null;
        }, 140);
      }
    }
  };

  update(initial, true);

  return {
    input,
    output,
    latencySamples,
    update,
    setBypass(on: boolean, immediate = false) {
      set(bypassGain.gain, on ? 1 : 0, immediate);
      set(procGain.gain, on ? 0 : 1, immediate);
    },
    setNoiseProfile(profile: Float32Array | null) {
      denoise?.port.postMessage({ type: 'profile', profile });
    },
    dispose() {
      if (irTimer) clearTimeout(irTimer);
      for (const n of nodes) n.disconnect();
      if (conv) {
        conv.node.disconnect();
        conv.gain.disconnect();
      }
      limiter.port.onmessage = null;
      // Let the audio thread stop running the worklet processors.
      for (const w of [dynamics, limiter, denoise]) w?.port.postMessage({ type: 'dispose' });
    },
  };
}
