import { Download, FolderDown, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  canSharePicker,
  canShareFiles,
  exportRecording,
  FORMAT_EXT,
  formatAvailability,
  saveBlob,
  type ExportFormat,
  type ExportStage,
  type ExportVersion,
  type FormatAvailability,
} from '../audio/export';
import { findBuiltIn } from '../audio/presets';
import { useT, type MessageKey } from '../i18n';
import type { RecordingMeta } from '../lib/db';
import { defaultExportBase, sanitizeFilename, stripExtension } from '../lib/filename';
import { getSurah } from '../lib/quran';
import { useLibrary } from '../state/library';
import { findPreset } from '../state/presets';
import { useSettings } from '../state/settings';
import { toast } from '../state/ui';
import { Button, Notice, OptionList, Progress, Sheet } from './ui';

export function recordingPresetName(t: ReturnType<typeof useT>, meta: RecordingMeta): string {
  const p = findPreset(meta.presetId);
  if (p) return t.presetName(p);
  return meta.presetName || t('presets.custom.name');
}

export function englishPresetName(meta: RecordingMeta): string {
  const b = findBuiltIn(meta.presetId);
  if (b) {
    // File names stay ASCII-friendly: use the English preset name.
    const names: Record<string, string> = {
      'plain-vanilla': 'Plain Vanilla',
      'soft-echo': 'Soft Echo',
      'beautiful-plus': 'Beautiful+',
      'grand-mosque': 'Grand Mosque',
      'studio-qari': 'Studio Qari',
      'warm-deep': 'Warm & Deep',
      'pure-voice': 'Pure Voice',
      'cinematic-space': 'Cinematic Space',
    };
    return names[b.id] ?? b.id;
  }
  return findPreset(meta.presetId)?.name || meta.presetName || 'Custom';
}

export function defaultFileBase(meta: RecordingMeta, version: ExportVersion): string {
  const s = getSurah(meta.surah);
  return defaultExportBase({
    surahName: s?.en ?? null,
    presetName: version === 'enhanced' ? englishPresetName(meta) : null,
    createdAt: meta.createdAt,
    ayahFrom: meta.ayahFrom,
    ayahTo: meta.ayahTo,
    ayahCount: s?.ayahs,
  });
}

function estimateBytes(meta: RecordingMeta, version: ExportVersion, format: ExportFormat): number {
  const ch = version === 'enhanced' ? 2 : 1;
  const d = meta.duration + (version === 'enhanced' ? 2 : 0);
  switch (format) {
    case 'wav24':
      return d * meta.sampleRate * ch * 3;
    case 'wav16':
      return d * meta.sampleRate * ch * 2;
    case 'mp3':
      return (d * (ch > 1 ? 256 : 160) * 1000) / 8;
    case 'm4a':
      return (d * (ch > 1 ? 256 : 160) * 1000) / 8;
  }
}

