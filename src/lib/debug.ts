import { engine } from '../audio/engine';
import { player } from '../audio/player';
import { BUILT_IN_PRESETS } from '../audio/presets';
import { renderEnhanced } from '../audio/render';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { useStudio } from '../state/studio';
import * as db from './db';

/**
 * Diagnostics hooks on window.__qari — used by the end-to-end tests to verify that audio is
 * really processed (spectra of the live input vs. the monitored output). Read-only helpers;
 * nothing here changes behaviour.
 */
async function analyseLive(ms = 1500) {
  const a = engine.getInputAnalyser();
  const b = engine.getOutputAnalyser();
  if (!a || !b) return null;
  const bins = a.frequencyBinCount;
  const accA = new Float64Array(bins);
  const accB = new Float64Array(bins);
  const fa = new Float32Array(bins);
  const fb = new Float32Array(bins);
  const ta = new Float32Array(a.fftSize);
  const tb = new Float32Array(b.fftSize);
  let frames = 0;
  let rmsA = 0;
  let rmsB = 0;
  const seriesA: number[] = [];
  const seriesB: number[] = [];
  const end = performance.now() + ms;
  while (performance.now() < end) {
    a.getFloatFrequencyData(fa);
    b.getFloatFrequencyData(fb);
    a.getFloatTimeDomainData(ta);
    b.getFloatTimeDomainData(tb);
    for (let i = 0; i < bins; i++) {
      accA[i] += Math.pow(10, fa[i] / 10);
      accB[i] += Math.pow(10, fb[i] / 10);
    }
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < ta.length; i++) sa += ta[i] * ta[i];
    for (let i = 0; i < tb.length; i++) sb += tb[i] * tb[i];
    rmsA += Math.sqrt(sa / ta.length);
    rmsB += Math.sqrt(sb / tb.length);
    seriesA.push(Math.sqrt(sa / ta.length));
    seriesB.push(Math.sqrt(sb / tb.length));
    frames++;
    await new Promise((r) => setTimeout(r, 30));
  }
  const toDb = (acc: Float64Array) => Array.from(acc, (v) => 10 * Math.log10(v / frames + 1e-20));
  // Level of the monitored output relative to the input during pauses (input below −45 dBFS):
  // reverb and echo tails show up here; a transparent chain stays near 0 dB.
  const pauses = seriesA.map((a, i) => [a, seriesB[i]]).filter(([a]) => a < 0.0056);
  const pauseGainDb = pauses.length
    ? 20 * Math.log10(pauses.reduce((x, [, b]) => x + b, 0) / pauses.reduce((x, [a]) => x + a, 0))
    : null;
  return {
    pauseGainDb,
    pauseFrames: pauses.length,
    sampleRate: engine.audioContext?.sampleRate ?? 0,
    inputDb: toDb(accA),
    outputDb: toDb(accB),
    inputRms: rmsA / frames,
    outputRms: rmsB / frames,
  };
}

export function exposeDebugHooks() {
  (window as unknown as { __qari: unknown }).__qari = {
    engine,
    player,
    db,
    analyseLive,
    renderEnhanced,
    presets: BUILT_IN_PRESETS,
    stores: { library: useLibrary, settings: useSettings, studio: useStudio },
    version: __APP_VERSION__,
  };
}
