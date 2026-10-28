/**
 * Synthesises a deterministic, voice-like test signal for the fake microphone:
 * a glottal pulse train with a moving pitch contour (like melodic recitation), shaped by
 * vowel formants, with syllable envelopes, phrase pauses and a faint steady room noise.
 * Writes 16-bit mono WAV (the format Chromium's fake audio capture expects).
 */
import { writeFileSync } from 'node:fs';

export function makeVoice({ seconds = 14, sampleRate = 48000 } = {}) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const vowels = [
    [730, 1090, 2440],
    [270, 2290, 3010],
    [300, 870, 2240],
    [530, 1840, 2480],
  ];
  // Two-pole resonators per formant.
  const res = vowels[0].map(() => ({ y1: 0, y2: 0 }));
  let phase = 0;
  let pink = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phraseT = t % 3.5; // 3.5 s phrases: 2.7 s voiced, 0.8 s pause
    const voiced = phraseT < 2.7;
    const syl = voiced ? Math.pow(Math.sin(Math.PI * ((phraseT * 3.2) % 1)), 0.6) : 0;
    const attack = Math.min(1, phraseT / 0.05) * Math.min(1, Math.max(0, (2.7 - phraseT) / 0.15));
    const f0 = 150 + 40 * Math.sin(2 * Math.PI * 0.35 * t) + 6 * Math.sin(2 * Math.PI * 5.5 * t);
    phase += f0 / sampleRate;
    let src = 0;
    if (phase >= 1) {
      phase -= 1;
      src = 1;
    }
    // Glottal pulse + breath noise.
    src = src * 0.9 + rnd() * 0.02;
    const v = vowels[Math.floor(t * 3.2) % vowels.length];
    let y = 0;
    for (let k = 0; k < 3; k++) {
      const f = v[k];
      const bw = 80 + 40 * k;
      const r = Math.exp((-Math.PI * bw) / sampleRate);
      const a1 = 2 * r * Math.cos((2 * Math.PI * f) / sampleRate);
      const a2 = -r * r;
      const s = res[k];
      const yk = src * (1 - r) * (k === 0 ? 1 : 0.6 / k) + a1 * s.y1 + a2 * s.y2;
      s.y2 = s.y1;
      s.y1 = yk;
      y += yk;
    }
    pink = 0.985 * pink + 0.015 * rnd();
    out[i] = y * 1.6 * syl * attack + pink * 0.012;
  }
  // Normalise voice peaks to about −6 dBFS.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = 0.5 / peak;
  for (let i = 0; i < n; i++) out[i] *= g;
  return { samples: out, sampleRate };
}

export function writeWav16(path, samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  writeFileSync(path, buf);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? 'voice.wav';
  const { samples, sampleRate } = makeVoice();
  writeWav16(path, samples, sampleRate);
  console.log(`wrote ${path}`);
}
