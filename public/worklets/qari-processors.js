/*
 * Qari Studio — AudioWorklet processors.
 *
 * These run on the real-time audio rendering thread. They must never allocate in the hot
 * path, never block, and always keep latency fixed and known.
 *
 *   qari-recorder  — captures the (mono-summed) microphone signal sample-accurately and posts
 *                    it to the main thread in small chunks. Frame counts drive the recording
 *                    timer, so the timer reflects audio actually captured.
 *   qari-dynamics  — adaptive downward expander (gentle noise gate) followed by a soft-knee
 *                    RMS compressor. Zero latency; safe for live monitoring.
 *   qari-denoise   — STFT spectral noise reduction driven by a noise profile measured from the
 *                    recording itself. Used for recordings only (it adds ~16 ms latency).
 *   qari-limiter   — look-ahead brickwall peak limiter (1.5 ms) with an optional feedback guard
 *                    that reports sustained heavy limiting (a typical sign of acoustic feedback).
 */

const LN10_20 = Math.LN10 / 20;
const dbToLin = (db) => Math.exp(db * LN10_20);
const linToDb = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -240);

/* ------------------------------------------------------------------------------------------ */
/* Recorder                                                                                   */
/* ------------------------------------------------------------------------------------------ */

class QariRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.chunkSize = o.chunkSize || 4096;
    this.buffer = new Float32Array(this.chunkSize);
    this.fill = 0;
    this.frames = 0;
    this.recording = false;
    this.peak = 0;
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      switch (msg.type) {
        case 'start':
          this.frames = 0;
          this.fill = 0;
          this.recording = true;
          break;
        case 'pause':
          this.flush();
          this.recording = false;
          this.port.postMessage({ type: 'paused', frames: this.frames, time: currentTime });
          break;
        case 'resume':
          this.recording = true;
          break;
        case 'stop':
          this.flush();
          this.recording = false;
          this.port.postMessage({ type: 'stopped', frames: this.frames, time: currentTime });
          break;
      }
    };
  }

  flush() {
    if (this.fill === 0) return;
    const out = this.buffer.slice(0, this.fill);
    this.fill = 0;
    this.port.postMessage({ type: 'data', samples: out, frames: this.frames, time: currentTime }, [out.buffer]);
  }

  process(inputs) {
    if (!this.recording) return true;
    const input = inputs[0];
    // No connected input (e.g. the microphone was disconnected): nothing is captured and the
    // timer does not advance.
    if (!input || input.length === 0) return true;
    const c0 = input[0];
    const c1 = input.length > 1 ? input[1] : null;
    const n = c0.length;
    for (let i = 0; i < n; i++) {
      this.buffer[this.fill++] = c1 ? (c0[i] + c1[i]) * 0.5 : c0[i];
      if (this.fill === this.chunkSize) {
        const out = this.buffer;
        this.buffer = new Float32Array(this.chunkSize);
        this.fill = 0;
        this.port.postMessage(
          { type: 'data', samples: out, frames: this.frames + i + 1, time: currentTime },
          [out.buffer],
        );
      }
    }
    this.frames += n;
    return true;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Dynamics: adaptive expander + soft-knee compressor                                         */
/* ------------------------------------------------------------------------------------------ */

class QariDynamics extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gate', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'comp', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    const coef = (sec) => Math.exp(-1 / (sec * sr));
    // Expander detector and gain smoothing.
    // Symmetric mean-square smoothing (true RMS). Voice onsets are tens of dB above the
    // threshold, so the gate still opens within microseconds.
    this.envAtt = coef(0.015);
    this.envRel = coef(0.015);
    this.openCoef = coef(0.002);
    this.closeCoef = coef(0.08);
    this.holdSamples = Math.round(0.1 * sr);
    this.env = 0;
    this.gateGain = 1;
    this.hold = 0;
    // Noise-floor tracker (minimum statistics over ~3 s, in 100 ms windows).
    this.winLen = Math.max(1, Math.round((0.1 * sr) / 128));
    this.winCount = 0;
    this.winMin = 0;
    this.ring = new Float32Array(30).fill(-70);
    this.ringPos = 0;
    this.floorDb = -70;
    // Compressor.
    this.rmsCoef = coef(0.008);
    this.attC = coef(0.006);
    this.relC = coef(0.16);
    this.ms = 0;
    this.gcDb = 0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const out = output[0];
    const input = inputs[0];
    const x = input && input.length > 0 ? input[0] : null;
    const n = out.length;
    const gate = parameters.gate[0];
    const comp = parameters.comp[0];

    // Block level for the noise-floor tracker.
    let sum = 0;
    if (x) for (let i = 0; i < n; i++) sum += x[i] * x[i];
    const blockDb = sum > 0 ? 10 * Math.log10(sum / n) : -120;
    if (blockDb > -110) {
      if (this.winCount === 0 || blockDb < this.winMin) this.winMin = blockDb;
      this.winCount++;
      if (this.winCount >= this.winLen) {
        this.ring[this.ringPos] = this.winMin;
        this.ringPos = (this.ringPos + 1) % this.ring.length;
        this.winCount = 0;
        let m = 0;
        for (let k = 0; k < this.ring.length; k++) m = k === 0 || this.ring[k] < m ? this.ring[k] : m;
        this.floorDb = m;
      }
    }

    const thr = Math.min(-40, Math.max(-72, this.floorDb + 9));
    const range = 18 * gate;
    const cT = -16 - 16 * comp; // threshold (dBFS RMS)
    const cR = 1.4 + 2.6 * comp; // ratio
    const cW = 10; // knee width (dB)
    const slope = 1 - 1 / cR;
    const makeup = 3.5 * comp;

    for (let i = 0; i < n; i++) {
      const s = x ? x[i] : 0;

      // --- Expander ---
      let g = 1;
      if (gate > 0.001) {
        // RMS-style detector: compares like with like against the RMS noise-floor estimate.
        const sq = s * s;
        this.env = sq > this.env ? sq + (this.env - sq) * this.envAtt : sq + (this.env - sq) * this.envRel;
        const lvl = this.env > 1e-14 ? 10 * Math.log10(this.env) : -140;
        let target;
        if (lvl >= thr) {
          this.hold = this.holdSamples;
          target = 1;
        } else if (this.hold > 0) {
          this.hold--;
          target = 1;
        } else {
          // 1:3 downward expansion below the threshold, limited to `range` dB.
          target = dbToLin(Math.max(-range, 2 * (lvl - thr)));
        }
        this.gateGain =
          target > this.gateGain
            ? target + (this.gateGain - target) * this.openCoef
            : target + (this.gateGain - target) * this.closeCoef;
        g = this.gateGain;
      } else {
        this.gateGain = 1;
      }

      // --- Compressor ---
      let cg = 1;
      if (comp > 0.001) {
        this.ms = this.ms * this.rmsCoef + s * s * (1 - this.rmsCoef);
        const lvl = this.ms > 1e-12 ? 10 * Math.log10(this.ms) : -120;
        const over = lvl - cT;
        let gr = 0;
        if (over >= cW / 2) gr = over * slope;
        else if (over > -cW / 2) gr = (slope * (over + cW / 2) * (over + cW / 2)) / (2 * cW);
        const t = -gr;
        this.gcDb = t < this.gcDb ? t + (this.gcDb - t) * this.attC : t + (this.gcDb - t) * this.relC;
        cg = dbToLin(this.gcDb + makeup);
      } else {
        this.gcDb = 0;
      }

      out[i] = s * g * cg;
    }
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Spectral noise reduction                                                                   */
/* ------------------------------------------------------------------------------------------ */

function makeFFT(n) {
  const levels = Math.round(Math.log2(n));
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let v = i;
    for (let j = 0; j < levels; j++) {
      r = (r << 1) | (v & 1);
      v >>>= 1;
    }
    rev[i] = r;
  }
  return function transform(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const c = cos[k];
          const s = inverse ? sin[k] : -sin[k];
          const tre = re[l] * c - im[l] * s;
          const tim = re[l] * s + im[l] * c;
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  };
}

