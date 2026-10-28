import { BookOpen, Keyboard, Mic, MicOff, Pause, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine, type EngineErrorCode } from '../audio/engine';
import { useEngine, useFrameValue } from '../audio/hooks';
import { LiveListenPanel, PresetChips, presetDescription, SoundControls, toggleLiveListen } from '../components/StudioControls';
import { ReadingView } from '../components/ReadingView';
import { RecitePicker, SurahNumber } from '../components/SurahPicker';
import { LevelMeter, LiveWaveform } from '../components/Waveform';
import { Button, IconButton, Notice, Sheet } from '../components/ui';
import { useT, type MessageKey, type T } from '../i18n';
import { getRecording } from '../lib/db';
import { getSurah, type Surah } from '../lib/quran';
import { navigate, useRoute } from '../lib/router';
import { useLibrary } from '../state/library';
import { allPresets, findPreset, usePresets } from '../state/presets';
import { useSettings, type Selection } from '../state/settings';
import { isModified, useStudio } from '../state/studio';
import { ask, toast } from '../state/ui';

export function selectionTitle(t: T, sel: Selection): string {
  const s = getSurah(sel.surah);
  if (!s) return t('studio.free');
  const base = t.lang === 'ar' ? t.surahArabic(s) : t.surahEnglish(s);
  if (sel.from && sel.to && !(sel.from === 1 && sel.to === s.ayahs)) {
    return `${base} · ${sel.from === sel.to ? t('range.single', { n: sel.from }) : t('range.label', { from: sel.from, to: sel.to })}`;
  }
  return base;
}

function rangeText(t: T, s: Surah, sel: Selection): string | null {
  if (!sel.from || !sel.to || (sel.from === 1 && sel.to === s.ayahs)) return null;
  return sel.from === sel.to ? t('range.single', { n: sel.from }) : t('range.label', { from: sel.from, to: sel.to });
}

function errorKey(code: EngineErrorCode | null): MessageKey {
  return `err.${code ?? 'unknown'}` as MessageKey;
}

const typingTarget = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

