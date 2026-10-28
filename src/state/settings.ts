import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LatencyMode } from '../audio/engine';
import type { ExportFormat } from '../audio/export';
import { DEFAULT_PRESET_ID } from '../audio/presets';
import type { SampleFormat } from '../lib/db';

export type ThemeChoice = 'midnight' | 'ivory' | 'system';
export type Language = 'en' | 'ar';

export interface Selection {
  surah: number | null;
  from: number | null;
  to: number | null;
}

export interface SettingsState {
  theme: ThemeChoice;
  language: Language;
  name: string;
  defaultPresetId: string;
  exportFormat: ExportFormat;
  recordingFormat: SampleFormat;
  inputDeviceId: string | null;
  outputDeviceId: string;
  latencyMode: LatencyMode;
  browserNoiseSuppression: boolean;
  inputGainDb: number;
  monitorVolume: number;
  /** Last studio selection (surah + optional ayah range); surah null = free recitation. */
  selection: Selection;
  lastSurahVisited: number | null;
  reading: { surah: number; ayah: number } | null;
  readingScale: number;
  showTextInStudio: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

const initialLanguage = (): Language => {
  try {
    return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  } catch {
    return 'en';
  }
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'midnight',
      language: initialLanguage(),
      name: '',
      defaultPresetId: DEFAULT_PRESET_ID,
      exportFormat: 'wav24',
      recordingFormat: 'f32',
      inputDeviceId: null,
      outputDeviceId: '',
      latencyMode: 'interactive',
      browserNoiseSuppression: false,
      inputGainDb: 0,
      monitorVolume: 0.85,
      selection: { surah: null, from: null, to: null },
      lastSurahVisited: null,
      reading: null,
      readingScale: 1,
      showTextInStudio: true,
      set: (patch) => set(patch),
    }),
    { name: 'qari-settings', version: 1 },
  ),
);
