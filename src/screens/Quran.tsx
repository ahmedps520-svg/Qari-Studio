import { useMemo, useState } from 'react';
import { SearchBox, SurahRow } from '../components/SurahPicker';
import { useT } from '../i18n';
import { searchSurahs } from '../lib/quran';
import { navigate } from '../lib/router';
import { useLibrary } from '../state/library';

type Filter = 'all' | 'meccan' | 'medinan';

export function QuranScreen() {
  const t = useT();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const recordings = useLibrary((s) => s.recordings);
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of recordings) if (r.surah && r.status === 'saved') m.set(r.surah, (m.get(r.surah) ?? 0) + 1);
    return m;
  }, [recordings]);
  const results = useMemo(() => searchSurahs(q).filter((s) => filter === 'all' || s.type === filter), [q, filter]);

  return (
    <div className="page quran-page">
      <header className="quran-head">
        <p className="quran-head-ar ar" lang="ar" aria-hidden={t.lang === 'ar'}>
          القرآن الكريم
        </p>
        <h1 className="page-title">{t('quran.title')}</h1>
        <p className="page-sub">{t('quran.subtitle')}</p>
      </header>
      <div className="quran-tools">
        <SearchBox value={q} onChange={setQ} placeholder={t('quran.search')} />
        <div className="chips" role="group" aria-label={t('library.filters')}>
          {(['all', 'meccan', 'medinan'] as Filter[]).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? t('common.all') : f === 'meccan' ? t('quran.meccan') : t('quran.medinan')}
            </button>
          ))}
        </div>
      </div>
      {results.length > 0 ? (
        <div className="card surah-list" role="list">
          {results.map((s) => (
            <SurahRow
              key={s.n}
              s={s}
              onClick={() => navigate(`/quran/${s.n}`)}
              aside={counts.get(s.n) ? <span className="pill gold">{t.n(counts.get(s.n)!)}</span> : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="muted" style={{ padding: 24 }}>
          {t('quran.noResults', { q })}
        </p>
      )}
      <p className="faint source-note">{t('quran.source')}</p>
    </div>
  );
}
