# Qari Studio

A Quran recitation studio for the web. Recite in your own voice, hear yourself live through headphones with natural, studio-quality enhancement, and keep every recitation privately on your device.

- **Live Listen.** Real-time monitoring through headphones, using the same effects chain as the recordings.
- **Nine vocal presets.** Plain Vanilla, Soft Echo, Beautiful +, Grand Mosque, Studio Qari, Warm & Deep, Pure Voice, Cinematic Space, and your own custom presets. Each one is a different configuration of a real processing chain.
- **Recording studio.** Record, pause and resume. Then review, A/B compare against your original voice (loudness-matched), compare two presets, rename, duplicate and export (WAV, M4A where the browser supports AAC, MP3).
- **The Quran.** All 114 surahs, with verified Tanzil Uthmani text in a reading mode. Search by Arabic name, English name or number. Recordings are organized by surah and ayah range.
- **Two themes.** Midnight Emerald and Sacred Ivory, plus a System option.
- **Two languages.** English and Arabic, with full right-to-left layout.
- **Installable and offline.** It works as an installable PWA and runs fully offline.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/ (static files — host anywhere)
npm run preview      # serve the production build
```

The microphone needs a secure context: `https://` or `http://localhost`.

## Tests

```bash
npm test             # unit tests: DSP, AudioWorklet processors, storage, Quran data, search, files
npm run test:e2e     # end-to-end workflow in Chromium with a synthetic voice as the microphone
npm run typecheck
```

The end-to-end suite (`tests/e2e/run-e2e.mjs`) drives the production build in Chromium. It feeds a synthesized, voice-like signal in as the microphone through Chromium's fake capture device, so the whole real pipeline runs. It covers the full workflow:

open the app → select Surah Ar-Rahman → studio → Live Listen (with the headphone confirmation) → Beautiful + → verify the live audio is processed → record, pause and resume → stop → play → compare original and enhanced → switch to Grand Mosque → save → find it in My Recordings → rename → export WAV, MP3 and the original WAV → close and reopen, including offline → it is still there and plays.

It also checks:

- each preset measurably differs from the others
- the limiter holds peaks at or below −1 dBFS
- extreme echo feedback decays instead of running away
- a denied microphone permission and a missing microphone each show a clear message
- a microphone unplugged mid-recording pauses the recording safely, and it resumes afterwards
- discarding asks for confirmation
- a recording interrupted by a crash or closed tab is recovered on the next launch
- Vocal Presets can be auditioned using your own recording
- a backup → delete-all → restore cycle brings back the audio sample-exact
- 18 layouts (phone, tablet and desktop; both themes; Arabic RTL) have no horizontal overflow
- an axe-core accessibility audit (WCAG 2 A/AA) finds no violations on 8 screens, in both themes and both languages

The unit tests also cover storage robustness against an in-memory IndexedDB: a failed chunk write is retried with no gap, restoring never overwrites audio shared with a duplicate, and 16-bit takes round-trip bit-exactly.

The suite writes screenshots and exported files to `test-results/`.

## How the audio works

Everything is real Web Audio processing. Nothing is simulated or prerecorded.

```
mic ─► input gain ─┬─► recorder worklet ──► IndexedDB (original, chunked every ~2 s)
                   ├─► analyser (waveform, level meter)
                   └─► voice chain ─► monitor gain ─► headphones          (Live Listen)

voice chain:  high-pass ─► [spectral noise reduction]* ─► expander + compressor ─► EQ
              (warmth · de-mud · mid · presence · air) ─┬─► dry ────────────────────────┐
                                                        ├─► echo (feedback delay) ─┐    ├─► output level ─► look-ahead limiter
                                                        └─► reverb (pre-delay ─► convolution) ─► M/S width ┘

* spectral noise reduction runs on recordings only (it adds 21 ms of latency); live monitoring
  uses the zero-latency expander.
```

- **One chain, three uses.** The same `createVoiceChain` serves live monitoring, real-time preview of recordings and offline export rendering, so what you hear is what you export.
- **AudioWorklet processors** (`public/worklets/qari-processors.js`) do the following on the audio thread:
  - a sample-accurate recorder; the recording timer counts captured audio frames, not animation frames
  - an adaptive downward expander and a soft-knee compressor
  - an STFT spectral noise reducer that uses a noise profile measured from the pauses in your own recording
  - a 1.5 ms look-ahead brickwall limiter with a feedback guard, which mutes Live Listen on sustained overload (howling)
