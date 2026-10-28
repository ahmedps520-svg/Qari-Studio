import { Copy, Download, GitCompareArrows, MoreHorizontal, Pause, Pencil, Play, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { audioCache } from '../audio/audioCache';
import { usePlayer } from '../audio/hooks';
import { player } from '../audio/player';
import { useT } from '../i18n';
import type { RecordingMeta } from '../lib/db';
import { getSurah } from '../lib/quran';
import { navigate } from '../lib/router';
import { useLibrary } from '../state/library';
import { ask, askText, toast } from '../state/ui';
import { ExportSheet, recordingPresetName } from './ExportSheet';
import { Menu } from './ui';
import { MiniWave } from './Waveform';

export async function playRecording(meta: RecordingMeta) {
  if (player.isLoaded(meta.id)) {
    player.toggle();
    return;
  }
  const samples = await audioCache.get(meta.audioId);
  await player.load(meta.id, samples, meta.sampleRate, meta.params);
  await player.play();
}

export function useRecordingActions(meta: RecordingMeta) {
  const t = useT();
  const lib = useLibrary();
  return {
    rename: async () => {
      const name = await askText({ title: t('review.renameTitle'), label: t('review.nameLabel'), initial: meta.title, confirmLabel: t('common.save') });
      if (name && name !== meta.title) {
        await lib.patch(meta.id, { title: name });
        toast(t('library.renamed'), 'success');
      }
    },
    duplicate: async () => {
      const copy = await lib.duplicate(meta.id, t('library.copyOf', { title: meta.title }));
      if (copy) toast(t('library.duplicated'), 'success');
    },
    favorite: () => void lib.patch(meta.id, { favorite: !meta.favorite }),
    remove: async () => {
      const ok = await ask({
        title: t('review.deleteTitle'),
        body: t('review.deleteBody', { title: meta.title }),
        confirmLabel: t('review.deleteConfirm'),
        danger: true,
      });
      if (!ok) return false;
      if (player.getState().loadedId === meta.id) player.unload();
      await lib.remove(meta.id);
      toast(t('library.deleted'), 'success');
      return true;
    },
  };
}

export function RecordingRow({ meta, compact }: { meta: RecordingMeta; compact?: boolean }) {
  const t = useT();
  const ps = usePlayer();
  const s = getSurah(meta.surah);
  const actions = useRecordingActions(meta);
  const [exporting, setExporting] = useState(false);
  const isCurrent = ps.loadedId === meta.id;
  const playing = isCurrent && ps.playing;
  const presetLabel = recordingPresetName(t, meta);

  return (
    <div className={`rec-row ${playing ? 'playing' : ''} ${compact ? 'compact' : ''}`} data-testid="recording-row" data-id={meta.id}>
      <button
        type="button"
        className="rec-play"
        aria-label={playing ? t('common.pause') : t('library.play', { title: meta.title })}
        onClick={() => void playRecording(meta)}
        disabled={isCurrent && ps.loading}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <button type="button" className="rec-main" onClick={() => navigate(`/recording/${meta.id}`)}>
        <span className="rec-title-line">
          <span className="rec-title truncate">{meta.title}</span>
          {s && !meta.title.includes(s.ar) && (
            <span className="rec-ar ar" lang="ar">
              {s.ar}
            </span>
          )}
        </span>
        <span className="rec-meta">
          <span>{t.date(meta.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span className="num">{t.duration(meta.duration)}</span>
          <span aria-hidden="true">·</span>
          <span className="rec-preset truncate">{presetLabel}</span>
        </span>
      </button>
      {!compact && <MiniWave peaks={meta.peaks} />}
      <button
        type="button"
        className={`icon-btn sm fav ${meta.favorite ? 'active' : ''}`}
        aria-pressed={meta.favorite}
        aria-label={meta.favorite ? t('library.unfavorite') : t('library.favorite')}
        title={meta.favorite ? t('library.unfavorite') : t('library.favorite')}
        onClick={actions.favorite}
      >
        <Star fill={meta.favorite ? 'currentColor' : 'none'} />
      </button>
      <Menu
        label={t('common.more')}
        trigger={<MoreHorizontal />}
        items={[
          { label: t('common.rename'), icon: <Pencil />, onSelect: () => void actions.rename() },
          { label: t('common.duplicate'), icon: <Copy />, onSelect: () => void actions.duplicate() },
          { label: t('common.export'), icon: <Download />, onSelect: () => setExporting(true) },
          { label: t('library.compare'), icon: <GitCompareArrows />, onSelect: () => navigate(`/recording/${meta.id}?compare=1`) },
          'sep',
          { label: t('common.delete'), icon: <Trash2 />, danger: true, onSelect: () => void actions.remove() },
        ]}
      />
      {exporting && <ExportSheet meta={meta} open={exporting} onClose={() => setExporting(false)} />}
    </div>
  );
}