export function ExportSheet({ meta, open, onClose }: { meta: RecordingMeta; open: boolean; onClose: () => void }) {
  const t = useT();
  const defaultFormat = useSettings((s) => s.exportFormat);
  const [version, setVersion] = useState<ExportVersion>('enhanced');
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [avail, setAvail] = useState<FormatAvailability[] | null>(null);
  const [name, setName] = useState('');
  const [touchedName, setTouchedName] = useState(false);
  const [busy, setBusy] = useState<{ stage: ExportStage; p: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patch = useLibrary((s) => s.patch);
  const presetLabel = recordingPresetName(t, meta);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(null);
    setTouchedName(false);
    void formatAvailability(meta.sampleRate).then((a) => {
      setAvail(a);
      const cur = a.find((x) => x.format === defaultFormat);
      setFormat(cur?.available ? defaultFormat : 'wav24');
    });
  }, [open, meta.sampleRate, defaultFormat]);

  useEffect(() => {
    if (!open || touchedName) return;
    setName(meta.exportName && version === 'enhanced' ? meta.exportName : defaultFileBase(meta, version));
  }, [open, version, meta, touchedName]);

  const run = async (method: 'download' | 'picker' | 'share') => {
    setError(null);
    setBusy({ stage: 'loading', p: 0 });
    try {
      const blob = await exportRecording(meta, version, format, (stage, p) => setBusy({ stage, p }));
      const file = `${sanitizeFilename(stripExtension(name))}.${FORMAT_EXT[format]}`;
      const res = await saveBlob(blob, file, method);
      if (res === 'saved') {
        await patch(meta.id, {
          lastExport: { format, at: Date.now(), version },
          ...(touchedName ? { exportName: stripExtension(name) } : {}),
        });
        toast(t('export.done', { file }), 'success');
        onClose();
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setBusy(null);
        return;
      }
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const fmtLabel = (f: ExportFormat) => t(`fmt.${f}` as MessageKey);
  const progressText = busy
    ? busy.stage === 'rendering'
      ? t('export.rendering', { preset: presetLabel, p: Math.round(busy.p * 100) })
      : busy.stage === 'encoding'
        ? t('export.encoding', { format: fmtLabel(format), p: Math.round(busy.p * 100) })
        : t('export.loading')
    : '';
  const shareOk = typeof navigator !== 'undefined' && canShareFiles('audio/wav');

  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      title={t('export.title')}
      dismissable={!busy}
      footer={
        busy ? undefined : (
          <>
            {canSharePicker() && (
              <Button variant="secondary" icon={<FolderDown />} onClick={() => void run('picker')}>
                {t('export.saveAs')}
              </Button>
            )}
            {shareOk && (
              <Button variant="secondary" icon={<Share2 />} onClick={() => void run('share')}>
                {t('export.share')}
              </Button>
            )}
            <Button variant="primary" icon={<Download />} onClick={() => void run('download')} data-testid="export-download">
              {t('export.download')}
            </Button>
          </>
        )
      }
    >
      <div className="stack" style={{ gap: 20 }}>
        <div className="field">
          <span className="field-label">{t('export.version')}</span>
          <OptionList
            label={t('export.version')}
            value={version}
            onChange={setVersion}
            options={[
              { value: 'enhanced', title: t('export.enhanced', { preset: presetLabel }), sub: t('export.enhancedSub') },
              { value: 'original', title: t('export.original'), sub: t('export.originalSub') },
            ]}
          />
        </div>
        <div className="field">
          <span className="field-label">{t('export.format')}</span>
          <OptionList
            label={t('export.format')}
            value={format}
            onChange={setFormat}
            cols={2}
            options={(['wav24', 'wav16', 'm4a', 'mp3'] as ExportFormat[]).map((f) => {
              const a = avail?.find((x) => x.format === f);
              const ok = a ? a.available : f.startsWith('wav');
              return {
                value: f,
                title: fmtLabel(f),
                sub: ok ? `${t(`fmt.${f}Sub` as MessageKey)} · ${t('export.size', { size: t.bytes(estimateBytes(meta, version, f)) })}` : t('export.notSupported'),
                disabled: !ok,
              };
            })}
          />
        </div>
        <label className="field">
          <span className="field-label">{t('export.filename')}</span>
          <div className="filename-input">
            <input
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setTouchedName(true);
              }}
              dir="ltr"
              spellCheck={false}
              data-testid="export-filename"
            />
            <span className="ext">.{FORMAT_EXT[format]}</span>
          </div>
        </label>
        {busy && (
          <div className="stack" style={{ gap: 10 }} aria-live="polite">
            <span className="muted">{progressText}</span>
            <Progress value={busy.stage === 'loading' ? 0.02 : busy.stage === 'rendering' ? busy.p * 0.7 : 0.7 + busy.p * 0.3} label={progressText} />
          </div>
        )}
        {error && <Notice kind="error">{t('export.failed', { error })}</Notice>}
        <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          {t('export.where')}
        </p>
      </div>
    </Sheet>
  );
}
