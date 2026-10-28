#!/usr/bin/env node
/**
 * Smoke test for a deployed Qari Studio (e.g. GitHub Pages):
 *   node tests/e2e/smoke.mjs https://<user>.github.io/Qari-Studio/
 *
 * Loads the site, opens a surah, records 3 s from Chromium's fake microphone (a synthetic voice),
 * plays it back, exports a WAV, then reloads offline to confirm the service worker serves the app.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { makeVoice, writeWav16 } from './make-voice.mjs';

const BASE = process.argv[2];
if (!BASE) {
  console.error('usage: node tests/e2e/smoke.mjs <url>');
  process.exit(2);
}
const dir = join(tmpdir(), 'qari-smoke');
mkdirSync(dir, { recursive: true });
const voice = join(dir, 'voice.wav');
const v = makeVoice({ seconds: 8 });
writeWav16(voice, v.samples, v.sampleRate);

const check = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`✓ ${msg}`);
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voice}`],
});
const ctx = await browser.newContext({ permissions: ['microphone'], acceptDownloads: true, viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(BASE);
  await page.getByTestId('start-reciting').waitFor({ timeout: 20000 });
  check(true, `app loads at ${BASE}`);

  await page.goto(`${BASE}#/quran/55`);
  await page.locator('.ayah[data-ayah="78"]').waitFor({ timeout: 20000 });
  check((await page.locator('.surah-hero-ar').innerText()) === 'سورة الرحمن', 'Surah Ar-Rahman with its 78 ayahs of Quran text');

  await page.getByTestId('recite-surah').click();
  await page.waitForTimeout(800);
  if ((await page.evaluate(() => window.__qari.engine.getState().input.status)) !== 'on') await page.getByTestId('enable-mic').click();
  await page.waitForFunction(() => window.__qari.engine.getState().input.status === 'on', null, { timeout: 15000 });
  check(true, 'microphone and AudioWorklet engine start');

  await page.getByTestId('rec-button').click();
  await page.waitForTimeout(3000);
  await page.getByTestId('stop').click();
  await page.waitForURL(/#\/recording\//);
  const id = page.url().split('/recording/')[1];
  const meta = await page.evaluate((x) => window.__qari.db.getRecording(x), id);
  check(meta.duration > 2.5 && meta.duration < 3.8, `recorded ${meta.duration.toFixed(2)} s, saved locally`);

  await page.getByTestId('play').click();
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => window.__qari.player.getState().playing), 'plays back through the enhancement chain');

  await page.getByTestId('save').click();
  await page.getByTestId('export').click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('export-download').click()]);
  const file = join(dir, dl.suggestedFilename());
  await dl.saveAs(file);
  const head = readFileSync(file).subarray(0, 4).toString();
  check(head === 'RIFF', `exports ${dl.suggestedFilename()}`);

  const swReady = await page.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const r = await navigator.serviceWorker.getRegistration();
      if (r?.active) return true;
      await new Promise((res) => setTimeout(res, 500));
    }
    return false;
  });
  check(swReady, 'service worker installed (offline support)');
  await ctx.setOffline(true);
  const off = await ctx.newPage();
  await off.goto(`${BASE}#/library`);
  await off.locator(`[data-testid=recording-row][data-id="${id}"]`).waitFor({ timeout: 20000 });
  check(true, 'opens offline and the recording is still in the library');
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
