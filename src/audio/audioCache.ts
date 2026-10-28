import { loadAudio } from '../lib/db';

/** Small in-memory LRU of decoded original takes, keyed by audioId. */
class AudioCache {
  private map = new Map<string, Float32Array>();
  constructor(private max = 3) {}

  put(audioId: string, samples: Float32Array) {
    this.map.delete(audioId);
    this.map.set(audioId, samples);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  peek(audioId: string): Float32Array | undefined {
    return this.map.get(audioId);
  }

  async get(audioId: string): Promise<Float32Array> {
    const hit = this.map.get(audioId);
    if (hit) {
      this.put(audioId, hit);
      return hit;
    }
    const s = await loadAudio(audioId);
    this.put(audioId, s);
    return s;
  }

  delete(audioId: string) {
    this.map.delete(audioId);
  }

  clear() {
    this.map.clear();
  }
}

export const audioCache = new AudioCache();
