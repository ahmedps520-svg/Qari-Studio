import {
  ArrowLeft,
  Copy,
  Download,
  GitCompareArrows,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { audioCache } from '../audio/audioCache';
import { computePeaks } from '../audio/dsp/peaks';
import { usePlayer } from '../audio/hooks';
import { player, type ListenVersion } from '../audio/player';
import { paramsEqual, type Preset } from '../audio/presets';
import { recordingPresetName, ExportSheet } from '../components/ExportSheet';
import { useRecordingActions } from '../components/RecordingRow';
import { PresetChips, presetDescription } from '../components/StudioControls';
import { SeekWaveform } from '../components/Waveform';
import { Button, IconButton, Menu, Notice, Segmented, Slider, Switch } from '../components/ui';
import { useT } from '../i18n';
import { activatesFocused } from '../lib/keyboard';
import { getRecording, requestPersist, type RecordingMeta } from '../lib/db';
import { getSurah } from '../lib/quran';
import { back, navigate, useRoute } from '../lib/router';
import { useLibrary } from '../state/library';
import { allPresets, findPreset, usePresets } from '../state/presets';
import { toast } from '../state/ui';

const getTime = () => player.currentTime;
let persistAsked = false;

export function ReviewScreen({ id }: { id: string }) {
  const t = useT();
  const route = useRoute();
  const fromLib = useLibrary((s) => s.recordings.find((r) => r.id === id));
  const upsert = useLibrary((s) => s.upsertLocal);
  const patch = useLibrary((s) => s.patch);
  const custom = usePresets((s) => s.custom);
  const [meta, setMeta] = useState<RecordingMeta | null | undefined>(fromLib);
  const [loadError, setLoadError] = useState(false);
  const [presetId, setPresetId] = useState<string>(fromLib?.presetId ?? '');
  const [params, setParams] = useState(fromLib?.params);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const ps = usePlayer();

  // Load metadata (library may not be loaded yet on a direct visit).
  useEffect(() => {
    let alive = true;
    if (fromLib) {
      setMeta(fromLib);
      return;
    }
    void getRecording(id).then((m) => {
      if (!alive) return;
      setMeta(m ?? null);
      if (m) upsert(m);
    });
    return () => {
      alive = false;
    };
  }, [id, fromLib, upsert]);

  // Initialise the editable enhancement from the recording once.
  useEffect(() => {
    if (meta && !params) {
      setPresetId(meta.presetId);
      setParams(meta.params);
    }
  }, [meta, params]);

  // Load audio into the player.
  useEffect(() => {
    if (!meta) return;
    let alive = true;
    setLoadError(false);
    if (!player.isLoaded(meta.id)) {
      audioCache
        .get(meta.audioId)
        .then(async (samples) => {
          if (!alive) return;
          if (samples.length === 0) throw new Error('empty');
          // If storage held less than was recorded (a failed write), show what is really there.
          if (samples.length < meta.frames) {
            const fixed = await patch(meta.id, { frames: samples.length, duration: samples.length / meta.sampleRate, peaks: computePeaks(samples), incomplete: true });
            if (fixed && alive) setMeta(fixed);
          }
          return player.load(meta.id, samples, meta.sampleRate, params ?? meta.params);
        })
        .catch(() => alive && setLoadError(true));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.id]);

  useEffect(() => () => player.unload(), []);

  // Live preview of the chosen enhancement.
  useEffect(() => {
    if (params && ps.ready && ps.loadedId === id) player.setParamsA(params);
  }, [params, ps.ready, ps.loadedId, id]);

  // Compare mode.
  useEffect(() => {
    if (!ps.ready || ps.loadedId !== id) return;
    const b = compareId ? findPreset(compareId, custom) : null;
    void player.setCompare(b ? b.params : null);
  }, [compareId, ps.ready, ps.loadedId, id, custom]);

  useEffect(() => {
    if (route.query.get('compare') === '1' && meta && !compareId) {
      setCompareId(meta.presetId === 'grand-mosque' ? 'beautiful-plus' : 'grand-mosque');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query, meta?.id]);

  const actions = useRecordingActions(meta ?? ({} as RecordingMeta));

  const togglePlay = useCallback(() => player.toggle(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || document.querySelector('.overlay')) return;
      if (el.getAttribute('role') === 'slider' || activatesFocused(e)) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') player.seek(player.currentTime + 5);
      else if (e.key === 'ArrowLeft') player.seek(player.currentTime - 5);
      else if (e.key.toLowerCase() === 'a') player.setVersion(player.getState().version === 'original' ? 'a' : 'original');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  const preset = findPreset(presetId, custom);
  const dirty = !!meta && !!params && (meta.presetId !== presetId || !paramsEqual(meta.params, params));
  const s = getSurah(meta?.surah);
  const presetLabel = preset ? t.presetName(preset) : meta ? recordingPresetName(t, meta) : '';
  const compareList = useMemo(() => allPresets(custom).filter((p) => p.id !== presetId), [custom, presetId]);
  const compareLabel = compareId ? t.presetName(findPreset(compareId, custom)) : '';

  if (meta === null) {
    return (
      <div className="page narrow">
        <div className="topbar">
          <IconButton className="back" label={t('common.back')} onClick={() => back('/library')}>
            <ArrowLeft />
          </IconButton>
        </div>
        <Notice kind="error">{t('review.notFound')}</Notice>
      </div>
    );
  }
  if (!meta || !params) return <div className="page narrow" aria-busy="true" />;

  const save = async () => {
    const next = await patch(meta.id, {
      status: 'saved',
      presetId,
      presetName: preset ? t.presetName(preset) : meta.presetName,
      params,
    });
    if (next) setMeta(next);
    toast(meta.status === 'saved' ? t('review.changesSaved') : t('review.savedToast'), 'success');
    if (!persistAsked) {
      persistAsked = true;
      void requestPersist();
    }
  };

  const choosePreset = (pid: string) => {
    const p: Preset | undefined = findPreset(pid, custom);
    if (!p) return;
    setPresetId(pid);
    // Returning to the recording's own preset restores its exact saved settings.
    setParams(pid === meta.presetId ? meta.params : p.params);
    if (compareId === pid) setCompareId(null);
    if (player.getState().version === 'original') player.setVersion('a');
  };

  const offsetText = (v: ListenVersion) => {
    const d = player.offsetDb(v);
    return `${d > 0 ? '+' : d < 0 ? '−' : ''}${t.n(Math.abs(d), { maximumFractionDigits: 1 })}`;
  };

  const versionOptions: { value: ListenVersion; label: React.ReactNode }[] = [
    { value: 'original', label: t('review.original') },
    { value: 'a', label: compareId ? <>A · {presetLabel}</> : <>{t('review.enhanced')}</> },
  ];
  if (compareId) versionOptions.push({ value: 'b', label: <>B · {compareLabel}</> });

  return (
    <div className="page review">
      <div className="topbar">
        <IconButton className="back" label={t('common.back')} onClick={() => back('/library')}>
          <ArrowLeft />
        </IconButton>
        <span className="topbar-title">{t('review.title')}</span>
        <span className={`pill ${meta.status === 'saved' ? 'emerald' : 'warn'}`} data-testid="review-status">
          {meta.status === 'saved' ? t('review.saved') : t('review.draft')}
        </span>
        <Menu
          label={t('common.more')}
          trigger={<MoreHorizontal />}
          items={[
            { label: t('common.rename'), icon: <Pencil />, onSelect: () => void actions.rename().then(() => getRecording(meta.id).then((m) => m && setMeta(m))) },
            { label: t('common.duplicate'), icon: <Copy />, onSelect: () => void actions.duplicate() },
            'sep',
            {
              label: t('common.delete'),
              icon: <Trash2 />,
              danger: true,
              onSelect: () => void actions.remove().then((ok) => ok && navigate('/library', { replace: true })),
            },
          ]}
        />
      </div>

      <div className="review-grid">
        <section className="card card-pad review-main">
          <header className="review-head">
            {s ? (
              <>
                <p className="review-ar ar" lang="ar">
                  {t.surahArabic(s)}
                </p>
                <p className="review-en">
                  {t.surahEnglish(s)}
                  {meta.ayahFrom && meta.ayahTo && !(meta.ayahFrom === 1 && meta.ayahTo === s.ayahs)
                    ? ` · ${t('range.label', { from: meta.ayahFrom, to: meta.ayahTo })}`
                    : ''}
                </p>
              </>
            ) : (
              <p className="review-en">{t('studio.free')}</p>
            )}
            <div className="review-title-row">
              <h1 className="review-title" data-testid="review-title">
                {meta.title}
              </h1>
              <IconButton
                size="sm"
                label={t('common.rename')}
                onClick={() => void actions.rename().then(() => getRecording(meta.id).then((m) => m && setMeta(m)))}
                data-testid="rename"
              >
                <Pencil />
              </IconButton>
            </div>
            <p className="faint review-meta">
              <span>{t.date(meta.createdAt, true)}</span>
              <span className="num">{t.duration(meta.duration)}</span>
              <span>{presetLabel}</span>
              {meta.inputLabel && <span>{t('review.recordedWith', { mic: meta.inputLabel })}</span>}
            </p>
          </header>

          {loadError && <Notice kind="error">{t('review.loadError')}</Notice>}
          {meta.incomplete && <Notice kind="warn">{t('review.incomplete')}</Notice>}

          <SeekWaveform
            peaks={meta.peaks}
            duration={meta.duration}
            getTime={getTime}
            onSeek={(x) => player.seek(x)}
            playing={ps.playing}
            height={110}
            label={t('review.seek')}
          />
          <PlayerTime duration={meta.duration} playing={ps.playing} />

          <div className="player-controls">
            <IconButton label={t('review.restart')} onClick={() => player.restart()} disabled={!ps.ready}>
              <RotateCcw />
            </IconButton>
            <IconButton label={t('review.back5')} onClick={() => player.seek(player.currentTime - 5)} disabled={!ps.ready}>
              <SkipBack />
            </IconButton>
            <button
              type="button"
              className="play-btn"
              aria-label={ps.playing ? t('common.pause') : t('common.play')}
              onClick={togglePlay}
              disabled={!ps.ready}
              data-testid="play"
            >
              {ps.loading ? <span className="spinner" /> : ps.playing ? <Pause /> : <Play />}
            </button>
            <IconButton label={t('review.fwd5')} onClick={() => player.seek(player.currentTime + 5)} disabled={!ps.ready}>
              <SkipForward />
            </IconButton>
            <select
              className="select sm speed"
              aria-label={t('review.speed')}
              title={t('review.speedNote')}
              value={ps.rate}
              onChange={(e) => player.setRate(Number(e.target.value))}
            >
              {[0.75, 0.9, 1, 1.1, 1.25].map((r) => (
                <option key={r} value={r}>
                  {t.n(r)}×
                </option>
              ))}
            </select>
          </div>
          <div className="volume-row">
            <Slider
              label={t('review.volume')}
              icon={<Volume2 />}
              min={0}
              max={1.2}
              step={0.01}
              value={ps.volume}
              format={(v) => `${t.n(Math.round(v * 100))}%`}
              onChange={(v) => player.setVolume(v)}
            />
          </div>
        </section>

        <section className="card card-pad review-side">
          <div className="field">
            <span className="field-label">{t('review.listen')}</span>
            <Segmented
              className="block emerald ab-toggle"
              label={t('review.listen')}
              value={ps.version}
              onChange={(v) => player.setVersion(v)}
              options={versionOptions}
            />
          </div>
          <div className="row match-row">
            <div className="grow">
              <div className="label">{t('review.matchLoudness')}</div>
              <div className="sub faint">
                {ps.measuring
                  ? t('review.measuring')
                  : ps.loudnessMatch && ps.loudness.a !== null
                    ? t('review.matchNote', { version: compareId ? 'A' : t('review.enhanced'), db: offsetText('a') }) +
                      (compareId && ps.loudness.b !== null ? ` · B: ${offsetText('b')} dB` : '')
                    : ''}
              </div>
            </div>
            <Switch checked={ps.loudnessMatch} onChange={(v) => player.setLoudnessMatch(v)} label={t('review.matchLoudness')} />
          </div>

          <div className="field">
            <div className="row" style={{ gap: 8 }}>
              <span className="field-label grow">{t('review.preset')}</span>
              {dirty && <span className="pill gold">{t('studio.modified')}</span>}
            </div>
            <PresetChips value={presetId} onChange={choosePreset} />
            <p className="preset-desc">
              <span className="muted">{presetDescription(t, preset)}</span>
            </p>
          </div>

          <div className="field">
            <div className="row" style={{ gap: 10 }}>
              <GitCompareArrows size={18} className="faint" />
              <span className="field-label grow">{t('review.compare')}</span>
              <Switch
                checked={!!compareId}
                label={t('review.compare')}
                onChange={(v) => setCompareId(v ? (compareList.find((p) => p.id === 'grand-mosque') ?? compareList[0])?.id ?? null : null)}
              />
            </div>
            {compareId && (
              <label className="field" style={{ marginTop: 6 }}>
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  {t('review.compareWith')}
                </span>
                <select className="select" value={compareId} onChange={(e) => setCompareId(e.target.value)} data-testid="compare-select">
                  {compareList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t.presetName(p)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <p className="faint nd-note">{t('review.nonDestructive', { preset: presetLabel })}</p>

          <div className="review-actions">
            {(meta.status !== 'saved' || dirty) && (
              <Button variant="primary" size="lg" block icon={<Save />} onClick={() => void save()} data-testid="save">
                {meta.status === 'saved' ? t('review.saveChanges') : t('review.saveToLibrary')}
              </Button>
            )}
            <div className="row" style={{ gap: 10 }}>
              <Button variant="secondary" block icon={<Download />} onClick={() => setExporting(true)} data-testid="export">
                {t('common.export')}
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 />}
                onClick={() => void actions.remove().then((ok) => ok && navigate('/library', { replace: true }))}
                data-testid="delete"
              >
                {t('common.delete')}
              </Button>
            </div>
            {meta.status !== 'saved' && <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{t('review.unsavedLeave')}</p>}
          </div>
        </section>
      </div>

      {exporting && (
        <ExportSheet
          meta={dirty ? { ...meta, presetId, params, presetName: presetLabel } : meta}
          open={exporting}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

function PlayerTime({ duration, playing }: { duration: number; playing: boolean }) {
  const t = useT();
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(player.currentTime);
    const id = setInterval(() => setNow(player.currentTime), playing ? 100 : 400);
    return () => clearInterval(id);
  }, [playing]);
  return (
    <div className="player-time num" dir="ltr">
      <span>{t.duration(now)}</span>
      <span className="faint">{t.duration(duration)}</span>
    </div>
  );
}
