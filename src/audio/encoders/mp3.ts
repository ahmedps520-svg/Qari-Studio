export const MP3_SAMPLE_RATES = [32000, 44100, 48000];

export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  kbps: number,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress?.(msg.progress);
      else if (msg.type === 'done') {
        worker.terminate();
        resolve(msg.blob as Blob);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'MP3 encoder failed to start'));
    };
    worker.postMessage({ channels, sampleRate, kbps });
  });
}
