import { ChevronRight, Download, FileText, HardDrive, HelpCircle, Info, Lock, Mic, ShieldCheck, Stethoscope, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { audioCache } from '../audio/audioCache';
import { clearImpulseCache } from '../audio/dsp/impulse';
import { engine, type LatencyMode } from '../audio/engine';
import { formatAvailability, saveBlob, type ExportFormat } from '../audio/export';
import { useEngine } from '../audio/hooks';
import { player } from '../audio/player';
import { formatParam } from '../components/StudioControls';
import { Button, Notice, OptionList, Progress, Segmented, Slider, Switch } from '../components/ui';
import { useT, type MessageKey } from '../i18n';
import { createBackup, InvalidBackupError, restoreBackup } from '../lib/backup';
import { deleteAllRecordings, persistStatus, requestPersist, storageEstimate } from '../lib/db';
import { isoDate } from '../lib/filename';
import { promptInstall, useInstallAvailable } from '../lib/install';
import { useLibrary } from '../state/library';
import { allPresets, usePresets } from '../state/presets';
import { useSettings, type Language, type ThemeChoice } from '../state/settings';
import { useStudio } from '../state/studio';
import { ask, toast } from '../state/ui';

function Section({ id, title, icon, children }: { id: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 id={id} className="settings-h">
        {icon}
        {title}
      </h2>
      <div className="card">{children}</div>
    </section>
  );
}

function Row({ label, sub, children, stacked }: { label: string; sub?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <div className={`setting-row ${stacked ? 'stacked' : ''}`}>
      <div className="grow">
        <div className="label">{label}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function LinkRow({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <a className="list-row" href={href}>
      <span className="faint">{icon}</span>
      <span className="grow">{label}</span>
      <ChevronRight className="chev" />
    </a>
  );
}

export function SettingsScreen() {
  const t = useT();
  const s = useSettings();
  const st = useEngine();
  const recordings = useLibrary((x) => x.recordings);
  const refresh = useLibrary((x) => x.refresh);
  const custom = usePresets((x) => x.custom);
  const importPresets = usePresets((x) => x.importMany);
  const installable = useInstallAvailable();
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persist, setPersist] = useState<'persisted' | 'best-effort' | 'unsupported'>('unsupported');
  const [formats, setFormats] = useState<{ format: ExportFormat; available: boolean }[]>([]);
  const [work, setWork] = useState<{ label: string; p: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshStorage = async () => {
    setEstimate(await storageEstimate());
    setPersist(await persistStatus());
  };
  useEffect(() => {
    void refreshStorage();
    void engine.refreshDevices();
    void formatAvailability(48000).then(setFormats);
  }, [recordings.length]);

  const saved = recordings.filter((r) => r.status !== 'recording');
  const totalDuration = saved.reduce((a, r) => a + r.duration, 0);
  const recBusy = st.recording.state !== 'idle';

  const setLatency = async (m: LatencyMode) => {
    if (recBusy) {
      toast(t('settings.latencyBusy'), 'warning');
      return;
    }
    s.set({ latencyMode: m });
    engine.configure({ latencyMode: m });
    if (engine.audioContext) {
      player.unload();
      await engine.restartContext();
      toast(t('settings.latencyApplied'), 'success');
    }
  };

  const backup = async () => {
    if (saved.length === 0) {
      toast(t('backup.empty'));
      return;
    }
    try {
      setWork({ label: 'backup', p: 0 });
      const blob = await createBackup(custom, (p) => setWork({ label: 'backup', p }));
      await saveBlob(blob, `QariStudio_Backup_${isoDate(Date.now())}.zip`, 'download');
      toast(t('backup.done'), 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    } finally {
      setWork(null);
    }
  };

  const restore = async (file: File) => {
    try {
      setWork({ label: 'restore', p: 0 });
      const res = await restoreBackup(file, (p) => setWork({ label: 'restore', p }));
      importPresets(res.presets);
      await refresh();
      toast(t('backup.restored', { count: t.plural('unit.recording', res.recordings) }), 'success');
    } catch (e) {
      toast(e instanceof InvalidBackupError ? t('backup.invalid') : String((e as Error)?.message ?? e), 'error');
    } finally {
      setWork(null);
    }
  };

  const deleteAll = async () => {
    const word = t('privacy.confirmWord');
    const ok = await ask({
      title: t('privacy.deleteAllTitle'),
      body: t('privacy.deleteAllBody', { count: saved.length, word }),
      confirmLabel: t('privacy.deleteAllConfirm'),
      danger: true,
      typeToConfirm: word,
    });
    if (!ok) return;
    player.unload();
    audioCache.clear();
    await deleteAllRecordings();
    await refresh();
    toast(t('privacy.deletedAll'), 'success');
  };

  const permKey = `permission.${st.permission}` as MessageKey;
  const inputs = st.devices.inputs;
  const outputs = st.devices.outputs;

  return (
    <div className="page narrow settings">
      <header style={{ marginBottom: 8 }}>
        <h1 className="page-title">{t('settings.title')}</h1>
      </header>

      <Section id="s-appearance" title={t('settings.appearance')} icon={<Info />}>
        <Row label={t('settings.theme')} stacked>
          <OptionList<ThemeChoice>
            label={t('settings.theme')}
            value={s.theme}
            onChange={(v) => s.set({ theme: v })}
            options={[
              { value: 'midnight', title: t('theme.midnight'), sub: t('theme.midnightSub'), aside: <span className="swatch midnight" aria-hidden="true" /> },
              { value: 'ivory', title: t('theme.ivory'), sub: t('theme.ivorySub'), aside: <span className="swatch ivory" aria-hidden="true" /> },
              { value: 'system', title: t('theme.system'), sub: t('theme.systemSub'), aside: <span className="swatch system" aria-hidden="true" /> },
            ]}
          />
        </Row>
        <Row label={t('settings.language')}>
          <Segmented<Language>
            label={t('settings.language')}
            value={s.language}
            onChange={(v) => s.set({ language: v })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: <span lang="ar">العربية</span> },
            ]}
          />
        </Row>
        <Row label={t('settings.name')} sub={t('settings.nameHint')} stacked>
          <input
            className="input"
            value={s.name}
            maxLength={40}
            placeholder={t('settings.namePlaceholder')}
            onChange={(e) => s.set({ name: e.target.value })}
            aria-label={t('settings.name')}
          />
        </Row>
      </Section>

      <Section id="s-audio" title={t('settings.audio')} icon={<Mic />}>
        {!st.devices.labelsAvailable && (
          <div className="setting-row">
            <Notice
              kind="info"
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Mic />}
                  onClick={async () => {
                    await engine.openInput();
                    engine.closeInput();
                    await engine.refreshDevices();
                  }}
                >
                  {t('settings.allowMic')}
                </Button>
              }
            >
              {t('settings.devicesHidden')}
            </Notice>
          </div>
        )}
        <Row label={t('settings.defaultMic')} stacked>
          <select
            className="select"
            aria-label={t('settings.defaultMic')}
            value={s.inputDeviceId ?? ''}
            onChange={(e) => {
              s.set({ inputDeviceId: e.target.value || null });
              engine.configure({ preferredInput: e.target.value || null });
            }}
          >
            <option value="">{t('live.systemDefault')}</option>
            {inputs
              .filter((d) => d.deviceId !== 'default')
              .map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `${t('live.inputDevice')} ${i + 1}`}
                </option>
              ))}
          </select>
        </Row>
        <Row label={t('settings.defaultOutput')} stacked sub={!st.output.selectable ? t('live.outputFixed') : undefined}>
          {st.output.selectable && (
            <select
              className="select"
              aria-label={t('settings.defaultOutput')}
              value={s.outputDeviceId}
              onChange={(e) => {
                s.set({ outputDeviceId: e.target.value });
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
          )}
        </Row>
        <Row label={t('settings.defaultPreset')} sub={t('settings.defaultPresetSub')}>
          <select
            className="select sm"
            aria-label={t('settings.defaultPreset')}
            style={{ width: 'auto', minWidth: 180 }}
            value={s.defaultPresetId}
            onChange={(e) => {
              s.set({ defaultPresetId: e.target.value });
              if (st.recording.state === 'idle') useStudio.getState().selectPreset(e.target.value);
            }}
          >
            {allPresets(custom).map((p) => (
              <option key={p.id} value={p.id}>
                {t.presetName(p)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.exportFormat')}>
          <select
            className="select sm"
            aria-label={t('settings.exportFormat')}
            style={{ width: 'auto', minWidth: 180 }}
            value={s.exportFormat}
            onChange={(e) => s.set({ exportFormat: e.target.value as ExportFormat })}
          >
            {(['wav24', 'wav16', 'm4a', 'mp3'] as ExportFormat[]).map((f) => {
              const ok = formats.find((x) => x.format === f)?.available ?? f.startsWith('wav');
              return (
                <option key={f} value={f} disabled={!ok}>
                  {t(`fmt.${f}` as MessageKey)}
                  {ok ? '' : ` — ${t('export.notSupported')}`}
                </option>
              );
            })}
          </select>
        </Row>
        <Row label={t('settings.quality')} stacked>
          <OptionList
            label={t('settings.quality')}
            value={s.recordingFormat}
            onChange={(v) => s.set({ recordingFormat: v })}
            options={[
              { value: 'f32', title: t('quality.f32'), sub: t('quality.f32Sub') },
              { value: 'i16', title: t('quality.i16'), sub: t('quality.i16Sub') },
            ]}
          />
        </Row>
        <Row label={t('settings.latencyMode')} stacked>
          <OptionList<LatencyMode>
            label={t('settings.latencyMode')}
            value={s.latencyMode}
            onChange={(v) => void setLatency(v)}
            options={[
              { value: 'lowest', title: t('latency.lowest'), sub: t('latency.lowestSub') },
              { value: 'interactive', title: t('latency.interactive'), sub: t('latency.interactiveSub'), aside: <span className="pill">{t('common.recommended')}</span> },
              { value: 'stable', title: t('latency.stable'), sub: t('latency.stableSub') },
            ]}
          />
        </Row>
        <Row label={t('settings.monitorPrefs')} stacked>
          <Slider
            label={t('settings.monitorVolume')}
            min={0}
            max={1.5}
            step={0.01}
            value={s.monitorVolume}
            format={(v) => `${t.n(Math.round(v * 100))}%`}
            onChange={(v) => {
              s.set({ monitorVolume: v });
              engine.setMonitorVolume(v);
            }}
          />
        </Row>
        <Row label={t('settings.inputSensitivity')} stacked>
          <Slider
            label={t('controls.inputGain')}
            min={-12}
            max={18}
            step={0.5}
            value={s.inputGainDb}
            format={(v) => formatParam(t, 'outputDb', v)}
            onChange={(v) => {
              s.set({ inputGainDb: v });
              engine.setInputGain(v);
            }}
          />
        </Row>
        <Row label={t('settings.noiseReduction')} sub={t('settings.noiseReductionSub')} />
        <Row label={t('settings.browserNS')} sub={t('settings.browserNSSub')}>
          <Switch
            checked={s.browserNoiseSuppression}
            label={t('settings.browserNS')}
            onChange={(v) => {
              s.set({ browserNoiseSuppression: v });
              engine.configure({ noiseSuppression: v });
            }}
          />
        </Row>
      </Section>

      <Section id="s-storage" title={t('settings.storage')} icon={<HardDrive />}>
        <Row label={t('storage.location')} sub={t('storage.locationBody')} />
        <Row
          label={t('storage.usage')}
          sub={
            <>
              {estimate ? t('storage.usageValue', { used: t.bytes(estimate.usage), quota: t.bytes(estimate.quota) }) : t('storage.unknown')}
              <br />
              {t('storage.recordings', { count: t.plural('unit.recording', saved.length), duration: t.duration(totalDuration) })}
            </>
          }
        />
        <Row
          label={t('storage.persist')}
          sub={persist === 'persisted' ? t('storage.persisted') : persist === 'best-effort' ? t('storage.notPersisted') : t('storage.persistUnsupported')}
        >
          {persist === 'best-effort' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const ok = await requestPersist();
                await refreshStorage();
                if (!ok) toast(t('storage.persistDenied'), 'warning');
              }}
            >
              {t('storage.requestPersist')}
            </Button>
          )}
        </Row>
        <Row label={t('storage.exportOptions')} sub={t('storage.exportOptionsBody')} />
        <Row label={t('storage.backup')} sub={t('storage.backupSub')}>
          <Button size="sm" variant="secondary" icon={<Download />} disabled={!!work} onClick={() => void backup()}>
            {t('common.export')}
          </Button>
        </Row>
        <Row label={t('storage.restore')} sub={t('storage.restoreSub')}>
          <Button size="sm" variant="secondary" icon={<Upload />} disabled={!!work} onClick={() => fileRef.current?.click()}>
            {t('common.open')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void restore(f);
            }}
          />
        </Row>
        {work && (
          <div className="setting-row stacked" aria-live="polite">
            <span className="sub">{t(work.label === 'backup' ? 'backup.working' : 'backup.restoring', { p: Math.round(work.p * 100) })}</span>
            <Progress value={work.p} label={work.label} />
          </div>
        )}
        <Row label={t('storage.clearCache')} sub={t('storage.clearCacheSub')}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              audioCache.clear();
              clearImpulseCache();
              toast(t('storage.cacheCleared'), 'success');
            }}
          >
            {t('common.clear')}
          </Button>
        </Row>
      </Section>

      <Section id="s-privacy" title={t('settings.privacy')} icon={<ShieldCheck />}>
        <Row label={t('privacy.mic')} sub={t('privacy.micHelp')}>
          <span className={`pill ${st.permission === 'granted' ? 'emerald' : st.permission === 'denied' ? 'warn' : ''}`}>{t(permKey)}</span>
        </Row>
        <Row label={t('privacy.local')} sub={t('privacy.localBody')} />
        <Row label={t('privacy.data')} sub={t('privacy.dataBody')} />
        <Row label={t('privacy.cloud')} sub={t('privacy.cloudBody')} />
        <Row label={t('privacy.deleteAll')}>
          <Button size="sm" variant="danger" icon={<Trash2 />} disabled={saved.length === 0 || recBusy} onClick={() => void deleteAll()}>
            {t('common.delete')}
          </Button>
        </Row>
      </Section>

      <Section id="s-about" title={t('settings.about')} icon={<Lock />}>
        <Row label={t('app.name')} sub={t('about.version', { v: __APP_VERSION__ })} />
        {installable && (
          <Row label={t('about.install')} sub={t('about.installSub')}>
            <Button size="sm" variant="primary" onClick={() => void promptInstall()}>
              {t('about.install')}
            </Button>
          </Row>
        )}
        <div className="list">
          <LinkRow href="#/settings/privacy" label={t('about.privacyPolicy')} icon={<ShieldCheck size={18} />} />
          <LinkRow href="#/settings/help" label={t('about.help')} icon={<HelpCircle size={18} />} />
          <LinkRow href="#/settings/troubleshooting" label={t('about.troubleshooting')} icon={<Stethoscope size={18} />} />
          <LinkRow href="#/settings/licenses" label={t('about.sources')} icon={<FileText size={18} />} />
        </div>
      </Section>
    </div>
  );
}