class QariDenoise extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }

  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const N = o.fftSize || (sampleRate > 50000 ? 2048 : 1024);
    const H = N / 4;
    this.N = N;
    this.H = H;
    // FIFO offset; the processor's total delay is exactly N samples (see denoiseLatency()).
    this.latency = N - H;
    this.fft = makeFFT(N);
    this.win = new Float64Array(N);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    this.inFifo = new Float64Array(N);
    this.outFifo = new Float64Array(N);
    this.accum = new Float64Array(2 * N);
    this.rover = this.latency;
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
    this.bins = N / 2 + 1;
    this.gains = new Float64Array(this.bins).fill(1);
    this.smooth = new Float64Array(this.bins);
    this.profile = o.profile ? Float64Array.from(o.profile) : null;
    this.amount = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'profile') this.profile = e.data.profile ? Float64Array.from(e.data.profile) : null;
    };
  }

  processFrame() {
    const { N, H, re, im, win, gains, smooth, profile } = this;
    for (let i = 0; i < N; i++) {
      re[i] = this.inFifo[i] * win[i];
      im[i] = 0;
    }
    const amount = this.amount;
    if (profile && amount > 0.001) {
      this.fft(re, im, false);
      const alpha = 1 + 1.5 * amount;
      const floor = dbToLin(-(4 + 14 * amount));
      const rel = 0.6;
      for (let k = 0; k < this.bins; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        const nn = alpha * profile[k] * profile[k];
        let g = p > 0 ? 1 - nn / p : 0;
        g = g > 0 ? Math.sqrt(g) : 0;
        if (g < floor) g = floor;
        // Slow closing / fast opening per bin suppresses "musical noise".
        const prev = gains[k];
        if (g < prev) g = prev * rel + g * (1 - rel);
        gains[k] = g;
      }
      // Light smoothing across frequency.
      smooth[0] = gains[0];
      smooth[this.bins - 1] = gains[this.bins - 1];
      for (let k = 1; k < this.bins - 1; k++) smooth[k] = 0.25 * gains[k - 1] + 0.5 * gains[k] + 0.25 * gains[k + 1];
      for (let k = 0; k < this.bins; k++) {
        const g = smooth[k];
        re[k] *= g;
        im[k] *= g;
        if (k > 0 && k < N / 2) {
          re[N - k] *= g;
          im[N - k] *= g;
        }
      }
      this.fft(re, im, true);
    } else {
      gains.fill(1);
    }
    // Overlap-add (Hann analysis × Hann synthesis at 75 % overlap sums to 1.5).
    const norm = 1 / 1.5;
    for (let i = 0; i < N; i++) this.accum[i] += re[i] * win[i] * norm;
    for (let i = 0; i < H; i++) this.outFifo[i] = this.accum[i];
    this.accum.copyWithin(0, H, 2 * N);
    this.accum.fill(0, 2 * N - H);
    this.inFifo.copyWithin(0, H, N);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const x = input && input.length > 0 ? input[0] : null;
    const output = outputs[0];
    const out = output[0];
    this.amount = parameters.amount[0];
    const lat = this.latency;
    for (let i = 0; i < out.length; i++) {
      this.inFifo[this.rover] = x ? x[i] : 0;
      out[i] = this.outFifo[this.rover - lat];
      this.rover++;
      if (this.rover >= this.N) {
        this.rover = lat;
        this.processFrame();
      }
    }
    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Look-ahead limiter                                                                         */
/* ------------------------------------------------------------------------------------------ */

class QariLimiter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const L = Math.max(1, Math.round(((o.lookaheadMs != null ? o.lookaheadMs : 1.5) * sampleRate) / 1000));
    this.W = L + 1; // min-hold and box-filter window
    this.D = L; // audio delay
    this.ceiling = dbToLin(o.ceilingDb != null ? o.ceilingDb : -1);
    this.relCoef = Math.exp(-1 / (((o.releaseMs || 80) / 1000) * sampleRate));
    this.guard = !!o.guard;
    this.delay = [new Float32Array(this.D), new Float32Array(this.D)];
    this.dPos = 0;
    // Monotonic deque for the sliding minimum.
    this.dqVal = new Float64Array(this.W + 2);
    this.dqIdx = new Float64Array(this.W + 2);
    this.dqHead = 0;
    this.dqTail = 0;
    this.box = new Float64Array(this.W).fill(1);
    this.boxPos = 0;
    this.boxSum = this.W;
    this.r = 1;
    this.t = 0;
    this.heavy = 0;
    this.cooldown = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'guard') this.guard = !!e.data.enabled;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const n = output[0].length;
    const inL = input && input.length > 0 ? input[0] : null;
    const inR = input && input.length > 1 ? input[1] : inL;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;
    const W = this.W;
    const cap = W + 2;
    let heavyBlock = 0;

    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : 0;
      const peak = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
      const req = peak > this.ceiling ? this.ceiling / peak : 1;
      // Release smoothing that never exceeds the required gain.
      const rel = 1 - (1 - this.r) * this.relCoef;
      this.r = req < rel ? req : rel;

      // Sliding minimum over the last W values.
      const t = this.t++;
      while (this.dqTail !== this.dqHead && this.dqVal[(this.dqTail - 1 + cap) % cap] >= this.r) {
        this.dqTail = (this.dqTail - 1 + cap) % cap;
      }
      this.dqVal[this.dqTail] = this.r;
      this.dqIdx[this.dqTail] = t;
      this.dqTail = (this.dqTail + 1) % cap;
      while (this.dqIdx[this.dqHead] <= t - W) this.dqHead = (this.dqHead + 1) % cap;
      const m = this.dqVal[this.dqHead];

      // Box filter → smooth gain that reaches the minimum exactly at the delayed peak.
      this.boxSum += m - this.box[this.boxPos];
      this.box[this.boxPos] = m;
      this.boxPos = (this.boxPos + 1) % W;
      let g = this.boxSum / W;
      if (g > 1) g = 1;

      const dl = this.delay[0][this.dPos];
      const dr = this.delay[1][this.dPos];
      this.delay[0][this.dPos] = l;
      this.delay[1][this.dPos] = r;
      this.dPos = (this.dPos + 1) % this.D;

      let yl = dl * g;
      let yr = dr * g;
      // Final safety clamp (never reached in normal operation).
      if (yl > 1) yl = 1;
      else if (yl < -1) yl = -1;
      if (yr > 1) yr = 1;
      else if (yr < -1) yr = -1;
      outL[i] = yl;
      if (outR) outR[i] = yr;
      if (g < 0.316) heavyBlock++; // more than 10 dB of gain reduction
    }

    if (this.guard) {
      if (this.cooldown > 0) this.cooldown -= n;
      if (heavyBlock > n / 2) this.heavy += n;
      else this.heavy = Math.max(0, this.heavy - n * 2);
      if (this.heavy > 0.7 * sampleRate && this.cooldown <= 0) {
        this.port.postMessage({ type: 'overload' });
        this.heavy = 0;
        this.cooldown = 2 * sampleRate;
      }
    }
    return true;
  }
}

registerProcessor('qari-recorder', QariRecorder);
registerProcessor('qari-dynamics', QariDynamics);
registerProcessor('qari-denoise', QariDenoise);
registerProcessor('qari-limiter', QariLimiter);
