import { makeFFT } from './fft';

/** STFT size used by the qari-denoise worklet for a given sample rate. */
export function denoiseFftSize(sampleRate: number): number {
  return sampleRate > 50000 ? 2048 : 1024;
}

/** Fixed latency (samples) introduced by the qari-denoise worklet. */
export function denoiseLatency(sampleRate: number): number {
  return denoiseFftSize(sampleRate);
}

/**
 * Measures the stationary background noise of a recording: the average magnitude spectrum of
 * its quietest frames (pauses between phrases). Returns null when the recording is too short
 * or has no usable quiet passages, in which case spectral noise reduction is skipped.
 */
export function measureNoiseProfile(samples: Float32Array, sampleRate: number): Float32Array | null {
  const N = denoiseFftSize(sampleRate);
  const H = N / 4;
  const frames = Math.floor((samples.length - N) / H);
  if (frames < 24) return null;
  const fft = makeFFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  // Pick candidate frames by energy, sampling at most ~4000 frames for speed.
  const stride = Math.max(1, Math.floor(frames / 4000));
  const energies: { idx: number; e: number }[] = [];
  for (let f = 0; f < frames; f += stride) {
    let e = 0;
    const o = f * H;
    for (let i = 0; i < N; i++) {
      const v = samples[o + i];
      e += v * v;
    }
    if (e > 1e-14 * N) energies.push({ idx: f, e }); // ignore digital silence
  }
  if (energies.length < 12) return null;
  energies.sort((a, b) => a.e - b.e);
  const count = Math.max(8, Math.floor(energies.length * 0.12));
  const chosen = energies.slice(0, count);

  // A recording with no real pauses (quietest frames still loud) would yield a "noise" profile
  // that is actually voice; refuse rather than damage the recitation.
  const median = energies[Math.floor(energies.length / 2)].e;
  const quiet = chosen[chosen.length - 1].e;
  if (quiet > median * 0.5) return null;

  const bins = N / 2 + 1;
  const mags = new Float64Array(bins);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (const { idx } of chosen) {
    const o = idx * H;
    for (let i = 0; i < N; i++) {
      re[i] = samples[o + i] * win[i];
      im[i] = 0;
    }
    fft(re, im, false);
    for (let k = 0; k < bins; k++) mags[k] += Math.hypot(re[k], im[k]);
  }
  const out = new Float32Array(bins);
  for (let k = 0; k < bins; k++) out[k] = mags[k] / chosen.length;
  return out;
}
