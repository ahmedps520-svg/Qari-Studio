import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { VoiceParams } from '../audio/params';

/**
 * Local, private storage for recordings (IndexedDB, in this browser profile only).
 *
 * Audio is stored as the ORIGINAL, unprocessed take, split into small chunks that are written
 * continuously while recording — so a crash, closed tab or dead battery loses at most ~2 s.
 * Enhancements are stored as parameters and applied non-destructively at playback/export.
 */
export type SampleFormat = 'f32' | 'i16';
export type RecordingStatus = 'recording' | 'draft' | 'saved';

export interface RecordingMeta {
  id: string;
  /** Audio chunks are keyed by audioId so duplicates can share the same original audio. */
  audioId: string;
  title: string;
  surah: number | null;
  ayahFrom: number | null;
  ayahTo: number | null;
  createdAt: number;
  updatedAt: number;
  duration: number;
  frames: number;
  sampleRate: number;
  format: SampleFormat;
  status: RecordingStatus;
  presetId: string;
  /** Name snapshot for custom presets (built-in names are translated at display time). */
  presetName: string;
  params: VoiceParams;
  favorite: boolean;
  peaks: number[];
  inputLabel?: string;
  exportName?: string;
  lastExport?: { format: string; at: number; version: 'enhanced' | 'original' };
  duplicateOf?: string;
  /** Part of the audio could not be written to storage when the take was stopped. */
  incomplete?: boolean;
}

export interface ChunkRecord {
  audioId: string;
  seq: number;
  frames: number;
  format: SampleFormat;
  data: ArrayBuffer;
}

interface QariDB extends DBSchema {
  recordings: {
    key: string;
    value: RecordingMeta;
    indexes: { createdAt: number; status: RecordingStatus; audioId: string };
  };
  chunks: {
    key: [string, number];
    value: ChunkRecord;
    indexes: { audioId: string };
  };
}

let dbp: Promise<IDBPDatabase<QariDB>> | null = null;

export function db(): Promise<IDBPDatabase<QariDB>> {
  if (!dbp) {
    dbp = openDB<QariDB>('qari-studio', 1, {
      upgrade(d) {
        const r = d.createObjectStore('recordings', { keyPath: 'id' });
        r.createIndex('createdAt', 'createdAt');
        r.createIndex('status', 'status');
        r.createIndex('audioId', 'audioId');
        const c = d.createObjectStore('chunks', { keyPath: ['audioId', 'seq'] });
        c.createIndex('audioId', 'audioId');
      },
      blocked() {
        /* another tab holds an older version; it will close on versionchange */
      },
      blocking() {
        dbp?.then((x) => x.close());
        dbp = null;
      },
      terminated() {
        // The browser closed the connection (e.g. Safari's IndexedDB server restarting): reopen.
        dbp = null;
      },
    });
    dbp.catch(() => {
      dbp = null;
    });
  }
  return dbp;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function putRecording(meta: RecordingMeta): Promise<void> {
  await (await db()).put('recordings', meta);
}

export async function getRecording(id: string): Promise<RecordingMeta | undefined> {
  return (await db()).get('recordings', id);
}

export async function patchRecording(id: string, patch: Partial<RecordingMeta>): Promise<RecordingMeta | undefined> {
  const d = await db();
  const tx = d.transaction('recordings', 'readwrite');
  const cur = await tx.store.get(id);
  if (!cur) {
    await tx.done;
    return undefined;
  }
  const next = { ...cur, ...patch, id };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const all = await (await db()).getAll('recordings');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function encodeChunk(samples: Float32Array, format: SampleFormat): ArrayBuffer {
  if (format === 'f32') return samples.slice().buffer as ArrayBuffer;
  // Symmetric scaling (×32768, clamped) so decode → encode round-trips exactly.
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768)));
  return out.buffer;
}

export function decodeChunk(c: ChunkRecord): Float32Array {
  if (c.format === 'f32') return new Float32Array(c.data);
  const src = new Int16Array(c.data);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 32768;
  return out;
}

export async function appendChunk(rec: ChunkRecord): Promise<void> {
  await (await db()).put('chunks', rec);
}

/** Load the original audio of a recording (all chunks, in order). */
export async function loadAudio(audioId: string): Promise<Float32Array> {
  const d = await db();
  const range = IDBKeyRange.bound([audioId, 0], [audioId, Number.MAX_SAFE_INTEGER]);
  const chunks = await d.getAll('chunks', range);
  chunks.sort((a, b) => a.seq - b.seq);
  let total = 0;
  for (const c of chunks) total += c.frames;
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    const s = decodeChunk(c);
    out.set(s.subarray(0, c.frames), o);
    o += c.frames;
  }
  return out;
}

export async function hasAudio(audioId: string): Promise<boolean> {
  return (await (await db()).countFromIndex('chunks', 'audioId', audioId)) > 0;
}

export async function audioFrames(audioId: string): Promise<number> {
  const d = await db();
  const range = IDBKeyRange.bound([audioId, 0], [audioId, Number.MAX_SAFE_INTEGER]);
  const chunks = await d.getAll('chunks', range);
  return chunks.reduce((a, c) => a + c.frames, 0);
}

/** Delete a recording; its audio is removed once no other recording references it. */
export async function deleteRecording(id: string): Promise<void> {
  const d = await db();
  const meta = await d.get('recordings', id);
  if (!meta) return;
  const tx = d.transaction(['recordings', 'chunks'], 'readwrite');
  await tx.objectStore('recordings').delete(id);
  const others = await tx.objectStore('recordings').index('audioId').getAllKeys(meta.audioId);
  if (others.filter((k) => k !== id).length === 0) {
    const range = IDBKeyRange.bound([meta.audioId, 0], [meta.audioId, Number.MAX_SAFE_INTEGER]);
    await tx.objectStore('chunks').delete(range);
  }
  await tx.done;
}

/** Duplicate shares the original audio (originals are immutable) — no extra storage. */
export async function duplicateRecording(id: string, title: string): Promise<RecordingMeta | undefined> {
  const meta = await getRecording(id);
  if (!meta) return undefined;
  const now = Date.now();
  const copy: RecordingMeta = {
    ...meta,
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    duplicateOf: meta.id,
    status: meta.status === 'saved' ? 'saved' : meta.status,
    lastExport: undefined,
  };
  await putRecording(copy);
  return copy;
}

export async function deleteAllRecordings(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['recordings', 'chunks'], 'readwrite');
  await tx.objectStore('recordings').clear();
  await tx.objectStore('chunks').clear();
  await tx.done;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

export async function persistStatus(): Promise<'persisted' | 'best-effort' | 'unsupported'> {
  try {
    if (!navigator.storage?.persisted) return 'unsupported';
    return (await navigator.storage.persisted()) ? 'persisted' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
