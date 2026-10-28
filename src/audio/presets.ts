import { NEUTRAL, type VoiceParams } from './params';

export type BuiltInPresetId =
  | 'plain-vanilla'
  | 'soft-echo'
  | 'beautiful-plus'
  | 'grand-mosque'
  | 'studio-qari'
  | 'warm-deep'
  | 'pure-voice'
  | 'cinematic-space';

export interface Preset {
  id: string;
  /** Display name for built-ins comes from i18n (`preset.<id>.name`); custom presets carry their own. */
  name?: string;
  builtIn: boolean;
  icon: PresetIcon;
  params: VoiceParams;
  createdAt?: number;
  updatedAt?: number;
}

export type PresetIcon =
  | 'vanilla'
  | 'echo'
  | 'sparkle'
  | 'dome'
  | 'studio'
  | 'warm'
  | 'feather'
  | 'space'
  | 'custom';

const p = (over: Partial<VoiceParams>): VoiceParams => ({ ...NEUTRAL, ...over });

export const BUILT_IN_PRESETS: Preset[] = [
  {
    // Reference: the voice as captured. Only the protective limiter remains.
    id: 'plain-vanilla',
    builtIn: true,
    icon: 'vanilla',
    params: p({}),
  },
  {
    // Close and intimate: a short, gentle echo with a hint of small-room ambience.
    id: 'soft-echo',
    builtIn: true,
    icon: 'echo',
    params: p({
      highpassHz: 70,
      clarity: 0.2,
      compression: 0.15,
      echoMix: 0.16,
      echoDelayMs: 170,
      echoFeedback: 0.2,
      echoToneHz: 4500,
      reverbMix: 0.1,
      reverbDecay: 0.8,
      roomSize: 0.25,
      preDelayMs: 8,
      earlyReflections: 0.5,
      damping: 0.55,
      width: 0.7,
    }),
  },
  {
    // The signature sound: warm, clear, a smooth spacious room with a subtle echo.
    id: 'beautiful-plus',
    builtIn: true,
    icon: 'sparkle',
    params: p({
      highpassHz: 75,
      lowDb: 1,
      lowFreq: 180,
      midDb: -1.5,
      midFreq: 360,
      presenceDb: 0.5,
      highDb: 1,
      clarity: 0.45,
      compression: 0.35,
      noiseReduction: 0.2,
      echoMix: 0.1,
      echoDelayMs: 260,
      echoFeedback: 0.24,
      echoToneHz: 3800,
      reverbMix: 0.3,
      reverbDecay: 2.4,
      roomSize: 0.55,
      preDelayMs: 26,
      earlyReflections: 0.55,
      damping: 0.45,
      width: 1,
    }),
  },
  {
    // A large prayer hall: long, smooth decay with distant early reflections. The wet level is
    // kept below the voice so words stay intelligible.
    id: 'grand-mosque',
    builtIn: true,
    icon: 'dome',
    params: p({
      highpassHz: 80,
      lowDb: 0.5,
      lowFreq: 170,
      midDb: -1,
      midFreq: 420,
      highDb: 0.5,
      clarity: 0.4,
      compression: 0.3,
      noiseReduction: 0.2,
      echoMix: 0.07,
      echoDelayMs: 340,
      echoFeedback: 0.18,
      echoToneHz: 3000,
      reverbMix: 0.42,
      reverbDecay: 4.8,
      roomSize: 0.92,
      preDelayMs: 42,
      earlyReflections: 0.7,
      damping: 0.55,
      width: 1.2,
    }),
  },
  {
    // Polished and professional: controlled dynamics, gentle EQ, low noise, very light room.
    id: 'studio-qari',
    builtIn: true,
    icon: 'studio',
    params: p({
      highpassHz: 85,
      midDb: -2,
      midFreq: 300,
      presenceDb: 1.5,
      highDb: 1.5,
      clarity: 0.5,
      compression: 0.6,
      noiseReduction: 0.45,
      reverbMix: 0.08,
      reverbDecay: 0.7,
      roomSize: 0.2,
      preDelayMs: 8,
      earlyReflections: 0.35,
      damping: 0.6,
      width: 0.7,
    }),
  },
  {
    // Fuller and warmer without lowering pitch: low-mid body, controlled bass, smooth highs.
    id: 'warm-deep',
    builtIn: true,
    icon: 'warm',
    params: p({
      highpassHz: 65,
      lowDb: 3,
      lowFreq: 170,
      midDb: 1,
      midFreq: 260,
      presenceDb: -0.5,
      highDb: -2,
      clarity: 0.15,
      compression: 0.35,
      noiseReduction: 0.15,
      echoMix: 0.05,
      echoDelayMs: 220,
      echoFeedback: 0.15,
      echoToneHz: 3200,
      reverbMix: 0.16,
      reverbDecay: 1.4,
      roomSize: 0.4,
      preDelayMs: 16,
      earlyReflections: 0.5,
      damping: 0.72,
      width: 0.8,
    }),
  },
  {
    // The reciter's natural character: rumble filter and gentle noise reduction only.
    id: 'pure-voice',
    builtIn: true,
    icon: 'feather',
    params: p({
      highpassHz: 70,
      compression: 0.1,
      noiseReduction: 0.3,
    }),
  },
  {
    // Wide and immersive, with a clear centred voice. Widening applies to recorded playback;
    // live monitoring is capped at natural width.
    id: 'cinematic-space',
    builtIn: true,
    icon: 'space',
    params: p({
      highpassHz: 80,
      midDb: -1,
      midFreq: 400,
      highDb: 1,
      clarity: 0.4,
      compression: 0.35,
      noiseReduction: 0.2,
      echoMix: 0.12,
      echoDelayMs: 420,
      echoFeedback: 0.3,
      echoToneHz: 3200,
      reverbMix: 0.36,
      reverbDecay: 3.6,
      roomSize: 0.85,
      preDelayMs: 58,
      earlyReflections: 0.4,
      damping: 0.4,
      width: 1.45,
    }),
  },
];

export const DEFAULT_PRESET_ID: BuiltInPresetId = 'beautiful-plus';

export function findBuiltIn(id: string): Preset | undefined {
  return BUILT_IN_PRESETS.find((x) => x.id === id);
}

export function paramsEqual(a: VoiceParams, b: VoiceParams): boolean {
  return (Object.keys(a) as (keyof VoiceParams)[]).every((k) => Math.abs(a[k] - b[k]) < 1e-6);
}
