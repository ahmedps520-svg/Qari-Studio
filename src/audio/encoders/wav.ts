export type WavBitDepth = 16 | 24 | 32;

/**
 * Encode PCM channels as a RIFF/WAVE file. 16/24-bit integer PCM (with TPDF dither for 16-bit)
 * or 32-bit IEEE float. Produced as a Blob assembled from parts so long recordings never need
 * one giant contiguous buffer.
 */
export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  bitDepth: WavBitDepth = 24,
  opts: { dither?: boolean } = {},
): Blob {
  const dither = opts.dither ?? true;
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numCh * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const isFloat = bitDepth === 32;

  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, isFloat ? 3 : 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitDepth, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);

  const parts: BlobPart[] = [header];
  const framesPerPart = 65536;
  let seed = 0x2545f491;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let start = 0; start < frames; start += framesPerPart) {
    const n = Math.min(framesPerPart, frames - start);
    const buf = new ArrayBuffer(n * blockAlign);
    const dv = new DataView(buf);
    let o = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = channels[c][start + i];
        if (!Number.isFinite(s)) s = 0;
        if (isFloat) {
          dv.setFloat32(o, s, true);
        } else if (bitDepth === 16) {
          // TPDF dither (±1 LSB) unless the source is already 16-bit (lossless backups).
          const d = dither ? (rand() - rand()) / 32768 : 0;
          dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round((s + d) * 32768))), true);
        } else {
          const iv = Math.max(-8388608, Math.min(8388607, Math.round(s * 8388608)));
          dv.setUint8(o, iv & 0xff);
          dv.setUint8(o + 1, (iv >> 8) & 0xff);
          dv.setUint8(o + 2, (iv >> 16) & 0xff);
        }
        o += bytesPerSample;
      }
    }
    parts.push(buf);
  }
  return new Blob(parts, { type: 'audio/wav' });
}

export interface DecodedWav {
  sampleRate: number;
  channels: Float32Array[];
  bitDepth: number;
}

/** Minimal WAV parser (PCM 16/24/32 and float 32), used for backup import. */
export function decodeWav(buf: ArrayBuffer): DecodedWav {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let o = 12;
  let fmt = 0;
  let numCh = 0;
  let sampleRate = 0;
  let bits = 0;
  while (o + 8 <= v.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = v.getUint16(body, true);
      numCh = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
      if (fmt === 0xfffe) fmt = v.getUint16(body + 24, true);
    } else if (id === 'data') {
      const bps = bits / 8;
      const frames = Math.floor(Math.min(size, v.byteLength - body) / (bps * numCh));
      const channels = Array.from({ length: numCh }, () => new Float32Array(frames));
      let p = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < numCh; c++) {
          let s: number;
          if (fmt === 3 && bits === 32) s = v.getFloat32(p, true);
          else if (bits === 16) s = v.getInt16(p, true) / 32768;
          else if (bits === 24) {
            let iv = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16);
            if (iv & 0x800000) iv |= ~0xffffff;
            s = iv / 8388608;
          } else if (bits === 32) s = v.getInt32(p, true) / 2147483648;
          else throw new Error(`Unsupported WAV bit depth ${bits}`);
          channels[c][i] = s;
          p += bps;
        }
      }
      return { sampleRate, channels, bitDepth: bits };
    }
    o = body + size + (size % 2);
  }
  throw new Error('WAV data chunk not found');
}
