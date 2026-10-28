import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate';
import { decodeWav, encodeWav } from '../audio/encoders/wav';
import type { Preset } from '../audio/presets';
import { appendChunk, encodeChunk, getRecording, listRecordings, loadAudio, putRecording, type RecordingMeta } from './db';

const MANIFEST = 'qari-studio-backup.json';

interface Manifest {
  format: 'qari-studio-backup';
  version: 1;
  exportedAt: string;
  app: string;
  recordings: RecordingMeta[];
  customPresets: Preset[];
}

/** One .zip with every original recording (lossless WAV) plus metadata and custom presets. */
export async function createBackup(customPresets: Preset[], onProgress?: (p: number) => void): Promise<Blob> {
  const recordings = (await listRecordings()).filter((r) => r.status !== 'recording');
  const audioIds = [...new Set(recordings.map((r) => r.audioId))];
  const files: Zippable = {};
  for (const [i, id] of audioIds.entries()) {
    const meta = recordings.find((r) => r.audioId === id)!;
    const samples = await loadAudio(id);
    const wav = encodeWav([samples], meta.sampleRate, meta.format === 'f32' ? 32 : 16);
    files[`audio/${id}.wav`] = [new Uint8Array(await wav.arrayBuffer()), { level: 0 }];
    onProgress?.((i + 1) / (audioIds.length + 1));
  }
  const manifest: Manifest = {
    format: 'qari-studio-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    app: __APP_VERSION__,
    recordings,
    customPresets,
  };
  files[MANIFEST] = strToU8(JSON.stringify(manifest, null, 1));
  const data = await new Promise<Uint8Array>((resolve, reject) => zip(files, (err, out) => (err ? reject(err) : resolve(out))));
  onProgress?.(1);
  return new Blob([data as BlobPart], { type: 'application/zip' });
}

export class InvalidBackupError extends Error {}

export async function restoreBackup(file: Blob, onProgress?: (p: number) => void): Promise<{ recordings: number; presets: Preset[] }> {
  const u8 = new Uint8Array(await file.arrayBuffer());
  let files: Unzipped;
  try {
    files = await new Promise<Unzipped>((resolve, reject) => unzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
  } catch {
    throw new InvalidBackupError('zip');
  }
  if (!files[MANIFEST]) throw new InvalidBackupError('manifest');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(files[MANIFEST]));
  } catch {
    throw new InvalidBackupError('json');
  }
  if (manifest.format !== 'qari-studio-backup' || !Array.isArray(manifest.recordings)) throw new InvalidBackupError('format');

  const written = new Set<string>();
  let restored = 0;
  for (const [i, meta] of manifest.recordings.entries()) {
    if (await getRecording(meta.id)) continue;
    if (!written.has(meta.audioId)) {
      const wav = files[`audio/${meta.audioId}.wav`];
      if (!wav) continue;
      const dec = decodeWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer);
      const samples = dec.channels[0];
      const chunk = dec.sampleRate * 10;
      for (let s = 0, seq = 0; s < samples.length; s += chunk, seq++) {
        const part = samples.subarray(s, Math.min(samples.length, s + chunk));
        await appendChunk({ audioId: meta.audioId, seq, frames: part.length, format: meta.format, data: encodeChunk(part, meta.format) });
      }
      written.add(meta.audioId);
    }
    await putRecording({ ...meta, status: meta.status === 'recording' ? 'draft' : meta.status });
    restored++;
    onProgress?.((i + 1) / manifest.recordings.length);
  }
  return { recordings: restored, presets: Array.isArray(manifest.customPresets) ? manifest.customPresets : [] };
}
