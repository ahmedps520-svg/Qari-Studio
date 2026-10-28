import { Check, Copy, Headphones, MoreHorizontal, Pause, Pencil, Play, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { audioCache } from '../audio/audioCache';
import { usePlayer } from '../audio/hooks';
import { clampParams, type ParamKey, type VoiceParams } from '../audio/params';
import { player } from '../audio/player';
import { BUILT_IN_PRESETS, type Preset } from '../audio/presets';
import { PresetGlyph } from '../components/Brand';
import { AdvancedControls, presetDescription } from '../components/StudioControls';
import { Button, Menu, Notice, Sheet } from '../components/ui';
import { useT, type MessageKey } from '../i18n';
import { getSurah } from '../lib/quran';
import { navigate } from '../lib/router';
import { useLibrary } from '../state/library';
import { allPresets, findPreset, usePresets } from '../state/presets';
import { useSettings } from '../state/settings';
import { useStudio } from '../state/studio';
import { ask, askText, toast } from '../state/ui';

const AUDITION_ID = (recId: string) => `audition:${recId}`;

export function PresetsScreen() {
  const t = useT();
  const recordings = useLibrary((s) => s.recordings);
  const custom = usePresets((s) => s.custom);
  const store = usePresets();
  const studioPreset = useStudio((s) => s.presetId);
  const selectPreset = useStudio((s) => s.selectPreset);
  const defaultPresetId = useSettings((s) => s.defaultPresetId);
  const setSettings = useSettings((s) => s.set);
  const ps = usePlayer();
  const usable = useMemo(() => recordings.filter((r) => r.status !== 'recording' && r.duration > 0.5), [recordings]);
  const [recId, setRecId] = useState<string>('');
  const [audition, setAudition] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; params: VoiceParams; base: string } | null>(null);

  useEffect(() => {
    if (!recId && usable[0]) setRecId(usable[0].id);
  }, [usable, recId]);
  useEffect(() => () => player.unload(), []);

  const rec = usable.find((r) => r.id === recId);
  const auditionLoaded = rec ? ps.loadedId === AUDITION_ID(rec.id) && ps.ready : false;
  const playingPreset = auditionLoaded && ps.playing ? audition : null;

  const preview = async (p: Preset, params: VoiceParams = p.params) => {
    if (!rec) return;
    setAudition(p.id);
    if (auditionLoaded) {
      player.setParamsA(params);
      player.setVersion('a');
      if (!ps.playing) await player.play();
      else if (audition === p.id) player.pause();
      return;
    }
    const samples = await audioCache.get(rec.audioId);
    await player.load(AUDITION_ID(rec.id), samples, rec.sampleRate, params);
    await player.play();
  };

  const createFrom = (base: Preset) =>
    setEditing({ id: null, name: t('presets.defaultName'), params: { ...base.params }, base: base.id });

  const saveEditing = async () => {
    if (!editing) return;
    if (editing.id) {
      store.update(editing.id, { name: editing.name, params: editing.params });
      if (studioPreset === editing.id) useStudio.getState().setParams(editing.params);
    } else {
      const p = store.create(editing.name || t('presets.defaultName'), editing.params);
      setAudition(p.id);
    }
    setEditing(null);
    toast(t('presets.saved'), 'success');
  };

  const removePreset = async (p: Preset) => {
    const ok = await ask({ title: t('presets.deleteTitle', { name: p.name ?? '' }), body: t('presets.deleteBody'), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    store.remove(p.id);
    if (studioPreset === p.id) selectPreset('beautiful-plus');
    if (defaultPresetId === p.id) setSettings({ defaultPresetId: 'beautiful-plus' });
    toast(t('presets.deleted'));
  };

  const card = (p: Preset) => {
    const isPlaying = playingPreset === p.id;
    const inUse = studioPreset === p.id;
    const traits = p.builtIn ? t(`preset.${p.id}.traits` as MessageKey).split(' · ') : [];
    return (
      <article key={p.id} className={`preset-card ${isPlaying ? 'playing' : ''} ${inUse ? 'in-use' : ''}`} data-preset={p.id}>
        <div className="preset-card-top">
          <span className="preset-card-icon">
            <PresetGlyph icon={p.icon} />
          </span>
          <div className="grow">
            <h3 className="preset-card-name">{t.presetName(p)}</h3>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {inUse && <span className="pill emerald">{t('presets.inUse')}</span>}
              {defaultPresetId === p.id && <span className="pill gold">{t('presets.default')}</span>}
            </div>
          </div>
          <Menu
            label={t('common.more')}
            trigger={<MoreHorizontal />}
            items={[
              { label: t('presets.setDefault'), icon: <Star />, onSelect: () => setSettings({ defaultPresetId: p.id }), disabled: defaultPresetId === p.id },
              {
                label: t('common.duplicate'),
                icon: <Copy />,
                onSelect: () => {
                  const copy = store.create(t('presets.copyName', { name: t.presetName(p) }), p.params);
                  toast(t('presets.saved'), 'success');
                  setAudition(copy.id);
                },
              },
              ...(!p.builtIn
                ? ([
                    { label: t('common.edit'), icon: <Pencil />, onSelect: () => setEditing({ id: p.id, name: p.name ?? '', params: { ...p.params }, base: p.id }) },
                    {
                      label: t('common.rename'),
                      icon: <Pencil />,
                      onSelect: async () => {
                        const name = await askText({ title: t('common.rename'), label: t('presets.name'), initial: p.name ?? '', confirmLabel: t('common.save'), maxLength: 40 });
                        if (name) store.update(p.id, { name });
                      },
                    },
                    'sep',
                    { label: t('common.delete'), icon: <Trash2 />, danger: true, onSelect: () => void removePreset(p) },
                  ] as const)
                : []),
            ]}
          />
        </div>
        <p className="preset-card-desc">{presetDescription(t, p)}</p>
        {traits.length > 0 && (
          <ul className="traits">
            {traits.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        <div className="preset-card-actions">
          <Button
            size="sm"
            variant={isPlaying ? 'gold' : 'secondary'}
            icon={isPlaying ? <Pause /> : <Play />}
            disabled={!rec}
            onClick={() => void preview(p)}
            data-testid={`preview-${p.id}`}
          >
            {isPlaying ? t('presets.stopPreview') : t('presets.preview')}
          </Button>
          <Button
            size="sm"
            variant={inUse ? 'ghost' : 'primary'}
            icon={inUse ? <Check /> : undefined}
            disabled={inUse}
            onClick={() => {
              selectPreset(p.id);
              navigate('/studio');
            }}
          >
            {inUse ? t('presets.inUse') : t('presets.use')}
          </Button>
        </div>
      </article>
    );
  };

  const recLabel = (r: (typeof usable)[number]) => {
    const s = getSurah(r.surah);
    return `${r.title}${s ? '' : ''} · ${t.duration(r.duration)}`;
  };

  return (
    <div className="page presets">
      <header className="presets-head">
        <h1 className="page-title">{t('presets.title')}</h1>
        <p className="page-sub">{t('presets.subtitle')}</p>
      </header>

      <div className="card card-pad audition">
        {rec ? (
          <div className="audition-row">
            <span className="audition-icon">
              <Headphones />
            </span>
            <label className="field grow">
              <span className="field-label">{t('presets.audition')}</span>
              <select
                className="select"
                value={recId}
                onChange={(e) => {
                  player.unload();
                  setRecId(e.target.value);
                }}
              >
                {usable.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {i === 0 ? `${t('presets.auditionLatest')} — ` : ''}
                    {recLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            {auditionLoaded && ps.playing && (
              <Button variant="secondary" icon={<Pause />} onClick={() => player.pause()}>
                {t('common.pause')}
              </Button>
            )}
          </div>
        ) : (
          <Notice
            kind="info"
            actions={
              <Button size="sm" variant="primary" icon={<Headphones />} onClick={() => navigate('/studio?panel=live')}>
                {t('presets.tryLive')}
              </Button>
            }
          >
            {t('presets.auditionNone')} {t('presets.auditionLive')}
          </Notice>
        )}
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{t('presets.builtIn')}</h2>
        </div>
        <div className="preset-grid">{BUILT_IN_PRESETS.map(card)}</div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{t('presets.custom')}</h2>
          <Button size="sm" variant="gold" icon={<Plus />} onClick={() => createFrom(findPreset(studioPreset) ?? BUILT_IN_PRESETS[2])}>
            {t('presets.create')}
          </Button>
        </div>
        {custom.length > 0 ? (
          <div className="preset-grid">{custom.map(card)}</div>
        ) : (
          <div className="card-quiet empty-inline">
            <p className="muted">{t('presets.customEmpty')}</p>
          </div>
        )}
      </section>

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('presets.edit') : t('presets.create')}
        width="wide"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            {rec && editing && (
              <Button
                variant="secondary"
                icon={<Play />}
                onClick={() => void preview({ id: editing.id ?? 'editing', builtIn: false, icon: 'custom', params: editing.params, name: editing.name }, editing.params)}
              >
                {t('presets.preview')}
              </Button>
            )}
            <Button variant="primary" onClick={() => void saveEditing()} disabled={!editing?.name.trim()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="stack" style={{ gap: 18 }}>
            <label className="field">
              <span className="field-label">{t('presets.name')}</span>
              <input
                className="input"
                value={editing.name}
                maxLength={40}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                data-autofocus
              />
            </label>
            {!editing.id && (
              <label className="field">
                <span className="field-label">{t('presets.basedOn')}</span>
                <select
                  className="select"
                  value={editing.base}
                  onChange={(e) => {
                    const b = findPreset(e.target.value);
                    if (b) setEditing({ ...editing, base: b.id, params: { ...b.params } });
                  }}
                >
                  {allPresets(custom).map((p) => (
                    <option key={p.id} value={p.id}>
                      {t.presetName(p)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <AdvancedControls
              params={editing.params}
              onChange={(k: ParamKey, v: number) => {
                const params = clampParams({ ...editing.params, [k]: v });
                setEditing({ ...editing, params });
                if (auditionLoaded && ps.playing) player.setParamsA(params);
              }}
            />
          </div>
        )}
      </Sheet>
    </div>
  );
}
