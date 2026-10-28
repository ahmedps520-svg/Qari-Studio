#!/usr/bin/env node
/**
 * End-to-end test of the complete Qari Studio workflow in real Chromium.
 *
 * The microphone is Chromium's fake capture device playing a synthesised, voice-like signal, so
 * the whole real pipeline runs: getUserMedia → AudioWorklet recorder → IndexedDB chunks →
 * live effects chain → offline rendering → encoders → downloads.
 *
 *   node tests/e2e/run-e2e.mjs            (builds first)
 *   node tests/e2e/run-e2e.mjs --no-build
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { makeVoice, writeWav16 } from './make-voice.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'test-results');
mkdirSync(out, { recursive: true });
const PORT = 4317;
const BASE = `http://localhost:${PORT}/`;
const args = process.argv.slice(2);

const results = [];
let current = '';
const log = (...m) => console.log('   ', ...m);
async function step(name, fn) {
  current = name;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.stack ?? e) });
    console.log(`✗ ${name}\n    ${String(e?.message ?? e)}`);
    throw e;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
};

function parseWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(...buf.subarray(o, o + 4));
  assert(tag(0) === 'RIFF' && tag(8) === 'WAVE', 'RIFF/WAVE header');
  let o = 12;
  const info = {};
  while (o + 8 <= buf.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      info.format = v.getUint16(o + 8, true);
      info.channels = v.getUint16(o + 10, true);
      info.sampleRate = v.getUint32(o + 12, true);
      info.bits = v.getUint16(o + 22, true);
    } else if (id === 'data') {
      info.frames = size / (info.channels * (info.bits / 8));
      info.dataOffset = o + 8;
      break;
    }
    o += 8 + size + (size % 2);
  }
  info.duration = info.frames / info.sampleRate;
  if (info.bits === 24) {
    let peak = 0;
    for (let p = info.dataOffset; p + 2 < buf.length; p += 3) {
      let x = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
      if (x & 0x800000) x |= ~0xffffff;
      peak = Math.max(peak, Math.abs(x) / 8388608);
    }
    info.peak = peak;
  }
  return info;
}

function ffprobe(path) {
  try {
    return JSON.parse(execSync(`ffprobe -v error -show_streams -show_format -of json "${path}"`).toString());
  } catch {
    return null;
  }
}

async function startServer(build = true) {
  if (build && !args.includes('--no-build')) {
    console.log('Building…');
    execSync('npx vite build', { cwd: root, stdio: 'ignore' });
  }
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return proc;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('preview server did not start');
}

const qari = (page, fn, arg) => page.evaluate(fn, arg);

/** Poll an async in-page check until it returns true (waitForFunction does not await promises). */
async function until(page, fn, arg, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn, arg)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${fn.toString().slice(0, 80)}`);
}
const engineState = (page) => qari(page, () => window.__qari.engine.getState());

/** The Studio opens the microphone by itself when already permitted; otherwise press the button. */
async function ensureMic(page) {
  await page.waitForTimeout(600);
  await page.waitForFunction(() => window.__qari.engine.getState().input.status !== 'opening', null, { timeout: 10000 });
  if ((await engineState(page)).input.status !== 'on') await page.getByTestId('enable-mic').click();
  await page.waitForFunction(() => window.__qari.engine.getState().input.status === 'on', null, { timeout: 10000 });
}

async function main() {
  const voicePath = join(out, 'voice.wav');
  const v = makeVoice({ seconds: 14 });
  writeWav16(voicePath, v.samples, v.sampleRate);

  const server = await startServer();
  const fakeMic = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voicePath}`, '--autoplay-policy=no-user-gesture-required'];
  const browser = await chromium.launch({ args: fakeMic });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['microphone'], acceptDownloads: true, locale: 'en-US' });
  let page = await ctx.newPage();
  const consoleErrors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  };
  watch(page);
  let recId = '';
  let meta;

  try {
    await step('1. Open the app', async () => {
      await page.goto(BASE);
      await page.getByTestId('start-reciting').waitFor();
      assert(await page.getByText('As-salamu alaykum').isVisible(), 'greeting visible');
    });

    await step('2. Select Surah Ar-Rahman in the Quran browser', async () => {
      await page.click('a.side-link[href="#/quran"]');
      await page.fill('input[type=search]', 'rahman');
      await page.locator('button.surah-row').first().click();
      await page.waitForURL(/#\/quran\/55$/);
      assert(await page.locator('.surah-hero-ar').innerText() === 'سورة الرحمن', 'Arabic name');
      assert((await page.locator('.surah-hero-meta').innerText()).includes('78 ayahs'), '78 ayahs');
      await page.locator('.ayah[data-ayah="78"]').waitFor();
    });

    await step('3. Enter the recording studio', async () => {
      await page.getByTestId('recite-surah').click();
      await page.waitForURL(/#\/studio/);
      assert((await page.getByTestId('studio-surah-ar').innerText()) === 'سورة الرحمن', 'studio shows surah');
      await ensureMic(page);
      const st = await engineState(page);
      log(`mic: "${st.input.label}" @ ${st.sampleRate} Hz`);
    });

    await step('4–5. Enable Live Listen (with the headphone confirmation)', async () => {
      await page.click('#live-switch');
      await page.getByTestId('confirm-ok').click();
      await page.waitForFunction(() => window.__qari.engine.getState().live.enabled);
      const lat = await qari(page, () => window.__qari.engine.getLatency());
      log(`reported latency ≈ ${(lat.total * 1000).toFixed(1)} ms (input ${lat.input}, base ${lat.base}, output ${lat.output})`);
    });

    await step('6–8. Select Beautiful + and confirm the live audio is really processed', async () => {
      const measure = async (preset) => {
        await page.click(`.studio-preset [data-preset="${preset}"]`);
        await page.waitForTimeout(700);
        return qari(page, () => window.__qari.analyseLive(4500));
      };
      const compare = (a) => {
        const bin = a.sampleRate / 2 / a.inputDb.length;
        const diffs = [];
        for (let i = Math.ceil(200 / bin); i < 8000 / bin; i++) diffs.push(a.outputDb[i] - a.inputDb[i]);
        const mean = diffs.reduce((x, y) => x + y, 0) / diffs.length;
        const mad = diffs.reduce((x, y) => x + Math.abs(y - mean), 0) / diffs.length;
        return { mean, mad, outRms: a.outputRms, inRms: a.inputRms, pause: a.pauseGainDb, pauseFrames: a.pauseFrames };
      };
      const vanilla = compare(await measure('plain-vanilla'));
      const beautiful = compare(await measure('beautiful-plus'));
      const fmt = (x) => `spectral deviation ${x.mad.toFixed(2)} dB, level ${x.mean.toFixed(2)} dB, in pauses ${x.pause?.toFixed(1)} dB (${x.pauseFrames} frames)`;
      log(`Plain Vanilla: ${fmt(vanilla)}`);
      log(`Beautiful +  : ${fmt(beautiful)}`);
      assert(vanilla.outRms > 0.001 && beautiful.outRms > 0.001, 'monitored output carries audio');
      assert(vanilla.mad < 1.0 && Math.abs(vanilla.mean) < 0.5, 'Plain Vanilla is transparent');
      assert(vanilla.pause !== null && Math.abs(vanilla.pause) < 2, 'Plain Vanilla adds nothing in pauses');
      assert(beautiful.pause !== null && beautiful.pause > 8, 'Beautiful + adds a real reverb/echo tail');
      const st = await engineState(page);
      assert(st.live.enabled && !st.live.muted, 'still monitoring, not muted by feedback guard');
    });

    await step('9. Record (with pause/resume) — timer follows captured audio', async () => {
      await page.getByTestId('rec-button').click();
      await page.waitForFunction(() => window.__qari.engine.getState().recording.state === 'recording');
      await page.waitForTimeout(3000);
      await page.getByTestId('rec-button').click();
      await page.waitForFunction(() => window.__qari.engine.getState().recording.state === 'paused');
      const t1 = await qari(page, () => window.__qari.engine.getRecordedSeconds());
      await page.waitForTimeout(1200);
      const t2 = await qari(page, () => window.__qari.engine.getRecordedSeconds());
      assert(Math.abs(t2 - t1) < 0.01, `timer frozen while paused (${t1} → ${t2})`);
      assert(t1 > 2.6 && t1 < 3.6, `about 3 s captured (${t1})`);
      await page.getByTestId('rec-button').click();
      await page.waitForFunction(() => window.__qari.engine.getState().recording.state === 'recording');
      await page.waitForTimeout(2500);
      const shown = await page.getByTestId('rec-timer').innerText();
      log(`timer shows ${shown}`);
    });

    await step('10. Stop recording → review screen', async () => {
      await page.getByTestId('stop').click();
      await page.waitForURL(/#\/recording\//);
      recId = page.url().split('/recording/')[1];
      await page.getByTestId('review-status').waitFor();
      meta = await qari(page, (id) => window.__qari.db.getRecording(id), recId);
      log(`recording ${recId}: ${meta.duration.toFixed(2)} s @ ${meta.sampleRate} Hz, status ${meta.status}`);
      assert(meta.status === 'draft', 'kept as draft until saved');
      assert(meta.duration > 5 && meta.duration < 6.6, `duration excludes the pause (${meta.duration})`);
      assert(meta.surah === 55 && meta.presetId === 'beautiful-plus', 'surah and preset stored');
      const stats = await qari(
        page,
        async (m) => {
          const s = await window.__qari.db.loadAudio(m.audioId);
          let sum = 0;
          let peak = 0;
          for (const x of s) {
            sum += x * x;
            peak = Math.max(peak, Math.abs(x));
          }
          return { frames: s.length, rms: Math.sqrt(sum / s.length), peak };
        },
        meta,
      );
      assert(stats.frames === meta.frames, 'all audio persisted to IndexedDB');
      assert(stats.rms > 0.01 && stats.peak > 0.1, `original contains the voice (rms ${stats.rms.toFixed(3)})`);
    });

    await step('11. Play the recording back', async () => {
      await page.getByTestId('play').click();
      await page.waitForTimeout(1500);
      const ps = await qari(page, () => ({ ...window.__qari.player.getState(), t: window.__qari.player.currentTime }));
      assert(ps.playing && ps.t > 0.8, `playing (t=${ps.t})`);
    });

    await step('12. Compare original and processed audio (A/B, loudness-matched)', async () => {
      const level = () =>
        qari(page, async () => {
          const a = window.__qari.player.getAnalyser();
          const buf = new Float32Array(a.fftSize);
          let s = 0;
          for (let k = 0; k < 20; k++) {
            a.getFloatTimeDomainData(buf);
            for (const x of buf) s += x * x;
            await new Promise((r) => setTimeout(r, 25));
          }
          return Math.sqrt(s / (20 * buf.length));
        });
      // Measure both versions at the same position so the comparison is fair.
      await qari(page, () => window.__qari.player.seek(0.5));
      await page.locator('.ab-toggle button', { hasText: 'Original' }).click();
      assert((await qari(page, () => window.__qari.player.getState().version)) === 'original', 'original selected');
      const lo = await level();
      await qari(page, () => window.__qari.player.seek(0.5));
      await page.locator('.ab-toggle button', { hasText: 'Enhanced' }).click();
      assert((await qari(page, () => window.__qari.player.getState().version)) === 'a', 'enhanced selected');
      const le = await level();
      log(`playback level original ${lo.toFixed(4)} / enhanced ${le.toFixed(4)}`);
      assert(lo > 0.001 && le > 0.001, 'both versions audible');
      await page.waitForFunction(() => window.__qari.player.getState().loudness.a !== null, null, { timeout: 15000 });
      const L = await qari(page, () => window.__qari.player.getState().loudness);
      log(`loudness original ${L.original.toFixed(1)} LUFS, enhanced ${L.a.toFixed(1)} LUFS`);
    });

    await step('13–14. Change the preset to Grand Mosque and preview it', async () => {
      await page.click('.review-side [data-preset="grand-mosque"]');
      await page.waitForTimeout(800);
      assert(await page.locator('.review-side .pill.gold').isVisible(), 'shows adjusted');
      const ps = await qari(page, () => window.__qari.player.getState());
      assert(ps.playing || ps.ready, 'player still running');
    });

    await step('15. Save the preferred version', async () => {
      await page.getByTestId('save').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=review-status]')?.textContent === 'Saved');
      meta = await qari(page, (id) => window.__qari.db.getRecording(id), recId);
      assert(meta.status === 'saved' && meta.presetId === 'grand-mosque', 'saved with Grand Mosque');
    });

    await step('16. Find it in My Recordings', async () => {
      await page.click('a.side-link[href="#/library"]');
      await page.getByTestId('library-list').waitFor();
      const row = page.locator(`[data-testid=recording-row][data-id="${recId}"]`);
      await row.waitFor();
      assert((await row.innerText()).includes('Grand Mosque'), 'row shows preset');
    });

    await step('17. Rename it', async () => {
      await page.locator(`[data-testid=recording-row][data-id="${recId}"] .rec-main`).click();
      await page.getByTestId('rename').click();
      await page.getByTestId('prompt-input').fill('Ar-Rahman — Evening recitation');
      await page.getByTestId('prompt-ok').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=review-title]')?.textContent === 'Ar-Rahman — Evening recitation');
    });

    await step('18. Export it (WAV 24-bit enhanced, MP3, original WAV 16-bit)', async () => {
      const exportOnce = async (format, version) => {
        await page.getByTestId('export').click();
        await page.locator('.option', { hasText: version === 'original' ? 'Original voice' : 'Enhanced' }).first().click();
        await page.locator('.option', { hasText: format }).first().click();
        const name = await page.getByTestId('export-filename').inputValue();
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('export-download').click()]);
        const file = join(out, dl.suggestedFilename());
        await dl.saveAs(file);
        await page.waitForSelector('.overlay', { state: 'detached' });
        return { file, name, suggested: dl.suggestedFilename() };
      };
      const wav = await exportOnce('WAV · 24-bit', 'enhanced');
      log(`downloaded ${wav.suggested}`);
      assert(/^Quran_Ar-Rahman_Grand-Mosque_\d{4}-\d{2}-\d{2}\.wav$/.test(wav.suggested), 'default name pattern');
      const info = parseWav(readFileSync(wav.file));
      log(`  ${info.channels} ch, ${info.sampleRate} Hz, ${info.bits}-bit, ${info.duration.toFixed(2)} s, peak ${(20 * Math.log10(info.peak)).toFixed(2)} dBFS`);
      assert(info.channels === 2 && info.bits === 24 && info.sampleRate === meta.sampleRate, 'stereo 24-bit at native rate');
      assert(info.duration > meta.duration + 1 && info.duration < meta.duration + 9, 'includes the reverb tail');
      assert(info.peak <= 0.8913 + 2e-4, 'limiter keeps peaks ≤ −1 dBFS');

      const mp3 = await exportOnce('MP3', 'enhanced');
      const probe = ffprobe(mp3.file);
      if (probe) {
        const s = probe.streams[0];
        log(`  ${mp3.suggested}: ${s.codec_name}, ${s.channels} ch, ${s.sample_rate} Hz, ${Number(probe.format.duration).toFixed(2)} s`);
        assert(s.codec_name === 'mp3' && s.channels === 2, 'valid stereo MP3');
      }
      const orig = await exportOnce('WAV · 16-bit', 'original');
      const oi = parseWav(readFileSync(orig.file));
      log(`  ${orig.suggested}: ${oi.channels} ch, ${oi.bits}-bit, ${oi.duration.toFixed(2)} s`);
      assert(/^Quran_Ar-Rahman_\d{4}-\d{2}-\d{2}\.wav$/.test(orig.suggested), 'original default name');
      assert(oi.channels === 1 && Math.abs(oi.duration - meta.duration) < 0.01, 'original is the unprocessed mono take');
      const aac = await qari(page, () => window.AudioEncoder ? AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }).then((r) => r.supported) : false);
      log(`  AAC/M4A encoding available in this browser: ${aac}`);
    });

    await step('19–20. Close and reopen the app (also offline): the recording is still there', async () => {
      await page.close();
      page = await ctx.newPage();
      watch(page);
      await page.goto(BASE);
      await page.goto(`${BASE}#/library`);
      await page.locator(`[data-testid=recording-row][data-id="${recId}"]`).waitFor();
      assert((await page.locator(`[data-testid=recording-row][data-id="${recId}"]`).innerText()).includes('Evening recitation'), 'renamed title persisted');
      // Offline: the service worker serves the app; recordings come from IndexedDB.
      await until(page, () => navigator.serviceWorker.getRegistration().then((r) => r?.active != null), null, 15000);
      await ctx.setOffline(true);
      const p2 = await ctx.newPage();
      watch(p2);
      await p2.goto(`${BASE}#/recording/${recId}`);
      await p2.getByTestId('play').waitFor();
      await p2.waitForFunction(() => window.__qari.player.getState().ready, null, { timeout: 15000 });
      await p2.getByTestId('play').click();
      await p2.waitForTimeout(1000);
      const t = await qari(p2, () => window.__qari.player.currentTime);
      assert(t > 0.4, `plays offline (t=${t})`);
      await ctx.setOffline(false);
      await p2.close();
    });

    await step('Presets are distinct real processing chains (offline renders)', async () => {
      const r = await qari(page, async () => {
        const sr = 48000;
        const x = new Float32Array(sr * 2);
        // A 0.3 s voiced burst, then silence: the silence reveals each preset's echo/reverb tail.
        for (let i = 0; i < sr * 0.3; i++) {
          const t = i / sr;
          const env = Math.min(1, t / 0.01) * Math.min(1, (0.3 - t) / 0.01);
          x[i] = 0.4 * env * (Math.sin(2 * Math.PI * 160 * t) + 0.5 * Math.sin(2 * Math.PI * 700 * t) + 0.3 * Math.sin(2 * Math.PI * 2400 * t)) / 1.8;
        }
        const out = {};
        const sigs = {};
        for (const p of window.__qari.presets) {
          const res = await window.__qari.renderEnhanced(x, sr, p.params, { noiseProfile: null });
          const [L, R] = res.channels;
          let peak = 0;
          for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
          const seg = (a, b) => {
            let s = 0;
            for (let i = Math.floor(a * sr); i < Math.min(L.length, Math.floor(b * sr)); i++) s += L[i] * L[i] + R[i] * R[i];
            return 10 * Math.log10(s + 1e-20);
          };
          const body = seg(0, 0.3);
          out[p.id] = { peak, early: seg(0.35, 0.8) - body, late: seg(1, 2) - body };
          sigs[p.id] = L.subarray(0, sr);
        }
        const ids = Object.keys(sigs);
        const minDiff = { v: 1e9, a: '', b: '' };
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            const a = sigs[ids[i]];
            const b = sigs[ids[j]];
            let d = 0;
            let e = 0;
            for (let k = 0; k < a.length; k++) {
              d += (a[k] - b[k]) ** 2;
              e += a[k] ** 2;
            }
            const db = 10 * Math.log10(d / e + 1e-12);
            if (db < minDiff.v) Object.assign(minDiff, { v: db, a: ids[i], b: ids[j] });
          }
        return { out, minDiff };
      });
      for (const [id, m] of Object.entries(r.out))
        log(`${id.padEnd(16)} peak ${(20 * Math.log10(m.peak)).toFixed(2)} dBFS · tail 0.05–0.5 s ${m.early.toFixed(1)} dB · 0.7–1.7 s ${m.late.toFixed(1)} dB`);
      log(`most similar pair: ${r.minDiff.a} vs ${r.minDiff.b}, difference ${r.minDiff.v.toFixed(1)} dB`);
      const o = r.out;
      for (const m of Object.values(o)) assert(m.peak <= 0.8913 + 2e-4, 'peaks limited');
      assert(o['plain-vanilla'].early < -80 && o['pure-voice'].early < -80, 'Plain Vanilla and Pure Voice add no echo or reverb');
      assert(o['grand-mosque'].late > o['beautiful-plus'].late + 6, 'Grand Mosque decays much longer than Beautiful +');
      assert(o['beautiful-plus'].late > o['soft-echo'].late + 6, 'Beautiful + is more spacious than Soft Echo');
      assert(o['soft-echo'].early > -40 && o['studio-qari'].early < o['beautiful-plus'].early, 'Soft Echo has a short tail; Studio Qari only a very light room');
      assert(r.minDiff.v > -40, 'every pair of presets differs measurably');
    });

    await step('Extreme custom settings cannot run away or clip', async () => {
      const r = await qari(page, async () => {
        const sr = 48000;
        const x = new Float32Array(sr * 1);
        for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 300 * i) / sr);
        const p = { ...window.__qari.presets[2].params, echoMix: 0.6, echoFeedback: 0.7, reverbMix: 0.7, reverbDecay: 7, outputDb: 6, width: 1.5 };
        const res = await window.__qari.renderEnhanced(x, sr, p, { noiseProfile: null });
        const L = res.channels[0];
        let peak = 0;
        for (const v of L) peak = Math.max(peak, Math.abs(v));
        const seg = (a, b) => {
          let s = 0;
          for (let i = Math.floor(a * sr); i < Math.min(L.length, Math.floor(b * sr)); i++) s += L[i] * L[i];
          return s;
        };
        const end = L.length / sr;
        return { peak, early: seg(1, 2), late: seg(end - 1, end), len: end };
      });
      log(`peak ${(20 * Math.log10(r.peak)).toFixed(2)} dBFS, tail energy decays ${(10 * Math.log10(r.late / r.early)).toFixed(1)} dB`);
      assert(r.peak <= 0.8913 + 2e-4, 'no clipping');
      assert(r.late < r.early * 0.01, 'feedback decays instead of running away');
    });

    await step('Vocal Presets page: audition presets with your own recording', async () => {
      await page.goto(`${BASE}#/presets`);
      await page.getByTestId('preview-grand-mosque').click();
      await page.waitForFunction(() => window.__qari.player.getState().playing, null, { timeout: 10000 });
      const id = await qari(page, () => window.__qari.player.getState().loadedId);
      assert(id.startsWith('audition:'), 'auditioning a saved recording');
      await page.getByTestId('preview-soft-echo').click();
      await page.waitForTimeout(400);
      assert(await qari(page, () => window.__qari.player.getState().playing), 'switching presets keeps playing');
      assert(await page.locator('.preset-card.playing[data-preset="soft-echo"]').isVisible(), 'shows which preset is playing');
      await page.getByTestId('preview-soft-echo').click();
    });

    await step('Back up everything, delete all, restore from the backup', async () => {
      const before = await qari(page, () => window.__qari.db.listRecordings().then((l) => l.map((r) => ({ id: r.id, title: r.title, frames: r.frames }))));
      await page.goto(`${BASE}#/settings`);
      const backupRow = page.locator('.setting-row', { hasText: 'Back up all recordings' });
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), backupRow.locator('button').click()]);
      const zipPath = join(out, dl.suggestedFilename());
      await dl.saveAs(zipPath);
      const { unzipSync, strFromU8 } = await import('fflate');
      const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
      const manifest = JSON.parse(strFromU8(files['qari-studio-backup.json']));
      log(`${dl.suggestedFilename()}: ${manifest.recordings.length} recordings, ${Object.keys(files).length - 1} audio files`);
      assert(manifest.recordings.length === before.length, 'all recordings in the backup');

      await page.locator('.setting-row', { hasText: 'Delete all recordings' }).locator('button').click();
      await page.locator('.sheet input').fill('DELETE');
      await page.getByTestId('confirm-ok').click();
      await until(page, () => window.__qari.db.listRecordings().then((l) => l.length === 0));

      await page.locator('input[type=file]').setInputFiles(zipPath);
      await until(page, (n) => window.__qari.db.listRecordings().then((l) => l.length === n), before.length);
      await page.getByText(/^Restored /).waitFor();
      const after = await qari(page, () => window.__qari.db.listRecordings().then((l) => l.map((r) => ({ id: r.id, title: r.title, frames: r.frames, status: r.status }))));
      for (const b of before) {
        const a = after.find((x) => x.id === b.id);
        assert(a && a.title === b.title && a.frames === b.frames, `restored ${b.title} (before ${JSON.stringify(b)}, after ${JSON.stringify(a)})`);
      }
      const frames = await qari(page, (id) => window.__qari.db.getRecording(id).then((m) => window.__qari.db.loadAudio(m.audioId)).then((s) => s.length), recId);
      assert(frames === before.find((b) => b.id === recId).frames, 'audio restored sample-exact');
    });

    await step('Microphone disconnected mid-recording: paused safely, then resumed', async () => {
      await page.goto(`${BASE}#/studio`);
      await ensureMic(page);
      await page.getByTestId('rec-button').click();
      await page.waitForFunction(() => window.__qari.engine.getState().recording.state === 'recording');
      await page.waitForTimeout(2000);
      await qari(page, () => window.__qari.engine.simulateInputLoss());
      await page.waitForFunction(() => window.__qari.engine.getState().recording.interruption === 'disconnected');
      assert((await engineState(page)).recording.state === 'paused', 'paused, not lost');
      assert(await page.getByText('Microphone disconnected').isVisible(), 'clear message shown');
      await page.locator('.notice button', { hasText: 'Resume recording' }).click();
      await page.waitForFunction(() => window.__qari.engine.getState().recording.state === 'recording', null, { timeout: 10000 });
      await page.waitForTimeout(1500);
      await page.getByTestId('stop').click();
      await page.waitForURL(/#\/recording\//);
      const id = page.url().split('/recording/')[1];
      const m = await qari(page, (x) => window.__qari.db.getRecording(x), id);
      log(`duration after reconnect ${m.duration.toFixed(2)} s`);
      assert(m.duration > 3.2 && m.duration < 4.6, 'both parts kept');
    });

    await step('Discarding asks for confirmation', async () => {
      await page.goto(`${BASE}#/studio`);
      await ensureMic(page);
      await page.getByTestId('rec-button').click();
      await page.waitForFunction(() => window.__qari.engine.getState().recording.state === 'recording');
      await page.waitForTimeout(1000);
      const id = await qari(page, () => window.__qari.engine.getState().recording.id);
      await page.getByTestId('discard').click();
      await page.locator('.sheet button', { hasText: 'Cancel' }).click();
      assert((await engineState(page)).recording.state === 'recording', 'cancel keeps recording');
      await page.getByTestId('discard').click();
      await page.getByTestId('confirm-ok').click();
      await page.waitForFunction(() => window.__qari.engine.getState().recording.state === 'idle');
      await page.waitForTimeout(300);
      assert((await qari(page, (x) => window.__qari.db.getRecording(x), id)) === undefined, 'deleted after confirming');
    });

    await step('Crash during recording: audio is recovered on next launch', async () => {
      await page.goto(`${BASE}#/studio`);
      await ensureMic(page);
      await page.getByTestId('rec-button').click();
      await page.waitForFunction(() => window.__qari.engine.getState().recording.state === 'recording');
      await page.waitForTimeout(3500);
      const id = await qari(page, () => window.__qari.engine.getState().recording.id);
      await page.close({ runBeforeUnload: false });
      page = await ctx.newPage();
      watch(page);
      await page.goto(BASE);
      await page.getByText('Unsaved recording kept safe').waitFor({ timeout: 10000 });
      const m = await qari(page, (x) => window.__qari.db.getRecording(x), id);
      log(`recovered ${m.duration.toFixed(2)} s as ${m.status}`);
      assert(m.status === 'draft' && m.duration >= 1.9, 'recovered at least the flushed audio');
    });

    await step('Accessibility audit (axe-core, WCAG 2 A/AA): both themes, English and Arabic', async () => {
      const axeSrc = readFileSync(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
      const found = [];
      const p = await ctx.newPage();
      await p.goto(BASE);
      for (const theme of ['midnight', 'ivory'])
        for (const lang of ['en', 'ar']) {
          await p.evaluate(([th, lg]) => {
            const raw = JSON.parse(localStorage.getItem('qari-settings') || '{"state":{},"version":1}');
            raw.state = { ...raw.state, theme: th, language: lg };
            localStorage.setItem('qari-settings', JSON.stringify(raw));
          }, [theme, lang]);
          for (const r of ['#/', '#/quran', '#/quran/55', '#/studio', '#/library', `#/recording/${recId}`, '#/presets', '#/settings']) {
            await p.goto(BASE + r);
            await p.reload();
            await p.waitForTimeout(700);
            await p.evaluate(axeSrc);
            const res = await p.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }));
            for (const v of res.violations) found.push(`${theme}/${lang}${r}: ${v.id} — ${v.nodes[0]?.target.join(' ')}`);
          }
        }
      await p.close();
      assert(found.length === 0, `no violations:\n      ${found.join('\n      ')}`);
    });

    await step('Responsive layouts: no overflow on phone/tablet/desktop, both themes, Arabic RTL', async () => {
      const shots = [
        ['mobile-home', 390, 844, 'midnight', 'en', '#/'],
        ['mobile-quran', 390, 844, 'midnight', 'en', '#/quran'],
        ['mobile-surah', 390, 844, 'ivory', 'en', '#/quran/55'],
        ['mobile-studio', 390, 844, 'midnight', 'en', '#/studio'],
        ['mobile-review', 390, 844, 'ivory', 'en', `#/recording/${recId}`],
        ['mobile-library', 390, 844, 'midnight', 'en', '#/library'],
        ['mobile-settings', 390, 844, 'midnight', 'en', '#/settings'],
        ['mobile-home-ar', 390, 844, 'midnight', 'ar', '#/'],
        ['mobile-review-ar', 390, 844, 'midnight', 'ar', `#/recording/${recId}`],
        ['tablet-studio', 820, 1180, 'midnight', 'en', '#/studio'],
        ['tablet-library', 820, 1180, 'ivory', 'en', '#/library'],
        ['desktop-home', 1440, 900, 'midnight', 'en', '#/'],
        ['desktop-studio', 1440, 900, 'midnight', 'en', '#/studio'],
        ['desktop-review', 1440, 900, 'midnight', 'en', `#/recording/${recId}`],
        ['desktop-presets', 1440, 900, 'ivory', 'en', '#/presets'],
        ['desktop-quran', 1440, 900, 'ivory', 'en', '#/quran'],
        ['desktop-studio-ar', 1440, 900, 'ivory', 'ar', '#/studio'],
        ['desktop-settings-ar', 1440, 900, 'midnight', 'ar', '#/settings'],
      ];
      const overflow = [];
      for (const [name, w, h, theme, lang, route] of shots) {
        const p = await ctx.newPage();
        await p.setViewportSize({ width: w, height: h });
        await p.goto(BASE);
        await p.evaluate(([th, lg]) => {
          const raw = JSON.parse(localStorage.getItem('qari-settings') || '{"state":{},"version":1}');
          raw.state = { ...raw.state, theme: th, language: lg, selection: { surah: 67, from: null, to: null }, showTextInStudio: true };
          localStorage.setItem('qari-settings', JSON.stringify(raw));
        }, [theme, lang]);
        await p.goto(BASE + route);
        await p.reload();
        await p.waitForTimeout(1500);
        const sw = await p.evaluate(() => document.documentElement.scrollWidth);
        if (sw > w) overflow.push(`${name}: ${sw}px > ${w}px`);
        await p.screenshot({ path: join(out, `${name}.png`) });
        await p.close();
      }
      assert(overflow.length === 0, `no horizontal overflow (${overflow.join(', ')})`);
    });
  } finally {
    writeFileSync(join(out, 'e2e-results.json'), JSON.stringify({ results, consoleErrors }, null, 2));
    if (consoleErrors.length) console.log(`\nConsole errors:\n  ${consoleErrors.join('\n  ')}`);
    await browser.close().catch(() => undefined);
    server.kill();
  }
}

