import { create } from 'zustand';
import { audioCache } from '../audio/audioCache';
import { deleteRecording, duplicateRecording, listRecordings, patchRecording, type RecordingMeta } from '../lib/db';

interface LibraryState {
  recordings: RecordingMeta[];
  /** When a take was last saved to the library (drives the Studio's "Saved" state). */
  lastSavedAt: number;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  patch: (id: string, patch: Partial<RecordingMeta>) => Promise<RecordingMeta | undefined>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string, title: string) => Promise<RecordingMeta | undefined>;
  upsertLocal: (meta: RecordingMeta) => void;
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  recordings: [],
  lastSavedAt: 0,
  loaded: false,
  error: null,
  refresh: async () => {
    try {
      const recordings = await listRecordings();
      set({ recordings, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: String((e as Error)?.message ?? e) });
    }
  },
  patch: async (id, patch) => {
    const prev = get().recordings.find((r) => r.id === id);
    const next = await patchRecording(id, { ...patch, updatedAt: Date.now() });
    if (next) get().upsertLocal(next);
    if (next && patch.status === 'saved' && prev?.status !== 'saved') set({ lastSavedAt: Date.now() });
    return next;
  },
  remove: async (id) => {
    const meta = get().recordings.find((r) => r.id === id);
    await deleteRecording(id);
    if (meta && !get().recordings.some((r) => r.id !== id && r.audioId === meta.audioId)) audioCache.delete(meta.audioId);
    set({ recordings: get().recordings.filter((r) => r.id !== id) });
  },
  duplicate: async (id, title) => {
    const copy = await duplicateRecording(id, title);
    if (copy) get().upsertLocal(copy);
    return copy;
  },
  upsertLocal: (meta) => {
    const list = get().recordings.filter((r) => r.id !== meta.id);
    list.push(meta);
    list.sort((a, b) => b.createdAt - a.createdAt);
    set({ recordings: list });
  },
}));
