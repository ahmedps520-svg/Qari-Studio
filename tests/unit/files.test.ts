import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../../src/audio/encoders/wav';
import { defaultExportBase, sanitizeFilename, slug } from '../../src/lib/filename';
import { sine } from './signals';

const day = new Date(2026, 9, 28, 21, 5).getTime();

describe('default file names', () => {
  it('follows the documented pattern', () => {
    expect(defaultExportBase({ surahName: 'Ar-Rahman', presetName: null, createdAt: day })).toBe('Quran_Ar-Rahman_2026-10-28');
    expect(defaultExportBase({ surahName: 'Al-Mulk', presetName: 'Beautiful+', createdAt: day })).toBe('Quran_Al-Mulk_Beautiful-Plus_2026-10-28');
    expect(defaultExportBase({ surahName: null, presetName: 'Grand Mosque', createdAt: day })).toBe('Quran_Recitation_Grand-Mosque_2026-10-28');
  });
  it('adds a range only when it is not the whole surah', () => {
    expect(defaultExportBase({ surahName: 'Al-Mulk', presetName: null, createdAt: day, ayahFrom: 1, ayahTo: 30, ayahCount: 30 })).toBe('Quran_Al-Mulk_2026-10-28');
    expect(defaultExportBase({ surahName: 'Al-Mulk', presetName: null, createdAt: day, ayahFrom: 1, ayahTo: 10, ayahCount: 30 })).toBe('Quran_Al-Mulk_Ayah-1-10_2026-10-28');
  });
  it('cleans names', () => {
    expect(slug("Ali 'Imran")).toBe('Ali-Imran');
    expect(slug('Warm & Deep')).toBe('Warm-and-Deep');
    expect(sanitizeFilename('a/b:c*?"<>|.wav')).toBe('a-b-c------.wav');
    expect(sanitizeFilename('   ')).toBe('Quran_Recitation');
  });
});

describe('WAV encoder', () => {
  it('round-trips 16/24-bit integer and 32-bit float stereo', async () => {
    const x = sine(440, 0.5, 0.25);
    const y = sine(660, 0.25, 0.25);
    for (const bits of [16, 24, 32] as const) {
      const blob = encodeWav([x, y], 48000, bits);
      await blob.arrayBuffer().then((buf) => {
        const d = decodeWav(buf);
        expect(d.sampleRate).toBe(48000);
        expect(d.channels).toHaveLength(2);
        expect(d.bitDepth).toBe(bits);
        const tol = bits === 16 ? 2 / 32768 : bits === 24 ? 2 / 8388608 : 1e-7;
        let err = 0;
        for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(d.channels[0][i] - x[i]), Math.abs(d.channels[1][i] - y[i]));
        expect(err).toBeLessThan(tol);
      });
    }
  });

  it('writes a correct header', async () => {
    const buf = await encodeWav([sine(100, 0.1, 1, 44100)], 44100, 16).arrayBuffer();
    const v = new DataView(buf);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(44100 * 2);
    expect(buf.byteLength).toBe(44 + 44100 * 2);
  });
});