async function errorScenarios() {
  const server = await startServer(false);
  try {
    await step('Microphone permission denied → clear message', async () => {
      // Full Chromium (not the headless shell) so the permission prompt behaves like a real browser;
      // --deny-permission-prompts answers it exactly as a user pressing "Block".
      const browser = await chromium.launch({ channel: 'chromium', args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] });
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}#/studio`);
      await page.getByTestId('enable-mic').click();
      const err = page.getByTestId('mic-error');
      await err.waitFor({ timeout: 10000 });
      const code = await err.getAttribute('data-code');
      log(`error code ${code}: "${await err.innerText()}"`);
      assert(code === 'denied', 'reported as denied');
      await browser.close();
    });
    await step('No microphone available → clear message', async () => {
      const browser = await chromium.launch({ channel: 'chromium', args: ['--use-fake-ui-for-media-stream'] });
      const ctx = await browser.newContext({ permissions: ['microphone'] });
      const page = await ctx.newPage();
      await page.goto(`${BASE}#/studio`);
      await page.getByTestId('enable-mic').click();
      const err = page.getByTestId('mic-error');
      await err.waitFor({ timeout: 10000 });
      const code = await err.getAttribute('data-code');
      log(`error code ${code}: "${await err.innerText()}"`);
      assert(code === 'notfound' || code === 'busy', 'reported as missing/unavailable');
      await browser.close();
    });
  } finally {
    server.kill();
  }
}

let failed = false;
try {
  await main();
  await errorScenarios();
} catch (e) {
  failed = true;
  console.error(`\nFAILED at: ${current}`);
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} steps passed${failed ? ' — see test-results/e2e-results.json' : ''}`);
process.exit(failed ? 1 : 0);
