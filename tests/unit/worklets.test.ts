import { describe, expect, it } from 'vitest';
import { measureNoiseProfile, denoiseLatency } from '../../src/audio/dsp/noiseProfile';
import { loadProcessors, run } from './worklet-harness';
import { bursts, db, noise, peak, rms, sine } from './signals';

const SR = 48000;
const procs = loadProcessors(SR);

describe('qari-limiter', () => {
  it('never lets peaks exceed the −1 dBFS ceiling, even for +12 dB input', () => {
    const lim = procs.create('qari-limiter', { lookaheadMs: 1.5, ceilingDb: -1 });
    const x = sine(220, 4, 1);
    const [l, r] = run(lim, [x, x], {}, 2);
    expect(peak(l)).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
    expect(peak(r)).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
  });

  it('is transparent (only delayed) below the ceiling', () => {
    const lim = procs.create('qari-limiter', { lookaheadMs: 1.5, ceilingDb: -1 });
    const x = sine(440, 0.5, 0.5);
    const [l] = run(lim, [x, x], {}, 2);
    const D = Math.round(1.5 * SR / 1000);
    let maxErr = 0;
    for (let i = D; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(l[i] - x[i - D]));
    expect(maxErr).toBeLessThan(1e-6);
  });

  it('reports sustained heavy limiting (feedback guard)', () => {
    const lim = procs.create('qari-limiter', { guard: true });
    const x = sine(1000, 8, 1.5);
    run(lim, [x, x], {}, 2);
    expect(lim.port.posted.some((m) => (m.data as { type: string }).type === 'overload')).toBe(true);
  });

  it('does not trigger the feedback guard for normal recitation levels', () => {
    const lim = procs.create('qari-limiter', { guard: true });
    const x = bursts(4, SR, 0.6, 0.4, 0.9);
    run(lim, [x, x], {}, 2);
    expect(lim.port.posted.length).toBe(0);
  });
});

describe('qari-dynamics', () => {
  it('is bit-transparent with gate and compression at zero', () => {
    const d = procs.create('qari-dynamics');
    const x = bursts(1);
    const [y] = run(d, [x], { gate: 0, comp: 0 });
    let maxErr = 0;
    for (let i = 0; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - x[i]));
    expect(maxErr).toBe(0);
  });

  it('gently lowers steady background noise in pauses (expander)', () => {
    const d = procs.create('qari-dynamics');
    const voice = bursts(6, SR, 0.8, 0.7, 0.3);
    const hiss = noise(0.002, 6, SR, 7); // ≈ −59 dBFS
    const x = voice.map((v, i) => v + hiss[i]);
    const [y] = run(d, [x], { gate: 1, comp: 0 });
    // Last pause (5.3–6.0 s): noise should be reduced substantially, by at most the 18 dB range.
    const s = Math.round(5.55 * SR);
    const e = Math.round(5.95 * SR);
    const reduction = db(rms(x, s, e)) - db(rms(y, s, e));
    expect(reduction).toBeGreaterThan(8);
    expect(reduction).toBeLessThan(18.5);
    // Voice in the middle of a phrase is untouched.
    const vs = Math.round(4.6 * SR);
    const ve = Math.round(4.9 * SR);
    expect(Math.abs(db(rms(x, vs, ve)) - db(rms(y, vs, ve)))).toBeLessThan(0.5);
  });

  it('compresses loud passages while leaving quiet ones nearly unchanged', () => {
    const d = procs.create('qari-dynamics');
    const loud = sine(200, 0.9, 1);
    const [yl] = run(d, [loud], { gate: 0, comp: 1 });
    const d2 = procs.create('qari-dynamics');
    const quiet = sine(200, 0.01, 1);
    const [yq] = run(d2, [quiet], { gate: 0, comp: 1 });
    const grLoud = db(rms(loud, SR / 2)) - db(rms(yl, SR / 2));
    const grQuiet = db(rms(quiet, SR / 2)) - db(rms(yq, SR / 2));
    expect(grLoud).toBeGreaterThan(6);
    expect(Math.abs(grQuiet + 3.5)).toBeLessThan(0.6); // only make-up gain (+3.5 dB)
  });
});

describe('qari-denoise', () => {
  it('reconstructs the input exactly (delayed) at amount 0', () => {
    const dn = procs.create('qari-denoise', { fftSize: 1024 });
    const x = bursts(1);
    const [y] = run(dn, [x], { amount: 0 });
    const L = denoiseLatency(SR);
    let maxErr = 0;
    for (let i = L + 2048; i < x.length - 2048; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - x[i - L]));
    expect(maxErr).toBeLessThan(1e-5);
  });

  it('reduces stationary noise using a profile measured from the pauses', () => {
    const voice = bursts(8, SR, 0.7, 0.5, 0.3);
    const hiss = noise(0.01, 8, SR, 3);
    const x = voice.map((v, i) => v + hiss[i]);
    const profile = measureNoiseProfile(x, SR);
    expect(profile).not.toBeNull();
    const dn = procs.create('qari-denoise', { fftSize: 1024, profile: Array.from(profile!) });
    const [y] = run(dn, [x], { amount: 1 });
    const L = denoiseLatency(SR);
    // Noise in a pause (6.7–7.2 s) drops by more than 8 dB (deliberately gentle, artefact-free);
    // voice in a phrase stays within 1.5 dB.
    const ps = Math.round(6.8 * SR) + L;
    const pe = Math.round(7.1 * SR) + L;
    expect(db(rms(x, ps - L, pe - L)) - db(rms(y, ps, pe))).toBeGreaterThan(8);
    const vs = Math.round(6.2 * SR);
    const ve = Math.round(6.6 * SR);
    expect(Math.abs(db(rms(x, vs, ve)) - db(rms(y, vs + L, ve + L)))).toBeLessThan(1.5);
  });

  it('refuses to build a noise profile from a recording without pauses', () => {
    expect(measureNoiseProfile(sine(220, 0.3, 4), SR)).toBeNull();
  });
});

describe('qari-recorder', () => {
  it('captures samples only while recording and counts frames exactly', () => {
    const rec = procs.create('qari-recorder', { chunkSize: 4096 });
    const x = noise(0.1, 1);
    rec.port.send({ type: 'start' });
    run(rec, [x.subarray(0, 24000)], {}, 1);
    rec.port.send({ type: 'pause' });
    run(rec, [x.subarray(24000, 36000)], {}, 1);
    rec.port.send({ type: 'resume' });
    run(rec, [x.subarray(36000, 48000)], {}, 1);
    rec.port.send({ type: 'stop' });
    const msgs = rec.port.posted.map((m) => m.data as { type: string; samples?: Float32Array; frames: number });
    const captured = msgs.filter((m) => m.type === 'data').reduce((a, m) => a + (m.samples?.length ?? 0), 0);
    const stopped = msgs.find((m) => m.type === 'stopped')!;
    expect(stopped.frames).toBe(24064 + 12032); // whole 128-frame quanta
    expect(captured).toBe(stopped.frames);
  });
});

describe('processor lifetime', () => {
  it('stops processing once disposed so the browser can release it', () => {
    for (const name of ['qari-recorder', 'qari-dynamics', 'qari-denoise', 'qari-limiter']) {
      const p = procs.create(name);
      const io = () => [[new Float32Array(128), new Float32Array(128)]];
      const params = { gate: new Float32Array([0]), comp: new Float32Array([0]), amount: new Float32Array([0]) };
      expect(p.process(io(), io(), params)).toBe(true);
      p.port.send({ type: 'dispose' });
      expect(p.process(io(), io(), params)).toBe(false);
    }
  });
});
