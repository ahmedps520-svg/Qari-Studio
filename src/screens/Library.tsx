import { Library as LibraryIcon, Mic, SlidersHorizontal, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RecordingRow } from '../components/RecordingRow';
import { SearchBox } from '../components/SurahPicker';
import { Button, Empty, Notice } from '../components/ui';
import { useT } from '../i18n';
import type { RecordingMeta } from '../lib/db';
import { getSurah, latinKey, normalizeArabic, SURAHS } from '../lib/quran';
import { navigate } from '../lib/router';
import { useLibrary } from '../state/library';
import { allPresets, usePresets } from '../state/presets';

type DateFilter = 'any' | 'today' | 'week' | 'month' | 'year';
type Sort = 'recent' | 'oldest' | 'longest' | 'shortest' | 'surah';

function matches(r: RecordingMeta, q: string): boolean {
  if (!q) return true;
  const s = getSurah(r.surah);
  if (/[؀-ۿ]/.test(q)) {
    const nq = normalizeArabic(q);
    return normalizeArabic(r.title).includes(nq) || (s ? normalizeArabic(s.ar).includes(nq) : false);
  }
  const k = latinKey(q);
  const lq = q.toLowerCase();
  return (
    r.title.toLowerCase().includes(lq) ||
    (s ? latinKey(s.en).includes(k) || latinKey(s.tr).includes(k) || String(s.n) === q.trim() : false)
  );
}

function withinDate(ts: number, f: DateFilter): boolean {
  if (f === 'any') return true;
  const now = new Date();
  if (f === 'today') {
    const d = new Date(ts);
    return d.toDateString() === now.toDateString();
  }
  const days = f === 'week' ? 7 : f === 'month' ? 30 : 365;
  return ts >= now.getTime() - days * 86400000;
}

