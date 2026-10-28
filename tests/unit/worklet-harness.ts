import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

/**
 * Loads the real AudioWorklet file (public/worklets/qari-processors.js) into a sandbox with a
 * minimal AudioWorkletGlobalScope, so the exact code that runs on the audio thread is tested.
 */
export interface Port {
  posted: { data: unknown }[];
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage: (data: unknown) => void;
  send: (data: unknown) => void;
}

export interface Proc {
  port: Port;
  process: (inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) => boolean;
  [k: string]: unknown;
}

export function loadProcessors(sampleRate = 48000) {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../../public/worklets/qari-processors.js'), 'utf8');
  const registry: Record<string, new (o?: unknown) => Proc> = {};
  class AudioWorkletProcessor {
    port: Port;
    constructor() {
      const port: Port = {
        posted: [],
        onmessage: null,
        postMessage(data) {
          port.posted.push({ data });
        },
        send(data) {
          port.onmessage?.({ data });
        },
      };
      this.port = port;
    }
  }
  const ctx = vm.createContext({
    AudioWorkletProcessor,
    registerProcessor: (name: string, cls: new (o?: unknown) => Proc) => (registry[name] = cls),
    sampleRate,
    currentTime: 0,
    Math,
    Float32Array,
    Float64Array,
    Uint32Array,
  });
  vm.runInContext(src, ctx);
  return {
    create(name: string, processorOptions: Record<string, unknown> = {}) {
      return new registry[name]({ processorOptions });
    },
  };
}

/** Run a mono (or stereo) signal through a processor in 128-frame quanta. */
export function run(
  proc: Proc,
  input: Float32Array[],
  params: Record<string, number> = {},
  outChannels = input.length,
): Float32Array[] {
  const n = input[0].length;
  const out = Array.from({ length: outChannels }, () => new Float32Array(n));
  const p: Record<string, Float32Array> = {};
  for (const [k, v] of Object.entries(params)) p[k] = new Float32Array([v]);
  for (let s = 0; s < n; s += 128) {
    const len = Math.min(128, n - s);
    const ins = input.map((c) => {
      const b = new Float32Array(128);
      b.set(c.subarray(s, s + len));
      return b;
    });
    const outs = Array.from({ length: outChannels }, () => new Float32Array(128));
    proc.process([ins], [outs], p);
    outs.forEach((o, i) => out[i].set(o.subarray(0, len), s));
  }
  return out;
}
