import { ArrowLeft, BookOpen, ListMusic, ListOrdered, Mic } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GeometricPattern } from '../components/Brand';
import { ReadingView } from '../components/ReadingView';
import { RecordingRow } from '../components/RecordingRow';
import { RangeChooser } from '../components/SurahPicker';
import { Button, IconButton, Segmented, Sheet } from '../components/ui';
import { useT } from '../i18n';
import { getSurah } from '../lib/quran';
import { back, useRoute } from '../lib/router';
import { useLibrary } from '../state/library';
import { useSettings } from '../state/settings';
import { startRecitation } from './Home';

export function SurahScreen({ n }: { n: number }) {
  const t = useT();
  const s = getSurah(n);
  const route = useRoute();
  const recordings = useLibrary((x) => x.recordings);
  const setSettings = useSettings((x) => x.set);
  const [tab, setTab] = useState<'read' | 'recordings'>('read');
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState<{ from: number | null; to: number | null }>({ from: null, to: null });
  const mine = useMemo(() => recordings.filter((r) => r.surah === n && r.status === 'saved'), [recordings, n]);
  const scrollAyah = Number(route.query.get('ayah')) || null;

  useEffect(() => {
    if (s) setSettings({ lastSurahVisited: s.n });
  }, [s, setSettings]);

  if (!s) {
    return (
      <div className="page">
        <p className="muted">{t('quran.noResults', { q: String(n) })}</p>
      </div>
    );
  }

  return (
    <div className="page surah-page">
      <div className="topbar">
        <IconButton className="back" label={t('common.back')} onClick={() => back('/quran')}>
          <ArrowLeft />
        </IconButton>
        <span className="topbar-title faint">{t('surah.number', { n: s.n })}</span>
      </div>

      <header className="surah-hero">
        <GeometricPattern id="surah-pattern" />
        <p className="surah-hero-ar ar" lang="ar">
          {t.surahArabic(s)}
        </p>
        <h1 className="surah-hero-en">{t.surahEnglish(s)}</h1>
        <p className="surah-hero-meta">
          {[
            t.lang === 'en' ? s.meaning : null,
            t.plural('unit.ayah', s.ayahs),
            s.type === 'meccan' ? t('quran.meccan') : t('quran.medinan'),
            t('surah.number', { n: s.n }),
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </p>
        <div className="surah-hero-actions">
          <Button variant="primary" size="lg" icon={<Mic />} onClick={() => startRecitation({ surah: s.n, from: null, to: null })} data-testid="recite-surah">
            {t('surah.recite')}
          </Button>
          <Button variant="secondary" size="lg" icon={<ListOrdered />} onClick={() => setRangeOpen(true)}>
            {t('surah.chooseRange')}
          </Button>
        </div>
      </header>

      <div className="surah-tabs">
        <Segmented
          label={t('surah.read')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'read', label: <><BookOpen size={16} /> {t('surah.read')}</> },
            { value: 'recordings', label: <><ListMusic size={16} /> {t('nav.library')} {mine.length > 0 ? `(${t.n(mine.length)})` : ''}</> },
          ]}
        />
      </div>

      {tab === 'read' ? (
        <div className="card card-pad">
          <ReadingView surah={s} trackProgress scrollToAyah={scrollAyah} />
        </div>
      ) : mine.length > 0 ? (
        <div className="card rec-list">
          {mine.map((r) => (
            <RecordingRow key={r.id} meta={r} />
          ))}
        </div>
      ) : (
        <div className="card-quiet empty-inline">
          <p className="muted">{t('surah.noRecordings')}</p>
        </div>
      )}

      <Sheet
        open={rangeOpen}
        onClose={() => setRangeOpen(false)}
        title={t('range.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRangeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              icon={<Mic />}
              onClick={() => {
                setRangeOpen(false);
                startRecitation({ surah: s.n, ...range });
              }}
            >
              {t('range.apply')}
            </Button>
          </>
        }
      >
        <RangeChooser surah={s} from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </Sheet>
    </div>
  );
}
