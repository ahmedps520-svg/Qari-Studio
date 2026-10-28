import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampParams, type VoiceParams } from '../audio/params';
import { BUILT_IN_PRESETS, findBuiltIn, type Preset } from '../audio/presets';
import { newId } from '../lib/db';

interface PresetState {
  custom: Preset[];
  create: (name: string, params: VoiceParams) => Preset;
  update: (id: string, patch: { name?: string; params?: VoiceParams }) => void;
  duplicate: (id: string, name: string) => Preset | null;
  remove: (id: string) => void;
  importMany: (presets: Preset[]) => void;
}

export const usePresets = create<PresetState>()(
  persist(
    (set, get) => ({
      custom: [],
      create: (name, params) => {
        const now = Date.now();
        const p: Preset = { id: `custom-${newId()}`, name, builtIn: false, icon: 'custom', params: clampParams(params), createdAt: now, updatedAt: now };
        set({ custom: [...get().custom, p] });
        return p;
      },
      update: (id, patch) =>
        set({
          custom: get().custom.map((p) =>
            p.id === id ? { ...p, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.params ? { params: clampParams(patch.params) } : {}), updatedAt: Date.now() } : p,
          ),
        }),
      duplicate: (id, name) => {
        const src = findPreset(id, get().custom);
        if (!src) return null;
        return get().create(name, src.params);
      },
      remove: (id) => set({ custom: get().custom.filter((p) => p.id !== id) }),
      importMany: (presets) => {
        const existing = new Set(get().custom.map((p) => p.id));
        set({ custom: [...get().custom, ...presets.filter((p) => !existing.has(p.id) && !p.builtIn)] });
      },
    }),
    { name: 'qari-presets', version: 1 },
  ),
);

export function findPreset(id: string, custom: Preset[] = usePresets.getState().custom): Preset | undefined {
  return findBuiltIn(id) ?? custom.find((p) => p.id === id);
}

export function allPresets(custom: Preset[]): Preset[] {
  return [...BUILT_IN_PRESETS, ...custom];
}
