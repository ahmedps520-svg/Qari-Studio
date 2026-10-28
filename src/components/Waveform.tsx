import { useEffect, useRef, useState } from 'react';
import { resamplePeaks } from '../audio/dsp/peaks';
import { useT } from '../i18n';

function useCanvasSize(ref: React.RefObject<HTMLCanvasElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)), dpr: Math.min(3, window.devicePixelRatio || 1) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Live waveform: a scrolling, mirrored envelope of the real microphone signal.
 * Levels are sampled from an AnalyserNode on a fixed time grid, so the picture moves at the
 * same speed on every display and always reflects actual input. With no analyser it is flat.
 */
export function LiveWaveform({
  analyser,
  mode,
  height = 200,
  seconds = 6,
}: {
  analyser: AnalyserNode | null;
  mode: 'idle' | 'live' | 'recording' | 'paused';
  height?: number;
  seconds?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);
  const t = useT();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const history = useRef<Float32Array>(new Float32Array(0));
  const levelRef = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = size.w * size.dpr;
    canvas.height = size.h * size.dpr;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);

    const STEP_MS = 1000 / 40;
    const points = Math.round((seconds * 1000) / STEP_MS);
    if (history.current.length !== points) {
      const next = new Float32Array(points);
      const old = history.current;
      next.set(old.subarray(Math.max(0, old.length - points)), Math.max(0, points - old.length));
      history.current = next;
    }
    const buf = new Float32Array(analyser?.fftSize ?? 2048);
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    let smooth = 0;
    const colorA = cssVar('--wave-a', '#5fe3b6');
    const colorB = cssVar('--wave-b', '#e0c27f');
    const dim = cssVar('--wave-dim', 'rgba(185,195,185,0.22)');
    const line = cssVar('--line-2', 'rgba(233,222,192,0.13)');

    const draw = (now: number) => {
      const m = modeRef.current;
      const W = size.w;
      const H = size.h;
      const mid = H / 2;
      const hist = history.current;

      // Sample the analyser on a fixed time grid.
      let level = 0;
      if (analyser && m !== 'idle') {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const db = rms > 1e-7 ? 20 * Math.log10(rms) : -140;
        level = Math.max(0, Math.min(1, (db + 62) / 56));
      }
      // Fast attack, slower release: fluid motion without hiding transients.
      smooth = level > smooth ? smooth + (level - smooth) * 0.6 : smooth + (level - smooth) * 0.18;
      levelRef.current = smooth;
      acc += now - last;
      last = now;
      if (m !== 'paused') {
        while (acc >= STEP_MS) {
          hist.copyWithin(0, 1);
          hist[hist.length - 1] = m === 'idle' ? 0 : smooth;
          acc -= STEP_MS;
        }
      } else acc = 0;

      ctx.clearRect(0, 0, W, H);
      // Baseline
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(W, mid + 0.5);
      ctx.stroke();

      const nowX = W * 0.86;
      const dx = nowX / (hist.length - 1);
      const amp = (H / 2) * 0.86;
      const ys: number[] = new Array(hist.length);
      for (let i = 0; i < hist.length; i++) ys[i] = Math.max(0.6, hist[i] * amp);

      const path = (sign: 1 | -1) => {
        ctx.moveTo(0, mid - sign * ys[0]);
        for (let i = 1; i < hist.length - 1; i++) {
          const x = i * dx;
          const xc = x + dx / 2;
          const yc = mid - sign * (ys[i] + ys[i + 1]) / 2;
          ctx.quadraticCurveTo(x, mid - sign * ys[i], xc, yc);
        }
        ctx.lineTo(nowX, mid - sign * ys[hist.length - 1]);
      };

      const active = m === 'recording' || m === 'live';
      const grad = ctx.createLinearGradient(0, 0, nowX, 0);
      if (m === 'paused' || m === 'idle') {
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, dim);
      } else {
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.35, m === 'recording' ? colorB : colorA);
        grad.addColorStop(1, colorA);
      }

      // Filled body
      ctx.beginPath();
      path(1);
      ctx.lineTo(nowX, mid + ys[hist.length - 1]);
      for (let i = hist.length - 2; i >= 1; i--) {
        const x = i * dx;
        const xc = x - dx / 2;
        const yc = mid + (ys[i] + ys[i - 1]) / 2;
        ctx.quadraticCurveTo(x, mid + ys[i], xc, yc);
      }
      ctx.lineTo(0, mid + ys[0]);
      ctx.closePath();
      ctx.globalAlpha = active ? 0.2 : 0.35;
      ctx.fillStyle = grad;
      ctx.fill();

      // Luminous edges
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = grad;
      if (active) {
        ctx.shadowColor = m === 'recording' ? colorB : colorA;
        ctx.shadowBlur = 10;
      }
      ctx.beginPath();
      path(1);
      ctx.stroke();
      ctx.beginPath();
      path(-1);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // "Now" marker
      if (m !== 'idle') {
        const r = 3 + smooth * 6;
        ctx.globalAlpha = m === 'paused' ? 0.5 : 1;
        ctx.fillStyle = m === 'recording' ? colorB : colorA;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = active ? 18 : 0;
        ctx.beginPath();
        ctx.arc(nowX, mid, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(nowX + 0.5, 8);
        ctx.lineTo(nowX + 0.5, H - 8);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, size, seconds]);

  return (
    <canvas
      ref={ref}
      className="live-wave"
      style={{ width: '100%', height }}
      role="img"
      aria-label={t('studio.waveformLabel')}
    />
  );
}

