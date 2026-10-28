import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { TakeWriter } from '../../src/audio/engine';
import { createBackup, restoreBackup } from '../../src/lib/backup';
import {
  appendChunk,
  decodeChunk,
  deleteAllRecordings,
  deleteRecording,
  duplicateRecording,
  encodeChunk,
  getRecording,
  loadAudio,
  putRecording,
  type RecordingMeta,
} from '../../src/lib/db';
import { NEUTRAL } from '../../src/audio/params';
import { noise } from './signals';

const SR = 48000;

function meta(id: string, frames: number, format: 'f32' | 'i16' = 'f32'): RecordingMeta {
  const now = Date.now();
  return {
    id,
    audioId: id,
    title: `Take ${id}`,
    surah: 55,
    ayahFrom: null,
    ayahTo: null,
    createdAt: now,
    updatedAt: now,
    duration: frames / SR,
    frames,
    sampleRate: SR,
    format,
    status: 'saved',
    presetId: 'beautiful-plus',
    presetName: '',
    params: NEUTRAL,
    favorite: false,
    peaks: [],
  };
}

/** Write a take the way the recorder does: ~2 s chunks. */
async function storeTake(id: string, samples: Float32Array, format: 'f32' | 'i16' = 'f32') {
  await putRecording(meta(id, samples.length, format));
  const step = SR * 2;
  for (let s = 0, seq = 0; s < samples.length; s += step, seq++) {
    const part = samples.subarray(s, Math.min(samples.length, s + step));
    await appendChunk({ audioId: id, seq, frames: part.length, format, data: encodeChunk(part, format) });
  }
}

beforeEach(async () => {
  await deleteAllRecordings();
});

describe('16-bit storage', () => {
  it('round-trips exactly, however often it is decoded and re-encoded', () => {
    const x = noise(0.9, 0.1);
    let buf = encodeChunk(x, 'i16');
    const first = new Int16Array(buf.slice(0));
    for (let i = 0; i < 5; i++) buf = encodeChunk(decodeChunk({ audioId: '', seq: 0, frames: x.length, format: 'i16', data: buf }), 'i16');
    expect(new Int16Array(buf)).toEqual(first);
  });
});

describe('TakeWriter', () => {
  it('retries a failed chunk write so no audio is lost or duplicated', async () => {
    await putRecording({ ...meta('w1', 0), status: 'recording' });
    const errors: unknown[] = [];
    let recovered = 0;
    const w = new TakeWriter('w1', SR, 'f32', (e) => errors.push(e), () => recovered++);
    const proto = IDBObjectStore.prototype as unknown as { put: (...a: unknown[]) => IDBRequest };
    const realPut = proto.put;
    let failNext = true;
    proto.put = function (this: IDBObjectStore, ...a: unknown[]) {
      if (failNext && this.name === 'chunks') {
        failNext = false;
        throw new DOMException('Simulated quota error', 'QuotaExceededError');
      }
      return realPut.apply(this, a);
    };
    try {
      const all = noise(0.5, 5);
      for (let s = 0; s < all.length; s += 4096) w.push(all.slice(s, Math.min(all.length, s + 4096)));
      const { samples, complete } = await w.finish();
      expect(errors.length).toBe(1);
      expect(recovered).toBe(1);
      expect(complete).toBe(true);
      expect(samples).toEqual(all);
      expect(await loadAudio('w1')).toEqual(all);
      expect((await getRecording('w1'))?.frames).toBe(all.length);
    } finally {
      proto.put = realPut;
    }
  });
});

describe('backup and restore', () => {
  it('restores audio bit-exactly (float and 16-bit takes)', async () => {
    const a = noise(0.4, 3, SR, 1);
    const b = noise(0.4, 2.5, SR, 2);
    await storeTake('f', a, 'f32');
    await storeTake('i', b, 'i16');
    const bStored = await loadAudio('i');
    const zip = await createBackup([]);
    await deleteAllRecordings();
    const res = await restoreBackup(zip);
    expect(res.recordings).toBe(2);
    expect(await loadAudio('f')).toEqual(a);
    expect(await loadAudio('i')).toEqual(bStored);
  });

  it('never overwrites original audio still shared with a duplicate', async () => {
    const a = noise(0.4, 7, SR, 3);
    await storeTake('orig', a);
    const dup = await duplicateRecording('orig', 'Copy');
    const zip = await createBackup([]);
    await deleteRecording('orig'); // audio stays: the duplicate still uses it
    expect(await loadAudio(dup!.audioId)).toEqual(a);
    await restoreBackup(zip);
    expect(await getRecording('orig')).toBeTruthy();
    expect(await loadAudio('orig')).toEqual(a);
  });
});
