/**
 * Procedural reverb impulse responses.
 *
 * The response is built the way real rooms behave: a set of discrete early reflections whose
 * spacing grows with room size, followed by a dense, decorrelated stereo tail that decays
 * exponentially. The tail is split into three bands with their own decay times so that high
 * frequencies die away faster than lows (air and surface absorption) — the "damping" control.
 *
 * Generation is deterministic (seeded) so that previewing and exporting produce identical sound.
 */
export interface ImpulseOptions {
  sampleRate: number;
  /** RT60 decay time in seconds. */
  decay: number;
  /** 0..1 */
  size: number;
  /** 0..1 early reflection level. */
  early: number;
  /** 0..1 high-frequency damping. */
  damping: number;
  seed?: number;
}

export interface Impulse {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function impulseLength(decay: number, sampleRate: number): number {
  return Math.ceil(sampleRate * Math.min(9, clamp(decay, 0.2, 8) * 1.2 + 0.12));
}

export function generateImpulse(opts: ImpulseOptions): Impulse {
  const sr = opts.sampleRate;
  const decay = clamp(opts.decay, 0.2, 8);
  const size = clamp(opts.size, 0, 1);
  const early = clamp(opts.early, 0, 1);
  const damping = clamp(opts.damping, 0, 1);
  const seed = opts.seed ?? 0x51a7;
  const len = impulseLength(decay, sr);

  const rtLow = decay * (1.12 - 0.08 * damping);
  const rtMid = decay;
  const rtHigh = Math.max(0.12, decay * (0.85 - 0.6 * damping));
  const kLow = Math.exp(-6.907755 / (rtLow * sr));
  const kMid = Math.exp(-6.907755 / (rtMid * sr));
  const kHigh = Math.exp(-6.907755 / (rtHigh * sr));
  const aLow = Math.exp((-2 * Math.PI * 450) / sr);
  const aHigh = Math.exp((-2 * Math.PI * 3800) / sr);

  // Early reflections occupy the first ~(10 + 70·size) ms; the diffuse tail fades in over it.
  const erEnd = (0.01 + 0.07 * size) * sr;
  const tailStart = 0.004 * sr;
  const tailRamp = Math.max(1, erEnd * 0.9);

  const channels = [new Float32Array(len), new Float32Array(len)];
  for (let ch = 0; ch < 2; ch++) {
    const out = channels[ch];
    const rnd = mulberry32(seed + ch * 7919);
    let low = 0;
    let lp = 0;
    let eL = 1;
    let eM = 1;
    let eH = 1;
    // Time-varying 2-pole low-pass: the tail darkens as it decays (air & surface absorption).
    const fStart = Math.min(16000, sr * 0.42);
    const fEnd = fStart * (1 - 0.9 * damping) + 400 * damping;
    let lp1 = 0;
    let lp2 = 0;
    let a = 0;
    for (let n = 0; n < len; n++) {
      if ((n & 63) === 0) {
        const fc = fStart * Math.pow(fEnd / fStart, Math.min(1.5, n / (decay * sr)));
        a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      }
      const w = rnd() * 2 - 1;
      low = (1 - aLow) * w + aLow * low;
      lp = (1 - aHigh) * w + aHigh * lp;
      const high = w - lp;
      const mid = lp - low;
      let s = low * 1.6 * eL + mid * eM + high * 0.8 * eH;
      lp1 += a * (s - lp1);
      lp2 += a * (lp1 - lp2);
      s = lp2;
      eL *= kLow;
      eM *= kMid;
      eH *= kHigh;
      if (n < tailStart) s = 0;
      else if (n < tailStart + tailRamp) {
        const x = (n - tailStart) / tailRamp;
        s *= 0.5 - 0.5 * Math.cos(Math.PI * x);
      }
      out[n] = s;
    }

    // Energy of the early part of the tail, to balance the early reflections against it.
    const earlyWindow = Math.min(len, Math.round(erEnd + 0.05 * sr));
    let tailEarlyEnergy = 0;
    for (let n = 0; n < earlyWindow; n++) tailEarlyEnergy += out[n] * out[n];

    // Early reflections: spacing grows with room size; each tap is slightly smeared (absorption).
    if (early > 0) {
      const taps = 8 + Math.round(14 * size);
      const erRnd = mulberry32(seed * 3 + 101 + ch * 31);
      const erLp = 1 - Math.exp((-2 * Math.PI * (9000 - 4000 * damping)) / sr);
      const raw = new Float32Array(Math.min(len, Math.ceil(erEnd) + 8));
      for (let i = 0; i < taps; i++) {
        const frac = (i + 0.35 + erRnd() * 0.6) / taps;
        const t = Math.floor((0.0025 + Math.pow(frac, 1.4) * (erEnd / sr - 0.0025)) * sr);
        const amp = (1 - 0.7 * frac) * (erRnd() < 0.5 ? -1 : 1) * (0.7 + 0.3 * erRnd());
        if (t + 2 < raw.length) {
          raw[t] += amp * 0.5;
          raw[t + 1] += amp * 0.3;
          raw[t + 2] += amp * 0.2;
        }
      }
      let y = 0;
      let erEnergy = 0;
      for (let n = 0; n < raw.length; n++) {
        y += erLp * (raw[n] - y);
        raw[n] = y;
        erEnergy += y * y;
      }
      // Early reflections carry up to ~70 % of the energy of the early tail.
      const target = early * 0.7 * tailEarlyEnergy;
      const level = erEnergy > 0 ? Math.sqrt(target / erEnergy) : 0;
      for (let n = 0; n < raw.length; n++) out[n] += raw[n] * level;
    }
  }

  // Normalise to unit energy per channel so the reverb level control is consistent across sizes.
  let energy = 0;
  for (const c of channels) for (let n = 0; n < len; n++) energy += c[n] * c[n];
  const g = energy > 0 ? 1 / Math.sqrt(energy / 2) : 0;
  for (const c of channels) for (let n = 0; n < len; n++) c[n] *= g;

  // Short fade at the very end to avoid a truncation click.
  const fade = Math.min(len, Math.round(0.02 * sr));
  for (const c of channels) for (let i = 0; i < fade; i++) c[len - 1 - i] *= i / fade;

  return { left: channels[0], right: channels[1], sampleRate: sr };
}

/** Rough RT60 estimate (Schroeder backward integration, −5 to −25 dB, extrapolated). */
export function estimateRT60(x: Float32Array, sampleRate: number): number {
  const edc = new Float64Array(x.length);
  let acc = 0;
  for (let i = x.length - 1; i >= 0; i--) {
    acc += x[i] * x[i];
    edc[i] = acc;
  }
  const total = edc[0] || 1;
  let t5 = -1;
  let t25 = -1;
  for (let i = 0; i < x.length; i++) {
    const db = 10 * Math.log10(edc[i] / total + 1e-30);
    if (t5 < 0 && db <= -5) t5 = i;
    if (t25 < 0 && db <= -25) {
      t25 = i;
      break;
    }
  }
  if (t5 < 0 || t25 < 0) return 0;
  return ((t25 - t5) / sampleRate) * 3;
}

const cache = new Map<string, AudioBuffer>();

export function impulseKey(o: ImpulseOptions): string {
  return [o.sampleRate, o.decay.toFixed(2), o.size.toFixed(2), o.early.toFixed(2), o.damping.toFixed(2)].join('|');
}

/** Create (or reuse) an AudioBuffer for the impulse. Buffers are context-agnostic. */
export function impulseBuffer(ctx: BaseAudioContext, o: Omit<ImpulseOptions, 'sampleRate'>): AudioBuffer {
  const opts = { ...o, sampleRate: ctx.sampleRate };
  const key = impulseKey(opts);
  const hit = cache.get(key);
  if (hit) return hit;
  const ir = generateImpulse(opts);
  const buf = new AudioBuffer({ length: ir.left.length, numberOfChannels: 2, sampleRate: ctx.sampleRate });
  buf.copyToChannel(ir.left as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(ir.right as Float32Array<ArrayBuffer>, 1);
  if (cache.size > 24) cache.delete(cache.keys().next().value as string);
  cache.set(key, buf);
  return buf;
}

export function clearImpulseCache() {
  cache.clear();
}