/** Input level meter with peak hold and clip/quiet detection (real analyser data). */
export function LevelMeter({
  analyser,
  onStatus,
  compact,
}: {
  analyser: AnalyserNode | null;
  onStatus?: (s: 'ok' | 'clip' | 'quiet' | 'none') => void;
  compact?: boolean;
}) {
  const bar = useRef<HTMLSpanElement>(null);
  const peakEl = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<string>('none');
  const t = useT();
  const cb = useRef(onStatus);
  cb.current = onStatus;

  useEffect(() => {
    let raf = 0;
    const buf = new Float32Array(analyser?.fftSize ?? 2048);
    let hold = -90;
    let holdAt = 0;
    let clipAt = -1e9;
    let loudAt = performance.now();
    const loop = (now: number) => {
      let peakDb = -90;
      if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        let p = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]);
          if (v > p) p = v;
        }
        peakDb = p > 1e-6 ? 20 * Math.log10(p) : -90;
      }
      if (peakDb > hold || now - holdAt > 1200) {
        hold = peakDb;
        holdAt = now;
      }
      if (peakDb >= -0.5) clipAt = now;
      if (peakDb > -36) loudAt = now;
      const pct = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      if (bar.current) bar.current.style.width = `${pct(peakDb)}%`;
      if (peakEl.current) peakEl.current.style.insetInlineStart = `calc(${pct(hold)}% - 1px)`;
      if (label.current) label.current.textContent = analyser ? (peakDb <= -89 ? '−∞' : `${Math.round(peakDb)} dB`) : '';
      const status = !analyser ? 'none' : now - clipAt < 1500 ? 'clip' : now - loudAt > 6000 ? 'quiet' : 'ok';
      if (status !== statusRef.current) {
        statusRef.current = status;
        cb.current?.(status as 'ok' | 'clip' | 'quiet' | 'none');
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <div className={`meter ${compact ? 'compact' : ''}`} aria-label={t('studio.inputLevel')} role="img">
      <div className="meter-track" dir="ltr">
        <span ref={bar} className="meter-fill" />
        <span ref={peakEl} className="meter-peak" />
        <span className="meter-tick" style={{ insetInlineStart: '70%' }} />
        <span className="meter-tick" style={{ insetInlineStart: '90%' }} />
      </div>
      {!compact && <span ref={label} className="meter-label num" dir="ltr" />}
    </div>
  );
}