- **Reverb** uses procedurally generated, deterministic stereo impulse responses: early reflections spaced by room size, then a decorrelated tail with frequency-dependent decay. Damping darkens the tail as it fades.
- **Non-destructive.** The original take is stored unmodified. A preset is stored as parameters and applied at playback and export. Duplicates share the same original audio.
- **A/B comparison** feeds one media element into parallel paths: original (latency-aligned), preset A and preset B. Switching keeps the exact position. Loudness matching measures each version with BS.1770 integrated loudness and applies only a static gain, and the UI shows the gain it applied.
- **Speed control** (0.75×–1.25×) preserves pitch.

### Live monitoring latency (honest notes)

Qari Studio asks the browser for its lowest-latency audio path. It also turns off echo cancellation, auto-gain and (by default) noise suppression, which add delay and colour the voice. Settings offers Lowest, Balanced and Stable buffer modes.

The delay shown in Live Listen is what the browser reports (input + processing + output). It is labelled as an estimate.

- **Wired or USB-C headphones on desktop Chrome or Edge** usually give the lowest delay a browser can achieve. In the automated test environment (Chromium with fake devices) it reported about 52 ms. Real hardware varies: many desktop setups land around 20–40 ms. Sub-30 ms is possible on some systems, but it is not guaranteed.
- **Bluetooth headphones** add roughly 100–300 ms that no browser can see or remove. The app warns about this.
- **Bluetooth headset microphones** often switch the system to hands-free (telephone-quality) mode. The app detects telephone-rate input and suggests using the built-in microphone with the headset for listening.
- **Mobile browsers.** iOS Safari and Android Chrome add more latency, and may stop audio when the app is in the background. Recording keeps the screen awake where the Wake Lock API exists. Interruptions such as calls pause the recording safely.
- **Truly native latency** (around 10 ms) would need a native app, for example a Capacitor or Swift/Kotlin shell around the same DSP. That is not claimed here.

Live Listen is never routed to the speakers silently. It requires a headphone confirmation unless the output device is identified as headphones.

### Formats

- **WAV.** 24-bit or 16-bit (TPDF-dithered). Always available.
- **MP3.** LAME (lamejs) in a Web Worker. Always available.
- **M4A (AAC).** Encoded with WebCodecs and muxed with mp4-muxer, offered only where the browser can encode AAC. Some Chromium builds on Linux cannot, and the option is then shown as unavailable rather than faked.

Original recordings are stored as 32-bit float (Studio) or 16-bit (Standard) PCM, which you choose in Settings → Audio.

## Quran data

- **Text.** Tanzil Quran Text (Uthmani, Version 1.1), © Tanzil Project, CC BY 3.0 — https://tanzil.net. It is copied verbatim and only restructured from XML to JSON. The copyright notice is kept in `src/data/quran-uthmani.json` and `src/data/QURAN-TEXT-LICENSE.txt`, and a SHA-256 checksum is verified by the tests. The text is never Unicode-normalized: Tanzil's shadda-before-fatha order is not NFC, and changing it would change the published text.
- **Metadata.** Arabic names, ayah counts, revelation classification and order come from Tanzil. Common English transliterations (for example "Ar-Rahman", "Al-Mulk") come from the Quran.com API. `scripts/build-quran-data.mjs` downloads both sources and cross-checks every surah (names, ayah counts, basmala, revelation order, the 6,236-ayah total) before writing the JSON.
- **No translation** is displayed. Ayah ranges are chosen by the reciter and saved with the recording. Qari Studio does not detect ayahs automatically, and it does not check tajweed or pronunciation.

To regenerate the data:

```bash
npm run data:quran
```

## Privacy

There is no account, no server, no analytics and no uploads. Recordings live in IndexedDB in your browser on your device. Settings → Storage shows usage, requests protection from automatic cleanup, and backs everything up to (or restores from) a single `.zip` of lossless WAV originals with their metadata. Settings → Privacy can delete everything.

## Project layout

```
src/audio/        engine (devices, mic, Live Listen, recording), chain, player, render, export, DSP, encoders
public/worklets/  AudioWorklet processors (audio thread)
src/data/         verified Quran text and surah metadata (generated)
src/screens/      Home, Quran, Surah, Studio, Review, Library, Presets, Settings, Info
src/components/   design-system components, waveforms, pickers, Live Listen and sound controls
src/i18n/         English and Arabic strings (type-checked for completeness)
src/lib/          IndexedDB storage, router, Quran search, file names, backup, crash recovery
tests/unit/       Vitest unit tests (the real worklet code runs in a Node sandbox)
tests/e2e/        end-to-end workflow with a fake microphone
```
