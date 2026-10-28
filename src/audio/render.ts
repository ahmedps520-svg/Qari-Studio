import { chainLatencySamples, createVoiceChain, loadWorklets } from './chain';
import { measureNoiseProfile } from './dsp/noiseProfile';
import type { VoiceParams } from './params';

export interface Rendered {
  channels: Float32Array[];
  sampleRate: number;
}

/** Seconds of echo/reverb tail to render after the voice ends. */
export function tailSeconds(p: VoiceParams): number {
  let t = 0.05;
  if (p.reverbMix > 0.001) t = Math.max(t, p.reverbDecay * 1.15 + p.preDelayMs / 1000);
  if (p.echoMix > 0.001) {
    const fb = Math.max(0.05, Math.min(0.7, p.echoFeedback));
    t = Math.max(t, (p.echoDelayMs / 1000) * (1 + 6.9 / -Math.log(fb)));
  }
  return Math.min(9, t);
}

/**
 * Render the enhanced version offline through exactly the same chain used for preview.
 * The fixed processing latency is removed so the output lines up with the original.
 */
export async function renderEnhanced(
  samples: Float32Array,
  sampleRate: number,
  params: VoiceParams,
  opts: { targetRate?: number; maxSeconds?: number; onProgress?: (p: number) => void; noiseProfile?: Float32Array | null } = {},
): Promise<Rendered> {
  const rate = opts.targetRate ?? sampleRate;
  // Work at the rendering rate throughout, so the noise profile matches the STFT that uses it.
  const full = rate === sampleRate ? samples : (await resample([samples], sampleRate, rate))[0];
  const src = opts.maxSeconds ? full.subarray(0, Math.min(full.length, Math.round(opts.maxSeconds * rate))) : full;
  const profile = opts.noiseProfile !== undefined ? opts.noiseProfile : params.noiseReduction > 0 ? measureNoiseProfile(full, rate) : null;
  const latency = chainLatencySamples('render', rate);
  const voiceLen = src.length;
  const tail = Math.ceil(tailSeconds(params) * rate);
  const length = Math.max(1, voiceLen + tail + latency);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: rate });
  await loadWorklets(ctx);
  const buf = new AudioBuffer({ length: Math.max(1, src.length), numberOfChannels: 1, sampleRate: rate });
  if (src.length > 0) buf.copyToChannel(src as Float32Array<ArrayBuffer>, 0);
  const chain = createVoiceChain(ctx, params, { mode: 'render', noiseProfile: profile });
  const node = new AudioBufferSourceNode(ctx, { buffer: buf });
  node.connect(chain.input);
  chain.output.connect(ctx.destination);
  node.start(0);

  if (opts.onProgress) {
    const total = length / rate;
    for (let i = 1; i < 20; i++) {
      const t = Math.floor(((total * i) / 20) * rate / 128) * 128 / rate;
      if (t <= 0 || t >= total) continue;
      ctx
        .suspend(t)
        .then(() => {
          opts.onProgress?.(i / 20);
          return ctx.resume();
        })
        .catch(() => undefined);
    }
  }

  const out = await ctx.startRendering();
  chain.dispose();
  const L = out.getChannelData(0);
  const R = out.getChannelData(1);
  // Drop processing latency; trim the silent end of the tail and fade it out smoothly.
  let end = L.length;
  const minEnd = Math.min(L.length, latency + voiceLen);
  const thr = 1e-4;
  while (end > minEnd && Math.abs(L[end - 1]) < thr && Math.abs(R[end - 1]) < thr) end--;
  end = Math.min(L.length, end + Math.round(0.02 * rate));
  const left = L.slice(latency, end);
  const right = R.slice(latency, end);
  const fade = Math.min(left.length, Math.round(0.05 * rate));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    left[left.length - 1 - i] *= g;
    right[right.length - 1 - i] *= g;
  }
  opts.onProgress?.(1);
  return { channels: [left, right], sampleRate: rate };
}

/** Resample mono/stereo audio with the browser's resampler (used for MP3 rate limits). */
export async function resample(channels: Float32Array[], from: number, to: number): Promise<Float32Array[]> {
  if (from === to) return channels;
  const length = Math.ceil((channels[0].length / from) * to);
  const ctx = new OfflineAudioContext({ numberOfChannels: channels.length, length, sampleRate: to });
  const buf = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate: from });
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  const node = new AudioBufferSourceNode(ctx, { buffer: buf });
  node.connect(ctx.destination);
  node.start(0);
  const out = await ctx.startRendering();
  return channels.map((_, i) => out.getChannelData(i).slice());
}
