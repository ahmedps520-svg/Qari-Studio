import { describe, expect, it } from 'vitest';
import { estimateRT60, generateImpulse } from '../../src/audio/dsp/impulse';
import { integratedLoudness } from '../../src/audio/dsp/loudness';
import { computePeaks, resamplePeaks } from '../../src/audio/dsp/peaks';
import { PARAM_SPECS } from '../../src/audio/params';
import { BUILT_IN_PRESETS, paramsEqual } from '../../src/audio/presets';
import { tailSeconds } from '../../src/audio/render';
import { sine } from './signals';

describe('loudness (BS.1770)', () => {
  it('measures a 1 kHz sine at −20 dBFS as about −23 LUFS (mono)', () => {
    const l = integratedLoudness([sine(997, 0.1, 5)], 48000);
    expect(l).toBeGreaterThan(-23.3);
    expect(l).toBeLessThan(-22.7);
  });
  it('ignores silence via the gates', () => {
    const x = new Float32Array(48000 * 6);
    x.set(sine(997, 0.1, 3), 0);
    const l = integratedLoudness([x], 48000);
    expect(Math.abs(l - integratedLoudness([sine(997, 0.1, 3)], 48000))).toBeLessThan(0.3);
  });
});

describe('reverb impulse', () => {
  it('decays at the requested rate', () => {
    for (const decay of [0.8, 2.4, 4.8]) {
      const ir = generateImpulse({ sampleRate: 48000, decay, size: 0.6, early: 0.5, damping: 0.4 });
      const rt = estimateRT60(ir.left, 48000);
      expect(rt).toBeGreaterThan(decay * 0.75);
      expect(rt).toBeLessThan(decay * 1.3);
    }
  });
  it('is deterministic, stereo-decorrelated and energy-normalised', () => {
    const a = generateImpulse({ sampleRate: 48000, decay: 2, size: 0.5, early: 0.5, damping: 0.5 });
    const b = generateImpulse({ sampleRate: 48000, decay: 2, size: 0.5, early: 0.5, damping: 0.5 });
    expect(a.left).toEqual(b.left);
    let e = 0;
    let c = 0;
    for (let i = 0; i < a.left.length; i++) {
      e += a.left[i] * a.left[i] + a.right[i] * a.right[i];
      c += a.left[i] * a.right[i];
    }
    expect(e / 2).toBeCloseTo(1, 2);
    expect(Math.abs(c / (e / 2))).toBeLessThan(0.15);
  });
  it('damps high frequencies faster when damping is high', () => {
    const hf = (damping: number) => {
      const ir = generateImpulse({ sampleRate: 48000, decay: 3, size: 0.5, early: 0, damping }).left;
      // Share of high-frequency energy in the late tail (second difference ≈ high-pass).
      let hi = 0;
      let all = 0;
      for (let i = 48000; i < 96000; i++) {
        hi += (ir[i] - 2 * ir[i - 1] + ir[i - 2]) ** 2;
        all += ir[i] ** 2;
      }
      return hi / all;
    };
    expect(hf(0.9)).toBeLessThan(hf(0.1) * 0.25);
  });
});

describe('presets', () => {
  it('are eight distinct, valid processing configurations', () => {
    expect(BUILT_IN_PRESETS).toHaveLength(8);
    for (let i = 0; i < BUILT_IN_PRESETS.length; i++) {
      for (let j = i + 1; j < BUILT_IN_PRESETS.length; j++) {
        expect(paramsEqual(BUILT_IN_PRESETS[i].params, BUILT_IN_PRESETS[j].params)).toBe(false);
      }
      for (const spec of Object.values(PARAM_SPECS)) {
        const v = BUILT_IN_PRESETS[i].params[spec.key];
        expect(v).toBeGreaterThanOrEqual(spec.min);
        expect(v).toBeLessThanOrEqual(spec.max);
      }
    }
  });
  it('respect their character', () => {
    const p = Object.fromEntries(BUILT_IN_PRESETS.map((x) => [x.id, x.params]));
    expect(p['plain-vanilla'].echoMix + p['plain-vanilla'].reverbMix + p['plain-vanilla'].compression).toBe(0);
    expect(p['pure-voice'].echoMix + p['pure-voice'].reverbMix).toBe(0);
    expect(p['grand-mosque'].reverbDecay).toBeGreaterThan(p['beautiful-plus'].reverbDecay);
    expect(p['soft-echo'].reverbDecay).toBeLessThan(1.2);
    expect(p['studio-qari'].compression).toBeGreaterThan(p['beautiful-plus'].compression);
    expect(p['warm-deep'].lowDb).toBeGreaterThan(0);
    expect(p['warm-deep'].highDb).toBeLessThan(0);
    expect(p['cinematic-space'].width).toBeGreaterThan(1.2);
    // Wet levels stay below the voice: no preset buries the recitation.
    for (const x of BUILT_IN_PRESETS) expect(x.params.reverbMix).toBeLessThan(0.5);
  });
  it('render enough tail for their reverb and echo', () => {
    const gm = BUILT_IN_PRESETS.find((x) => x.id === 'grand-mosque')!.params;
    expect(tailSeconds(gm)).toBeGreaterThan(gm.reverbDecay);
    expect(tailSeconds(BUILT_IN_PRESETS[0].params)).toBeLessThan(0.1);
  });
});

describe('waveform peaks', () => {
  it('captures the envelope and resamples max-preserving', () => {
    const x = new Float32Array(9600);
    x[4800] = 0.8;
    const p = computePeaks(x, 96);
    expect(Math.max(...p)).toBeCloseTo(0.8, 3);
    expect(Math.max(...resamplePeaks(p, 10))).toBeCloseTo(0.8, 3);
  });
});
