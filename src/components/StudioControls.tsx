import { AlertTriangle, AudioLines, Bluetooth, ChevronDown, Ear, Headphones, Mic, RotateCcw, Save, Speaker, Volume2, Waves } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { engine } from '../audio/engine';
import { useEngine, useLatency } from '../audio/hooks';
import { PARAM_SPECS, type ParamKey, type VoiceParams } from '../audio/params';
import type { Preset } from '../audio/presets';
import { useT, type MessageKey, type T } from '../i18n';
import { allPresets, usePresets } from '../state/presets';
import { useSettings } from '../state/settings';
import { isModified, useStudio } from '../state/studio';
import { ask, askText, toast } from '../state/ui';
import { PresetGlyph } from './Brand';
import { Button, Notice, Slider, Switch } from './ui';
import type { DeviceKind } from '../audio/devices';

export function formatParam(t: T, key: ParamKey, v: number): string {
  const spec = PARAM_SPECS[key];
  switch (spec.unit) {
    case 'dB':
      return `${v > 0 ? '+' : v < 0 ? '−' : ''}${t.n(Math.abs(v), { maximumFractionDigits: 1 })} dB`;
    case 'Hz':
      return v >= 1000 ? `${t.n(v / 1000, { maximumFractionDigits: 1 })} kHz` : `${t.n(Math.round(v))} Hz`;
    case 'ms':
      return `${t.n(Math.round(v))} ms`;
    case 's':
      return `${t.n(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
    case 'x':
    case '%':
      return `${t.n(Math.round(v * 100))}%`;
    default:
      return t.n(v);
  }
}

export function PresetChips({
  value,
  onChange,
  modified,
}: {
  value: string;
  onChange: (id: string) => void;
  modified?: boolean;
}) {
  const t = useT();
  const custom = usePresets((s) => s.custom);
  const list = allPresets(custom);
  return (
    <div className="preset-chips" role="radiogroup" aria-label={t('studio.choosePreset')}>
      {list.map((p, i) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={p.id === value}
          className={`preset-chip ${p.id === value ? 'active' : ''}`}
          onClick={() => onChange(p.id)}
          data-preset={p.id}
          title={i < 8 ? `${t.presetName(p)} (${i + 1})` : t.presetName(p)}
        >
          <span className="preset-chip-icon">
            <PresetGlyph icon={p.icon} />
          </span>
          <span>{t.presetName(p)}</span>
          {p.id === value && modified && <span className="mod-dot" aria-label={t('studio.modified')} />}
        </button>
      ))}
    </div>
  );
}

export function presetDescription(t: T, p: Preset | undefined): string {
  if (!p) return '';
  return p.builtIn ? t(`preset.${p.id}.desc` as MessageKey) : t('preset.custom.desc');
}

/** Save the Studio's adjusted sound as a new custom preset. */
export async function saveCurrentAsPreset(t: T) {
  const { params, selectPreset } = useStudio.getState();
  const name = await askText({ title: t('studio.saveAsCustom'), label: t('presets.name'), initial: t('presets.defaultName'), confirmLabel: t('common.save'), maxLength: 40 });
  if (!name) return;
  const p = usePresets.getState().create(name, params);
  selectPreset(p.id);
  toast(t('presets.saved'), 'success');
}

export function SoundControls({ compact }: { compact?: boolean }) {
  const t = useT();
  const params = useStudio((s) => s.params);
  const presetId = useStudio((s) => s.presetId);
  const setParam = useStudio((s) => s.setParam);
  const reset = useStudio((s) => s.reset);
  const inputGainDb = useSettings((s) => s.inputGainDb);
  const setSettings = useSettings((s) => s.set);
  const bypass = useEngine((s) => s.bypass);
  const modified = isModified(presetId, params);
  const [advanced, setAdvanced] = useState(false);

  return (
    <div className="sound-controls">
      <div className="controls-head">
        <h3 className="section-title grow">{t('controls.title')}</h3>
        {modified && (
          <>
            <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={reset}>
              {t('studio.resetPreset')}
            </Button>
            <Button size="sm" variant="gold" icon={<Save />} onClick={() => void saveCurrentAsPreset(t)}>
              {t('studio.saveAsCustom')}
            </Button>
          </>
        )}
      </div>
      <div className="slider-stack">
        <Slider
          label={t('controls.inputGain')}
          icon={<Mic />}
          min={-12}
          max={18}
          step={0.5}
          value={inputGainDb}
          format={(v) => formatParam(t, 'outputDb', v)}
          onChange={(v) => {
            setSettings({ inputGainDb: v });
            engine.setInputGain(v);
          }}
        />
        <Slider
          label={t('controls.echo')}
          icon={<Waves />}
          {...range('echoMix')}
          value={params.echoMix}
          format={(v) => formatParam(t, 'echoMix', v)}
          onChange={(v) => setParam('echoMix', v)}
        />
        <Slider
          label={t('controls.reverb')}
          icon={<AudioLines />}
          {...range('reverbMix')}
          value={params.reverbMix}
          format={(v) => formatParam(t, 'reverbMix', v)}
          onChange={(v) => setParam('reverbMix', v)}
        />
        <Slider
          label={t('controls.clarity')}
          icon={<Ear />}
          {...range('clarity')}
          value={params.clarity}
          format={(v) => formatParam(t, 'clarity', v)}
          onChange={(v) => setParam('clarity', v)}
        />
        <Slider
          label={t('controls.output')}
          icon={<Volume2 />}
          {...range('outputDb')}
          value={params.outputDb}
          format={(v) => formatParam(t, 'outputDb', v)}
          onChange={(v) => setParam('outputDb', v)}
        />
      </div>
      <div className="bypass-row">
        <div className="grow">
          <div className="label">{t('controls.bypass')}</div>
          <div className="sub">{t('controls.bypassSub')}</div>
        </div>
        <Switch checked={bypass} onChange={(v) => engine.setBypass(v)} label={t('controls.bypass')} />
      </div>
      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={advanced}
        onClick={() => setAdvanced((a) => !a)}
        data-testid="advanced-toggle"
      >
        <span className="grow">{t('controls.advanced')}</span>
        <ChevronDown style={{ transform: advanced ? 'rotate(180deg)' : undefined }} />
      </button>
      {advanced && <AdvancedControls params={params} onChange={setParam} compact={compact} />}
    </div>
  );
}

const range = (key: ParamKey) => {
  const s = PARAM_SPECS[key];
  return { min: s.min, max: s.max, step: s.step };
};

const GROUPS: { title: MessageKey; keys: ParamKey[]; note?: MessageKey }[] = [
  { title: 'group.tone', keys: ['highpassHz', 'lowDb', 'lowFreq', 'midDb', 'midFreq', 'presenceDb', 'highDb', 'clarity'] },
  { title: 'group.dynamics', keys: ['compression', 'noiseReduction'], note: 'param.noiseNote' },
  { title: 'group.echo', keys: ['echoMix', 'echoDelayMs', 'echoFeedback', 'echoToneHz'] },
  { title: 'group.reverb', keys: ['reverbMix', 'reverbDecay', 'roomSize', 'preDelayMs', 'earlyReflections', 'damping', 'width'], note: 'param.widthNote' },
  { title: 'group.output', keys: ['outputDb'] },
];

export function AdvancedControls({
  params,
  onChange,
  compact,
}: {
  params: VoiceParams;
  onChange: (k: ParamKey, v: number) => void;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div className={`advanced ${compact ? 'compact' : ''}`}>
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="param-group">
          <legend>{t(g.title)}</legend>
          <div className="slider-stack">
            {g.keys.map((k) => (
              <Slider
                key={k}
                label={t(`param.${k}` as MessageKey)}
                {...range(k)}
                value={params[k]}
                format={(v) => formatParam(t, k, v)}
                onChange={(v) => onChange(k, v)}
              />
            ))}
          </div>
          {g.note && <p className="faint param-note">{t(g.note)}</p>}
        </fieldset>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------- Live Listen

let headphonesConfirmed = false;

export function kindIcon(kind: DeviceKind): ReactNode {
  if (kind === 'bluetooth') return <Bluetooth />;
  if (kind === 'headphones') return <Headphones />;
  if (kind === 'speakers') return <Speaker />;
  return <Volume2 />;
}

/** Turn Live Listen on (with the safety confirmation) or off. Call from a user gesture. */
export async function toggleLiveListen(t: T, on: boolean): Promise<void> {
  if (!on) {
    engine.enableLive(false);
    return;
  }
  const st = engine.getState();
  const outKind = st.output.kind;
  const safe = outKind === 'headphones' || outKind === 'bluetooth';
  if (!safe && !headphonesConfirmed) {
    const ok = await ask({
      title: t('live.confirmTitle'),
      body: `${t('live.confirmBody')}${outKind === 'speakers' ? `\n\n${t('live.speakerWarn')}` : ''}`,
      confirmLabel: t('live.confirmYes'),
    });
    if (!ok) return;
    headphonesConfirmed = true;
  }
  if (engine.getState().input.status !== 'on') await engine.openInput();
  if (engine.getState().input.status === 'on') engine.enableLive(true);
}

export function LiveListenPanel({ compact }: { compact?: boolean }) {
  const t = useT();
  const st = useEngine();
  const setSettings = useSettings((s) => s.set);
  const monitorVolume = useSettings((s) => s.monitorVolume);
  const latency = useLatency(st.input.status === 'on');
  const live = st.live.enabled;
  const supported = typeof AudioWorkletNode !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const recording = st.recording.state === 'recording' || st.recording.state === 'paused';

  const outLabel = st.output.label || t('live.systemDefault');
  const outKind = st.output.kind;
  const bluetooth = outKind === 'bluetooth' || st.input.kind === 'bluetooth';
  const ms = (x: number | null) => (x === null ? t('live.unknownPart') : `${t.n(Math.round(x * 1000))} ms`);

  const inputs = st.devices.inputs;
  const outputs = st.devices.outputs;
  const options = useMemo(() => inputs.filter((d) => d.deviceId !== 'default' || inputs.length === 1), [inputs]);

  return (
    <section className={`live-panel ${live ? 'on' : ''} ${compact ? 'compact' : ''}`} aria-labelledby="live-title" data-testid="live-panel">
      <div className="live-head">
        <span className="live-icon">
          <Headphones />
        </span>
        <div className="grow">
          <h3 id="live-title" className="live-title">
            {t('live.title')}
          </h3>
          <p className="live-sub">
            {st.live.muted ? (
              <span className="pill warn">{t('live.muted')}</span>
            ) : live ? (
              <span className="pill emerald">
                <span className="dot pulse" />
                {t('live.on')}
              </span>
            ) : (
              t('live.sub')
            )}
          </p>
        </div>
        <Switch
          size="lg"
          checked={live}
          disabled={!supported}
          label={t('live.toggle')}
          onChange={(v) => void toggleLiveListen(t, v)}
          id="live-switch"
        />
      </div>

      {!supported && <Notice kind="warn">{t('live.unsupported', { reason: t('err.unsupported') })}</Notice>}
      {st.live.muted === 'feedback' && (
        <Notice
          kind="error"
          actions={
            <Button size="sm" variant="secondary" onClick={() => engine.unmuteLive()}>
              {t('live.unmute')}
            </Button>
          }
        >
          {t('live.feedback')}
        </Notice>
      )}

      <dl className="live-facts">
        <div>
          <dt>{t('live.output')}</dt>
          <dd>
            <span className="fact-icon">{kindIcon(outKind)}</span>
            <span className="truncate" data-testid="live-output-label">{outLabel}</span>
            {outKind !== 'unknown' && <span className="pill">{t(`kind.${outKind}` as MessageKey)}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('live.input')}</dt>
          <dd>
            <span className="fact-icon">
              <Mic />
            </span>
            <span className="truncate">{st.input.status === 'on' ? st.input.label || t('live.systemDefault') : t('state.micOff')}</span>
          </dd>
        </div>
        <div>
          <dt>{t('live.latency')}</dt>
          <dd>
            <span className="num" data-testid="latency-value">
              {latency
                ? latency.complete
                  ? t('live.latencyValue', { ms: Math.round(latency.total * 1000) })
                  : t('live.latencyLowerBound', { ms: Math.round(latency.total * 1000) })
                : '—'}
            </span>
          </dd>
        </div>
      </dl>
      {latency && !compact && (
        <p className="faint live-note">
          {t('live.breakdown', { i: ms(latency.input), p: ms(latency.processing + latency.base), o: ms(latency.output) })}. {t('live.latencyNote')}
        </p>
      )}

      {bluetooth && <Notice kind="warn" icon={<Bluetooth />}>{t('live.bluetoothWarn')}</Notice>}
      {st.input.lowQuality && <Notice kind="warn" icon={<AlertTriangle />}>{t('live.hfpWarn')}</Notice>}
      {outKind === 'speakers' && <Notice kind="warn" icon={<Speaker />}>{t('live.speakerWarn')}</Notice>}
      {outKind === 'unknown' && !live && <p className="faint live-note">{t('live.unknownWarn')}</p>}
      {st.output.error === 'disconnected' && <Notice kind="warn">{t('live.outputLost')}</Notice>}

      <Slider
        label={t('live.volume')}
        icon={<Volume2 />}
        min={0}
        max={1.5}
        step={0.01}
        value={monitorVolume}
        format={(v) => `${t.n(Math.round(v * 100))}%`}
        onChange={(v) => {
          setSettings({ monitorVolume: v });
          engine.setMonitorVolume(v);
        }}
      />

      {!compact && (
        <div className="device-selects">
          <label className="field">
            <span className="field-label">{t('live.inputDevice')}</span>
            <select
              className="select"
              value={st.input.deviceId ?? ''}
              disabled={recording || options.length === 0}
              onChange={(e) => {
                setSettings({ inputDeviceId: e.target.value || null });
                void engine.selectInput(e.target.value || null);
              }}
            >
              {options.length === 0 && <option value="">{t('live.systemDefault')}</option>}
              {options.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `${t('live.inputDevice')} ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('live.outputDevice')}</span>
            {st.output.selectable && outputs.length > 0 ? (
              <select
                className="select"
                value={st.output.deviceId}
                onChange={(e) => {
                  setSettings({ outputDeviceId: e.target.value });
                  void engine.selectOutput(e.target.value);
                }}
              >
                <option value="">{t('live.systemDefault')}</option>
                {outputs
                  .filter((d) => d.deviceId !== 'default')
                  .map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `${t('live.outputDevice')} ${i + 1}`}
                    </option>
                  ))}
              </select>
            ) : (
              <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                {st.devices.labelsAvailable ? t('live.outputFixed') : t('live.devicesHidden')}
              </p>
            )}
          </label>
        </div>
      )}
    </section>
  );
}