export function LibraryScreen() {
  const t = useT();
  const recordings = useLibrary((s) => s.recordings);
  const loaded = useLibrary((s) => s.loaded);
  const error = useLibrary((s) => s.error);
  const custom = usePresets((s) => s.custom);
  const [q, setQ] = useState('');
  const [surah, setSurah] = useState<string>('any');
  const [preset, setPreset] = useState<string>('any');
  const [date, setDate] = useState<DateFilter>('any');
  const [fav, setFav] = useState(false);
  const [sort, setSort] = useState<Sort>('recent');
  const [showFilters, setShowFilters] = useState(false);

  const saved = useMemo(() => recordings.filter((r) => r.status === 'saved'), [recordings]);
  const drafts = useMemo(() => recordings.filter((r) => r.status === 'draft'), [recordings]);
  const surahsInLib = useMemo(() => SURAHS.filter((s) => saved.some((r) => r.surah === s.n)), [saved]);
  const hasFree = saved.some((r) => r.surah === null);
  const presetsInLib = useMemo(() => {
    const ids = new Set(saved.map((r) => r.presetId));
    return allPresets(custom).filter((p) => ids.has(p.id));
  }, [saved, custom]);

  const list = useMemo(() => {
    const out = saved.filter(
      (r) =>
        matches(r, q.trim()) &&
        (surah === 'any' || (surah === 'free' ? r.surah === null : r.surah === Number(surah))) &&
        (preset === 'any' || r.presetId === preset) &&
        withinDate(r.createdAt, date) &&
        (!fav || r.favorite),
    );
    const by: Record<Sort, (a: RecordingMeta, b: RecordingMeta) => number> = {
      recent: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      longest: (a, b) => b.duration - a.duration,
      shortest: (a, b) => a.duration - b.duration,
      surah: (a, b) => (a.surah ?? 999) - (b.surah ?? 999) || (a.ayahFrom ?? 0) - (b.ayahFrom ?? 0) || a.createdAt - b.createdAt,
    };
    return out.sort(by[sort]);
  }, [saved, q, surah, preset, date, fav, sort]);

  const filtered = q || surah !== 'any' || preset !== 'any' || date !== 'any' || fav;
  const clear = () => {
    setQ('');
    setSurah('any');
    setPreset('any');
    setDate('any');
    setFav(false);
  };

  return (
    <div className="page library">
      <header className="lib-head">
        <div className="grow">
          <h1 className="page-title">{t('library.title')}</h1>
          <p className="page-sub">{t.plural('unit.recording', saved.length)}</p>
        </div>
        <Button variant="primary" icon={<Mic />} onClick={() => navigate('/studio')} className="lib-new">
          {t('quick.new')}
        </Button>
      </header>

      {error && <Notice kind="error">{error}</Notice>}

      {drafts.length > 0 && (
        <section className="section drafts" aria-labelledby="drafts-h">
          <div className="section-head">
            <h2 id="drafts-h" className="section-title">
              {t('library.drafts')}
            </h2>
          </div>
          <p className="faint" style={{ marginBottom: 12, fontSize: 'var(--fs-sm)' }}>
            {t('library.draftsBody')}
          </p>
          <div className="card rec-list drafts-list">
            {drafts.map((r) => (
              <RecordingRow key={r.id} meta={r} />
            ))}
          </div>
        </section>
      )}

      {saved.length > 0 && (
        <div className="lib-tools">
          <div className="lib-search">
            <SearchBox value={q} onChange={setQ} placeholder={t('library.search')} />
          </div>
          <div className="lib-chips">
            <button type="button" className="chip" aria-pressed={fav} onClick={() => setFav((f) => !f)}>
              <Star size={15} fill={fav ? 'currentColor' : 'none'} />
              {t('library.favorites')}
            </button>
            <button type="button" className="chip" aria-expanded={showFilters} aria-pressed={showFilters} onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal size={15} />
              {t('library.filters')}
            </button>
            <select className="select sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('library.sort')}>
              <option value="recent">{t('sort.recent')}</option>
              <option value="oldest">{t('sort.oldest')}</option>
              <option value="longest">{t('sort.longest')}</option>
              <option value="shortest">{t('sort.shortest')}</option>
              <option value="surah">{t('sort.surah')}</option>
            </select>
          </div>
          {showFilters && (
            <div className="lib-filters">
              <label className="field">
                <span className="field-label">{t('library.surah')}</span>
                <select className="select" value={surah} onChange={(e) => setSurah(e.target.value)}>
                  <option value="any">{t('library.anySurah')}</option>
                  {hasFree && <option value="free">{t('library.freeRecitation')}</option>}
                  {surahsInLib.map((s) => (
                    <option key={s.n} value={s.n}>
                      {t.n(s.n)}. {s.en} — {s.ar}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t('library.preset')}</span>
                <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>
                  <option value="any">{t('library.anyPreset')}</option>
                  {presetsInLib.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t.presetName(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t('library.date')}</span>
                <select className="select" value={date} onChange={(e) => setDate(e.target.value as DateFilter)}>
                  <option value="any">{t('date.any')}</option>
                  <option value="today">{t('date.today')}</option>
                  <option value="week">{t('date.week')}</option>
                  <option value="month">{t('date.month')}</option>
                  <option value="year">{t('date.year')}</option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {loaded && saved.length === 0 && drafts.length === 0 && (
        <Empty
          icon={<LibraryIcon />}
          title={t('library.empty')}
          body={t('library.emptyBody')}
          action={
            <Button variant="primary" icon={<Mic />} onClick={() => navigate('/studio')}>
              {t('library.startRecording')}
            </Button>
          }
        />
      )}

      {saved.length > 0 && list.length === 0 && (
        <div className="empty">
          <p>{t('library.noMatch')}</p>
          {filtered && (
            <Button variant="secondary" size="sm" onClick={clear}>
              {t('library.clearFilters')}
            </Button>
          )}
        </div>
      )}

      {list.length > 0 && (
        <div className="card rec-list" data-testid="library-list">
          {list.map((r) => (
            <RecordingRow key={r.id} meta={r} />
          ))}
        </div>
      )}
    </div>
  );
}
