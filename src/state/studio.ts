import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampParams, type ParamKey, type VoiceParams } from '../audio/params';
import { BUILT_IN_PRESETS, DEFAULT_PRESET_ID, paramsEqual } from '../audio/presets';
import { findPreset } from './presets';

/** Working sound for the Studio: the chosen preset plus any adjustments made on top of it. */
interface StudioSound {
  presetId: string;
  params: VoiceParams;
  selectPreset: (id: string) => void;
  setParam: (key: ParamKey, value: number) => void;
  setParams: (p: VoiceParams) => void;
  reset: () => void;
}

const defaultParams = BUILT_IN_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.params;

export const useStudio = create<StudioSound>()(
  persist(
    (set, get) => ({
      presetId: DEFAULT_PRESET_ID,
      params: defaultParams,
      selectPreset: (id) => {
        const p = findPreset(id);
        if (p) set({ presetId: id, params: { ...p.params } });
      },
      setParam: (key, value) => set({ params: clampParams({ ...get().params, [key]: value }) }),
      setParams: (p) => set({ params: clampParams(p) }),
      reset: () => {
        const p = findPreset(get().presetId);
        if (p) set({ params: { ...p.params } });
      },
    }),
    {
      name: 'qari-studio-sound',
      version: 1,
      merge: (persisted, current) => {
        const p = persisted as Partial<StudioSound> | undefined;
        const preset = p?.presetId ? findPreset(p.presetId) : undefined;
        if (!p || !preset) return current;
        return { ...current, presetId: p.presetId!, params: clampParams({ ...preset.params, ...(p.params ?? {}) }) };
      },
    },
  ),
);

export function isModified(presetId: string, params: VoiceParams): boolean {
  const p = findPreset(presetId);
  return p ? !paramsEqual(p.params, params) : false;
}
