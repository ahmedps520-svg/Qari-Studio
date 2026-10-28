/** Peak envelope for waveform drawing: `buckets` values in 0..1 (max |x| per bucket). */
export function computePeaks(samples: Float32Array, buckets = 960): number[] {
  const out: number[] = new Array(buckets).fill(0);
  if (samples.length === 0) return out;
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * per);
    const e = Math.min(samples.length, Math.max(s + 1, Math.floor((b + 1) * per)));
    let m = 0;
    for (let i = s; i < e; i++) {
      const v = samples[i] < 0 ? -samples[i] : samples[i];
      if (v > m) m = v;
    }
    out[b] = Math.round(Math.min(1, m) * 10000) / 10000;
  }
  return out;
}

/** Resample a peak array to a different bucket count (max-preserving). */
export function resamplePeaks(peaks: number[], count: number): number[] {
  if (peaks.length === 0) return new Array(count).fill(0);
  const out = new Array(count).fill(0);
  const per = peaks.length / count;
  for (let i = 0; i < count; i++) {
    const s = Math.floor(i * per);
    const e = Math.max(s + 1, Math.floor((i + 1) * per));
    let m = 0;
    for (let j = s; j < e && j < peaks.length; j++) m = Math.max(m, peaks[j]);
    out[i] = m;
  }
  return out;
}
