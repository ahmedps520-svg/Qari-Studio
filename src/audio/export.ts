import { audioCache } from './audioCache';
import { aacSupport, encodeM4a } from './encoders/m4a';
import { encodeMp3, MP3_SAMPLE_RATES } from './encoders/mp3';
import { encodeWav } from './encoders/wav';
import { renderEnhanced, resample } from './render';
import type { RecordingMeta } from '../lib/db';

export type ExportFormat = 'wav24' | 'wav16' | 'm4a' | 'mp3';
export type ExportVersion = 'enhanced' | 'original';

export const FORMAT_EXT: Record<ExportFormat, string> = { wav24: 'wav', wav16: 'wav', m4a: 'm4a', mp3: 'mp3' };
export const FORMAT_MIME: Record<ExportFormat, string> = {
  wav24: 'audio/wav',
  wav16: 'audio/wav',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

export interface FormatAvailability {
  format: ExportFormat;
  available: boolean;
  reason?: string;
}

export async function formatAvailability(sampleRate: number): Promise<FormatAvailability[]> {
  const aac = await aacSupport(sampleRate, 2);
  return [
    { format: 'wav24', available: true },
    { format: 'wav16', available: true },
    { format: 'm4a', available: aac.supported, reason: aac.reason },
    { format: 'mp3', available: typeof Worker !== 'undefined' },
  ];
}

export type ExportStage = 'loading' | 'rendering' | 'encoding' | 'done';

export async function exportRecording(
  meta: RecordingMeta,
  version: ExportVersion,
  format: ExportFormat,
  onProgress?: (stage: ExportStage, p: number) => void,
): Promise<Blob> {
  onProgress?.('loading', 0);
  const original = await audioCache.get(meta.audioId);
  let channels: Float32Array[];
  let rate = meta.sampleRate;

  // Lossy encoders support a limited set of sample rates; render straight to a supported one.
  const needsRate =
    format === 'mp3' ? !MP3_SAMPLE_RATES.includes(rate) : format === 'm4a' ? rate !== 44100 && rate !== 48000 : false;
  const target = needsRate ? 48000 : rate;

  if (version === 'enhanced') {
    onProgress?.('rendering', 0);
    const r = await renderEnhanced(original, meta.sampleRate, meta.params, {
      targetRate: target,
      onProgress: (p) => onProgress?.('rendering', p),
    });
    channels = r.channels;
    rate = r.sampleRate;
  } else {
    channels = [original];
    if (target !== rate) {
      onProgress?.('rendering', 0);
      channels = await resample(channels, rate, target);
      rate = target;
    }
  }

  onProgress?.('encoding', 0);
  let blob: Blob;
  switch (format) {
    case 'wav24':
      blob = encodeWav(channels, rate, 24);
      break;
    case 'wav16':
      blob = encodeWav(channels, rate, 16);
      break;
    case 'mp3':
      blob = await encodeMp3(channels, rate, channels.length > 1 ? 256 : 160, (p) => onProgress?.('encoding', p));
      break;
    case 'm4a':
      blob = await encodeM4a(channels, rate, channels.length > 1 ? 256000 : 160000, (p) => onProgress?.('encoding', p));
      break;
  }
  onProgress?.('done', 1);
  return blob;
}

/** Hand a file to the user: Save dialog where supported, otherwise a normal download. */
export async function saveBlob(blob: Blob, filename: string, method: 'download' | 'picker' | 'share'): Promise<'saved' | 'cancelled'> {
  if (method === 'share') {
    const file = new File([blob], filename, { type: blob.type });
    await navigator.share({ files: [file], title: filename });
    return 'saved';
  }
  if (method === 'picker') {
    const w = window as Window & {
      showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
    };
    try {
      const ext = filename.split('.').pop() ?? '';
      const handle = await w.showSaveFilePicker!({
        suggestedName: filename,
        types: [{ description: 'Audio', accept: { [blob.type || 'application/octet-stream']: [`.${ext}`] } }],
      });
      const ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      return 'saved';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'saved';
}

export const canSharePicker = () => typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

export function canShareFiles(blobType = 'audio/wav'): boolean {
  try {
    const f = new File([new Uint8Array(1)], 'a.wav', { type: blobType });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}
