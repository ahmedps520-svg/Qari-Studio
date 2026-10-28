export function sine(freq: number, amp: number, seconds: number, sr = 48000): Float32Array {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

export function noise(amp: number, seconds: number, sr = 48000, seed = 1): Float32Array {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = amp * ((s / 4294967296) * 2 - 1);
  }
  return x;
}

export function rms(x: Float32Array, start = 0, end = x.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

export function peak(x: Float32Array): number {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}

export const db = (x: number) => 20 * Math.log10(x + 1e-20);

/** Bursty "speech": tone bursts (with harmonics) separated by silent gaps. */
export function bursts(seconds: number, sr = 48000, on = 0.6, off = 0.4, amp = 0.3): Float32Array {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ph = t % (on + off);
    if (ph < on) {
      const env = Math.min(1, ph / 0.02) * Math.min(1, (on - ph) / 0.05);
      x[i] = amp * env * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 900 * t)) / 1.75;
    }
  }
  return x;
}
