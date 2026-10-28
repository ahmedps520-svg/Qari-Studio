/**
 * Voice-processing parameters. Every preset is a complete, concrete configuration of the
 * same real processing chain (see chain.ts) — presets differ in sound, not just in name.
 */
export interface VoiceParams {
  /** Rumble filter cut-off (Hz). 20 = effectively off. */
  highpassHz: number;
  /** Low shelf gain (dB) at lowFreq — warmth / body. */
  lowDb: number;
  lowFreq: number;
  /** Mid peaking gain (dB) at midFreq. */
  midDb: number;
  midFreq: number;
  /** Vocal presence peaking gain (dB) around 3.2 kHz. */
  presenceDb: number;
  /** High shelf gain (dB) at 8.5 kHz. */
  highDb: number;
  /** Clarity macro 0..1 — presence lift, low-mid de-muddying and air. */
  clarity: number;
  /** Gentle compression amount 0..1. */
  compression: number;
  /** Noise reduction amount 0..1 (expander live; plus spectral NR on recordings). */
  noiseReduction: number;
  /** Echo wet level 0..1. */
  echoMix: number;
  echoDelayMs: number;
  /** Echo feedback 0..0.7 (hard-limited to prevent runaway). */
  echoFeedback: number;
  /** Echo tone: low-pass cut-off of repeats (Hz). */
  echoToneHz: number;
  /** Reverb wet level 0..1. */
  reverbMix: number;
  /** Reverb decay time RT60 (s). */
  reverbDecay: number;
  /** Room size 0..1 — early-reflection spacing and build-up. */
  roomSize: number;
  preDelayMs: number;
  /** Early-reflection level 0..1. */
  earlyReflections: number;
  /** High-frequency damping of the reverb tail 0..1. */
  damping: number;
  /** Stereo width of the reverb/echo returns 0..1.5 (1 = natural). Live monitoring caps at 1. */
  width: number;
  /** Output level (dB) before the protective limiter. */
  outputDb: number;
}

export type ParamKey = keyof VoiceParams;

export interface ParamSpec {
  key: ParamKey;
  min: number;
  max: number;
  step: number;
  unit?: 'dB' | 'Hz' | 'ms' | 's' | '%' | 'x';
}

export const PARAM_SPECS: Record<ParamKey, ParamSpec> = {
  highpassHz: { key: 'highpassHz', min: 20, max: 200, step: 1, unit: 'Hz' },
  lowDb: { key: 'lowDb', min: -6, max: 6, step: 0.5, unit: 'dB' },
  lowFreq: { key: 'lowFreq', min: 80, max: 320, step: 5, unit: 'Hz' },
  midDb: { key: 'midDb', min: -6, max: 6, step: 0.5, unit: 'dB' },
  midFreq: { key: 'midFreq', min: 200, max: 2000, step: 10, unit: 'Hz' },
  presenceDb: { key: 'presenceDb', min: -4, max: 6, step: 0.5, unit: 'dB' },
  highDb: { key: 'highDb', min: -6, max: 6, step: 0.5, unit: 'dB' },
  clarity: { key: 'clarity', min: 0, max: 1, step: 0.01, unit: '%' },
  compression: { key: 'compression', min: 0, max: 1, step: 0.01, unit: '%' },
  noiseReduction: { key: 'noiseReduction', min: 0, max: 1, step: 0.01, unit: '%' },
  echoMix: { key: 'echoMix', min: 0, max: 0.6, step: 0.01, unit: '%' },
  echoDelayMs: { key: 'echoDelayMs', min: 60, max: 800, step: 5, unit: 'ms' },
  echoFeedback: { key: 'echoFeedback', min: 0, max: 0.7, step: 0.01, unit: '%' },
  echoToneHz: { key: 'echoToneHz', min: 1500, max: 9000, step: 100, unit: 'Hz' },
  reverbMix: { key: 'reverbMix', min: 0, max: 0.7, step: 0.01, unit: '%' },
  reverbDecay: { key: 'reverbDecay', min: 0.3, max: 7, step: 0.05, unit: 's' },
  roomSize: { key: 'roomSize', min: 0, max: 1, step: 0.01, unit: '%' },
  preDelayMs: { key: 'preDelayMs', min: 0, max: 120, step: 1, unit: 'ms' },
  earlyReflections: { key: 'earlyReflections', min: 0, max: 1, step: 0.01, unit: '%' },
  damping: { key: 'damping', min: 0, max: 1, step: 0.01, unit: '%' },
  width: { key: 'width', min: 0, max: 1.5, step: 0.01, unit: 'x' },
  outputDb: { key: 'outputDb', min: -12, max: 6, step: 0.5, unit: 'dB' },
};

export function clampParams(p: VoiceParams): VoiceParams {
  const out = { ...p };
  for (const spec of Object.values(PARAM_SPECS)) {
    const v = Number(out[spec.key]);
    out[spec.key] = Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, v)) : spec.min;
  }
  return out;
}

/** Neutral settings: every stage transparent. */
export const NEUTRAL: VoiceParams = {
  highpassHz: 20,
  lowDb: 0,
  lowFreq: 160,
  midDb: 0,
  midFreq: 400,
  presenceDb: 0,
  highDb: 0,
  clarity: 0,
  compression: 0,
  noiseReduction: 0,
  echoMix: 0,
  echoDelayMs: 220,
  echoFeedback: 0.2,
  echoToneHz: 4000,
  reverbMix: 0,
  reverbDecay: 1.2,
  roomSize: 0.4,
  preDelayMs: 12,
  earlyReflections: 0.5,
  damping: 0.5,
  width: 1,
  outputDb: 0,
};