export function StudioScreen() {
  const t = useT();
  const route = useRoute();
  const sel = useSettings((s) => s.selection);
  const showText = useSettings((s) => s.showTextInStudio);
  const recordingFormat = useSettings((s) => s.recordingFormat);
  const setSettings = useSettings((s) => s.set);
  const st = useEngine();
  const presetId = useStudio((s) => s.presetId);
  const params = useStudio((s) => s.params);
  const selectPreset = useStudio((s) => s.selectPreset);
  const custom = usePresets((s) => s.custom);
  const upsert = useLibrary((s) => s.upsertLocal);
  const lastSavedAt = useLibrary((s) => s.lastSavedAt);
  const [, forceTick] = useState(0);
  const remove = useLibrary((s) => s.remove);
  const [picker, setPicker] = useState(false);
  const [help, setHelp] = useState(false);
  const [levelStatus, setLevelStatus] = useState<'ok' | 'clip' | 'quiet' | 'none'>('none');
  const livePanelRef = useRef<HTMLDivElement>(null);

  const surah = getSurah(sel.surah);
  const preset = findPreset(presetId, custom);
  const modified = isModified(presetId, params);
  const rec = st.recording.state;
  const recording = rec === 'recording';
  const paused = rec === 'paused';
  const busy = rec === 'starting' || rec === 'stopping';
  const active = recording || paused;
  const micOn = st.input.status === 'on';
  const analyser = micOn ? engine.getInputAnalyser() : null;
  const seconds = useFrameValue(() => engine.getRecordedSeconds(), recording, 100);

  // Open the microphone automatically when it is already permitted and the user has interacted.
  useEffect(() => {
    const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? false;
    if (st.input.status === 'off' && st.permission === 'granted' && activated) void engine.openInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.permission]);

  // Release the microphone when leaving the Studio (unless a take is in progress).
  useEffect(
    () => () => {
      const r = engine.getState().recording.state;
      if (r === 'idle') engine.closeInput();
    },
    [],
  );

  useEffect(() => {
    if (route.query.get('panel') === 'live') {
      setTimeout(() => livePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
      livePanelRef.current?.classList.add('highlight');
      setTimeout(() => livePanelRef.current?.classList.remove('highlight'), 1800);
    }
  }, [route.query]);

  const start = useCallback(async () => {
    if (engine.getState().input.status !== 'on') await engine.openInput();
    if (engine.getState().input.status !== 'on') return;
    const { params: p, presetId: pid } = useStudio.getState();
    const pr = findPreset(pid);
    const id = await engine.startRecording({
      title: selectionTitle(t, sel),
      surah: sel.surah,
      ayahFrom: sel.surah ? sel.from : null,
      ayahTo: sel.surah ? sel.to : null,
      presetId: pid,
      presetName: pr ? t.presetName(pr) : '',
      params: p,
      format: recordingFormat,
    });
    if (!id && engine.getState().recording.interruption === 'storage') toast(t('rec.startFailed'), 'error');
  }, [t, sel, recordingFormat]);

  const stop = useCallback(async () => {
    const take = await engine.stopRecording();
    if (!take) return;
    const m = await getRecording(take.id);
    if (m) upsert(m);
    navigate(`/recording/${take.id}`);
  }, [upsert]);

  const discard = useCallback(async () => {
    const ok = await ask({ title: t('studio.discardTitle'), body: t('studio.discardBody'), confirmLabel: t('studio.discardConfirm'), danger: true });
    if (!ok) return;
    const take = await engine.stopRecording();
    if (take) await remove(take.id);
    toast(t('studio.discarded'));
  }, [t, remove]);

  const primary = useCallback(async () => {
    const r = engine.getState().recording.state;
    if (r === 'idle') await start();
    else if (r === 'recording') await engine.pauseRecording();
    else if (r === 'paused') {
      if (engine.getState().input.status !== 'on') await engine.openInput();
      await engine.resumeRecording();
    }
  }, [start]);

  // Keyboard shortcuts (desktop).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingTarget(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.overlay')) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'r') {
        e.preventDefault();
        void primary();
      } else if (k === 's' || k === 'enter') {
        if (engine.getState().recording.state !== 'idle') {
          e.preventDefault();
          void stop();
        }
      } else if (k === 'l') {
        void toggleLiveListen(t, !engine.getState().live.enabled);
      } else if (k === 'b' && !e.repeat) {
        engine.setBypass(true);
      } else if (k === 't') {
        setSettings({ showTextInStudio: !useSettings.getState().showTextInStudio });
      } else if (k === '?') {
        setHelp(true);
      } else if (/^[1-9]$/.test(k)) {
        const list = allPresets(usePresets.getState().custom);
        const p = list[Number(k) - 1];
        if (p) selectPreset(p.id);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && !typingTarget(e)) engine.setBypass(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [primary, stop, t, selectPreset, setSettings]);

  const justSaved = rec === 'idle' && Date.now() - lastSavedAt < 8000;
  useEffect(() => {
    if (!justSaved) return;
    const id = setTimeout(() => forceTick((x) => x + 1), 8000 - (Date.now() - lastSavedAt) + 50);
    return () => clearTimeout(id);
  }, [justSaved, lastSavedAt]);
  const stateKey: MessageKey = justSaved
    ? 'state.saved'
    : !micOn && !active
    ? 'state.micOff'
    : rec === 'starting'
      ? 'state.starting'
      : rec === 'stopping'
        ? 'state.processing'
        : recording
          ? 'state.recording'
          : paused
            ? 'state.paused'
            : 'state.ready';
  const stateClass = justSaved ? 'gold' : recording ? 'rec' : paused ? 'warn' : rec === 'stopping' ? 'gold' : micOn ? 'emerald' : '';

  const waveMode = recording ? 'recording' : paused ? 'paused' : micOn ? 'live' : 'idle';
  const interruption = st.recording.interruption;
  const description = useMemo(() => presetDescription(t, preset), [t, preset]);

  return (
    <div className="page wide studio">
      <div className={`studio-grid ${surah && showText ? 'with-text' : ''}`}>
        {/* ---------------------------------------------------------------- Surah & text */}
        <aside className="studio-left">
          <div className="studio-surah card card-pad">
            {surah ? <SurahNumber n={surah.n} /> : <span className="free-icon"><Mic /></span>}
            <div className="grow">
              {surah ? (
                <>
                  <h1 className="studio-ar ar" lang="ar" data-testid="studio-surah-ar">
                    {t.surahArabic(surah)}
                  </h1>
                  <p className="studio-en">{t.surahEnglish(surah)}</p>
                  <p className="faint studio-meta">
                    {t('surah.number', { n: surah.n })} · {t.plural('unit.ayah', surah.ayahs)}
                    {rangeText(t, surah, sel) ? ` · ${rangeText(t, surah, sel)}` : ''}
                  </p>
                </>
              ) : (
                <>
                  <h1 className="studio-en" style={{ fontSize: 'var(--fs-xl)' }}>
                    {t('studio.free')}
                  </h1>
                  <p className="faint studio-meta">{t('studio.freeSub')}</p>
                </>
              )}
            </div>
            <div className="studio-surah-actions">
              {surah && (
                <IconButton
                  label={showText ? t('reading.hide') : t('reading.show')}
                  className={showText ? 'active' : ''}
                  onClick={() => setSettings({ showTextInStudio: !showText })}
                >
                  <BookOpen />
                </IconButton>
              )}
              <Button size="sm" variant="secondary" disabled={active || busy} onClick={() => setPicker(true)}>
                {t('common.change')}
              </Button>
            </div>
          </div>
          {surah && showText && (
            <div className="card card-pad studio-reading">
              <ReadingView surah={surah} from={sel.from} to={sel.to} compact onHide={() => setSettings({ showTextInStudio: false })} />
            </div>
          )}
        </aside>

        {/* ---------------------------------------------------------------- Recorder */}
        <section className="studio-center card" aria-label={t('studio.title')}>
          <div className="studio-status">
            <span className={`pill ${stateClass}`} role="status" aria-live="polite" data-testid="rec-state">
              {(recording || paused) && <span className={`dot ${recording ? 'pulse' : ''}`} />}
              {t(stateKey)}
            </span>
            <div className="grow" />
            {micOn ? (
              <div className="studio-input">
                <Mic size={16} />
                <span className="truncate">{st.input.label || t('studio.micReady')}</span>
                {st.input.sampleRate && <span className="faint num">{t.n(st.input.sampleRate / 1000, { maximumFractionDigits: 1 })} kHz</span>}
              </div>
            ) : (
              active && (
                <div className="studio-input">
                  <MicOff size={16} />
                  <span>{t('state.micOff')}</span>
                </div>
              )
            )}
          </div>

          <div className="timer num" aria-label={t('state.recording')} data-testid="rec-timer">
            {t.duration(active ? seconds : rec === 'stopping' ? seconds : 0, true)}
          </div>

          <div className="wave-wrap">
            <LiveWaveform analyser={analyser} mode={waveMode} height={200} />
            {!micOn && !active && (
              <div className="wave-overlay">
                {st.input.status === 'error' ? (
                  <Notice
                    kind="error"
                    actions={
                      <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => void engine.openInput()}>
                        {t('common.retry')}
                      </Button>
                    }
                  >
                    <span data-testid="mic-error" data-code={st.input.error ?? ''}>{t(errorKey(st.input.error))}</span>
                  </Notice>
                ) : (
                  <>
                    <p className="muted">{t('studio.micPrompt')}</p>
                    <Button
                      variant="primary"
                      icon={st.input.status === 'opening' ? <span className="spinner" /> : <Mic />}
                      disabled={st.input.status === 'opening'}
                      onClick={() => void engine.openInput()}
                      data-testid="enable-mic"
                    >
                      {st.input.status === 'opening' ? t('studio.micOpening') : t('studio.enableMic')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="meter-row">
            <span className="faint meter-caption">{t('studio.inputLevel')}</span>
            <LevelMeter analyser={analyser} onStatus={setLevelStatus} />
          </div>
          {micOn && levelStatus === 'clip' && <p className="level-hint warn">{t('studio.clip')}</p>}
          {micOn && levelStatus === 'quiet' && recording && <p className="level-hint">{t('studio.tooQuiet')}</p>}

          {interruption && (
            <Notice
              kind={interruption === 'storage' ? 'error' : 'warn'}
              actions={
                paused && interruption !== 'storage' ? (
                  <Button size="sm" variant="secondary" onClick={() => void primary()}>
                    {t('studio.resume')}
                  </Button>
                ) : undefined
              }
            >
              {t(interruption === 'disconnected' ? 'rec.disconnected' : interruption === 'interrupted' ? 'rec.interrupted' : 'rec.storage')}
            </Notice>
          )}

          <div className="transport">
            <div className="transport-side">
              {active && (
                <Button variant="ghost" icon={<Trash2 />} onClick={() => void discard()} data-testid="discard">
                  {t('studio.discard')}
                </Button>
              )}
            </div>
            <button
              type="button"
              className={`rec-btn ${recording ? 'recording' : paused ? 'paused' : ''}`}
              onClick={() => void primary()}
              disabled={busy || (st.input.status === 'opening')}
              aria-label={recording ? t('studio.pause') : paused ? t('studio.resume') : t('studio.record')}
              data-testid="rec-button"
            >
              <span className="rec-btn-ring" />
              <span className="rec-btn-core">
                {busy ? <span className="spinner" /> : recording ? <Pause /> : paused ? <Play /> : <span className="rec-dot-icon" />}
              </span>
            </button>
            <div className="transport-side end">
              {active && (
                <Button variant="secondary" icon={<Square />} onClick={() => void stop()} data-testid="stop">
                  {t('studio.stop')}
                </Button>
              )}
            </div>
          </div>
          <p className="transport-label">{recording ? t('studio.pause') : paused ? t('studio.resume') : t('studio.record')}</p>

          <div className="studio-preset">
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <span className="eyebrow">{t('studio.preset')}</span>
              {modified && <span className="pill gold">{t('studio.modified')}</span>}
              <div className="grow" />
              <IconButton size="sm" label={t('studio.shortcuts')} onClick={() => setHelp(true)} className="kbd-help">
                <Keyboard />
              </IconButton>
            </div>
            <PresetChips value={presetId} onChange={selectPreset} modified={modified} />
            <p className="preset-desc" data-testid="preset-desc">
              <strong>{t.presetName(preset)}</strong>
              <span className="muted"> — {description}</span>
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Monitoring & sound */}
        <aside className="studio-right">
          <div ref={livePanelRef} className="card card-pad live-card">
            <LiveListenPanel />
          </div>
          <div className="card card-pad">
            <SoundControls />
          </div>
        </aside>
      </div>

      <RecitePicker
        open={picker}
        onClose={() => setPicker(false)}
        initial={sel}
        onPick={(s) => {
          setPicker(false);
          setSettings({ selection: s, ...(s.surah ? { lastSurahVisited: s.surah } : {}) });
        }}
      />

      <Sheet open={help} onClose={() => setHelp(false)} title={t('studio.shortcuts')} width="narrow">
        <dl className="shortcuts">
          {(
            [
              ['Space · R', 'shortcut.record'],
              ['S · Enter', 'shortcut.stop'],
              ['L', 'shortcut.live'],
              ['B', 'shortcut.bypass'],
              ['1 – 9', 'shortcut.presets'],
              ['T', 'shortcut.text'],
              ['?', 'shortcut.help'],
            ] as [string, MessageKey][]
          ).map(([k, label]) => (
            <div key={k}>
              <dt>
                <kbd dir="ltr">{k}</kbd>
              </dt>
              <dd>{t(label)}</dd>
            </div>
          ))}
        </dl>
      </Sheet>
    </div>
  );
}