/** Recorded waveform with progress, click/drag seeking and keyboard control. */
export function SeekWaveform({
  peaks,
  duration,
  getTime,
  onSeek,
  playing,
  height = 96,
  label,
}: {
  peaks: number[];
  duration: number;
  getTime: () => number;
  onSeek: (t: number) => void;
  playing: boolean;
  height?: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);
  const t = useT();
  const [now, setNow] = useState(0);
  const dragging = useRef(false);
  const drawRef = useRef<(() => void) | null>(null);
  const redraw = () => requestAnimationFrame(() => drawRef.current?.());

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = size.w * size.dpr;
    canvas.height = size.h * size.dpr;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    const barW = 2.4;
    const gap = 1.8;
    const count = Math.max(8, Math.floor(size.w / (barW + gap)));
    const bars = resamplePeaks(peaks, count);
    const maxPeak = Math.max(0.05, ...bars);
    const colorA = cssVar('--wave-a', '#5fe3b6');
    const colorB = cssVar('--wave-b', '#e0c27f');
    const dim = cssVar('--wave-dim', 'rgba(185,195,185,0.22)');
    let raf = 0;
    let lastShown = -1;

    const draw = () => {
      const time = getTime();
      const p = duration > 0 ? Math.min(1, time / duration) : 0;
      const W = size.w;
      const H = size.h;
      const mid = H / 2;
      ctx.clearRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, colorA);
      grad.addColorStop(1, colorB);
      const px = p * W;
      for (let i = 0; i < count; i++) {
        const x = i * (barW + gap);
        const v = Math.sqrt(bars[i] / maxPeak);
        const h = Math.max(1.5, v * (H / 2 - 4));
        ctx.fillStyle = x + barW <= px ? grad : dim;
        const r = Math.min(barW / 2, h);
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, mid - h, barW, h * 2, r);
        else ctx.rect(x, mid - h, barW, h * 2); // Safari < 16
        ctx.fill();
      }
      ctx.fillStyle = colorB;
      ctx.fillRect(Math.round(px) - 1, 4, 2, H - 8);
      const shown = Math.floor(time * 10);
      if (shown !== lastShown) {
        lastShown = shown;
        setNow(time);
      }
      if (playing) raf = requestAnimationFrame(draw);
    };
    drawRef.current = () => {
      cancelAnimationFrame(raf);
      draw();
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      drawRef.current = null;
    };
  }, [peaks, duration, getTime, playing, size]);

  const seekFromEvent = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onSeek(p * duration);
    setNow(p * duration);
    redraw();
  };

  return (
    <div
      className="seek-wave"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(now)}
      aria-valuetext={`${t.duration(now)} / ${t.duration(duration)}`}
      dir="ltr"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        seekFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current) seekFromEvent(e);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onKeyDown={(e) => {
        const cur = getTime();
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onSeek(Math.min(duration, cur + 5));
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onSeek(Math.max(0, cur - 5));
        else if (e.key === 'Home') onSeek(0);
        else if (e.key === 'End') onSeek(duration);
        else return;
        e.preventDefault();
        setNow(getTime());
        redraw();
      }}
    >
      <canvas ref={ref} style={{ width: '100%', height }} />
    </div>
  );
}

/** Tiny static waveform for list rows. */
export function MiniWave({ peaks, progress = 0 }: { peaks: number[]; progress?: number }) {
  const bars = resamplePeaks(peaks, 36);
  const max = Math.max(0.05, ...bars);
  return (
    <svg className="mini-wave" viewBox="0 0 108 24" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => {
        const h = Math.max(1.2, Math.sqrt(b / max) * 11);
        return (
          <rect
            key={i}
            x={i * 3}
            y={12 - h}
            width={1.8}
            height={h * 2}
            rx={0.9}
            className={i / bars.length < progress ? 'on' : ''}
          />
        );
      })}
    </svg>
  );
}
