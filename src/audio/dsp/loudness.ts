/**
 * Integrated loudness (ITU-R BS.1770-4 / EBU R128): K-weighting, 400 ms blocks with 75 %
 * overlap, absolute gate at −70 LUFS and relative gate at −10 LU.
 */
interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Coefficients derived for arbitrary sample rates (as in libebur128 / pyloudnorm).
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return [shelf, hp];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = f.b0 * v + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = o;
    y[i] = o;
  }
  return y;
}

export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  if (channels.length === 0 || channels[0].length === 0) return -Infinity;
  const [shelf, hp] = kWeighting(sampleRate);
  const weighted = channels.map((c) => filter(filter(c, shelf), hp));
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const len = channels[0].length;
  const z: number[] = [];
  if (len < block) {
    let s = 0;
    for (const w of weighted) for (let i = 0; i < len; i++) s += w[i] * w[i];
    const ms = s / len;
    return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity;
  }
  for (let start = 0; start + block <= len; start += step) {
    let s = 0;
    for (const w of weighted) {
      for (let i = start; i < start + block; i++) s += w[i] * w[i];
    }
    z.push(s / block);
  }
  const lk = (ms: number) => -0.691 + 10 * Math.log10(ms);
  const abs = z.filter((ms) => ms > 0 && lk(ms) > -70);
  if (abs.length === 0) return -Infinity;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const relThreshold = lk(meanAbs) - 10;
  const rel = abs.filter((ms) => lk(ms) > relThreshold);
  if (rel.length === 0) return -Infinity;
  return lk(rel.reduce((a, b) => a + b, 0) / rel.length);
}

export function peakDb(channels: Float32Array[]): number {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}
