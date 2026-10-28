import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

const AAC = 'mp4a.40.2';

export interface AacSupport {
  supported: boolean;
  reason?: string;
}

/** Whether this browser can encode AAC through WebCodecs (no fallback is faked). */
export async function aacSupport(sampleRate: number, numberOfChannels: number, bitrate = 192000): Promise<AacSupport> {
  if (typeof AudioEncoder === 'undefined') return { supported: false, reason: 'webcodecs' };
  const rate = sampleRate === 44100 || sampleRate === 48000 ? sampleRate : 48000;
  try {
    const r = await AudioEncoder.isConfigSupported({ codec: AAC, sampleRate: rate, numberOfChannels, bitrate });
    return r.supported ? { supported: true } : { supported: false, reason: 'codec' };
  } catch {
    return { supported: false, reason: 'codec' };
  }
}

/** Encode planar float PCM to AAC in an MP4 (.m4a) container. Sample rate must be 44.1 or 48 kHz. */
export async function encodeM4a(
  channels: Float32Array[],
  sampleRate: number,
  bitrate: number,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const numberOfChannels = channels.length;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    audio: { codec: 'aac', numberOfChannels, sampleRate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let error: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      error = e;
    },
  });
  encoder.configure({ codec: AAC, sampleRate, numberOfChannels, bitrate });
  const frames = channels[0].length;
  const block = 1024 * 16;
  for (let start = 0; start < frames; start += block) {
    if (error) break;
    const n = Math.min(block, frames - start);
    const data = new Float32Array(n * numberOfChannels);
    for (let c = 0; c < numberOfChannels; c++) data.set(channels[c].subarray(start, start + n), c * n);
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels,
      timestamp: Math.round((start / sampleRate) * 1e6),
      data,
    });
    encoder.encode(audioData);
    audioData.close();
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    onProgress?.(start / frames);
  }
  await encoder.flush();
  encoder.close();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'audio/mp4' });
}
