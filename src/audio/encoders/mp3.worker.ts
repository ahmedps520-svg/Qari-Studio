/// <reference lib="webworker" />
import { Mp3Encoder } from '@breezystack/lamejs';

interface Job {
  channels: Float32Array[];
  sampleRate: number;
  kbps: number;
}

function toInt16(x: Float32Array, start: number, n: number): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, x[start + i] || 0));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

self.onmessage = (e: MessageEvent<Job>) => {
  try {
    const { channels, sampleRate, kbps } = e.data;
    const numCh = Math.min(2, channels.length);
    const enc = new Mp3Encoder(numCh, sampleRate, kbps);
    const frames = channels[0].length;
    const block = 1152 * 8;
    const parts: Uint8Array[] = [];
    let lastReport = 0;
    for (let i = 0; i < frames; i += block) {
      const n = Math.min(block, frames - i);
      const l = toInt16(channels[0], i, n);
      const out = numCh === 2 ? enc.encodeBuffer(l, toInt16(channels[1], i, n)) : enc.encodeBuffer(l);
      if (out.length > 0) parts.push(new Uint8Array(out));
      const p = i / frames;
      if (p - lastReport > 0.02) {
        lastReport = p;
        self.postMessage({ type: 'progress', progress: p });
      }
    }
    const end = enc.flush();
    if (end.length > 0) parts.push(new Uint8Array(end));
    const blob = new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
    self.postMessage({ type: 'done', blob });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
