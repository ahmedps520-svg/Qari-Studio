import { ChevronRight, Mic, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { getSurah, searchSurahs, type Surah } from '../lib/quran';
import type { Selection } from '../state/settings';
import { StarFrame } from './Brand';
import { Button, IconButton, OptionList, Sheet } from './ui';

export function SurahNumber({ n }: { n: number }) {
  const t = useT();
  return (
    <span className="surah-num" aria-hidden="true">
      <StarFrame />
      <span>{t.n(n)}</span>
    </span>
  );
}

export function SurahRow({ s, onClick, aside }: { s: Surah; onClick?: () => void; aside?: React.ReactNode }) {
  const t = useT();
  const content = (
    <>
      <SurahNumber n={s.n} />
      <span className="grow">
        <span className="surah-row-en">{s.en}</span>
        <span className="surah-row-meta">
          {t.lang === 'ar' ? t.plural('unit.ayah', s.ayahs) : `${s.meaning} · ${t.plural('unit.ayah', s.ayahs)}`}
          {' · '}
          {s.type === 'meccan' ? t('quran.meccan') : t('quran.medinan')}
        </span>
      </span>
      <span className="surah-row-ar ar" lang="ar">
        {s.ar}
      </span>
      {aside}
    </>
  );
  return onClick ? (
    <button type="button" className="list-row surah-row" onClick={onClick} aria-label={`${t.surahEnglish(s)} — ${t.surahArabic(s)}`}>
      {content}
    </button>
  ) : (
    <div className="list-row surah-row">{content}</div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  return (
    <div className="search">
      <Search />
      <input
        className="input"
        type="search"
        inputMode="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-autofocus={autoFocus ? true : undefined}
        enterKeyHint="search"
      />
      {value && (
        <IconButton className="clear" size="sm" label={t('common.clear')} onClick={() => onChange('')}>
          <X />
        </IconButton>
      )}
    </div>
  );
}

/** Ayah range chooser: whole surah or from/to. */
export function RangeChooser({
  surah,
  from,
  to,
  onChange,
}: {
  surah: Surah;
  from: number | null;
  to: number | null;
  onChange: (from: number | null, to: number | null) => void;
}) {
  const t = useT();
  const partial = from !== null && to !== null && !(from === 1 && to === surah.ayahs);
  const [mode, setMode] = useState<'whole' | 'partial'>(partial ? 'partial' : 'whole');
  const f = from ?? 1;
  const tt = to ?? surah.ayahs;
  const nums = useMemo(() => Array.from({ length: surah.ayahs }, (_, i) => i + 1), [surah.ayahs]);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <OptionList
        label={t('range.title')}
        value={mode}
        onChange={(m) => {
          setMode(m);
          if (m === 'whole') onChange(null, null);
          else onChange(f, tt);
        }}
        options={[
          { value: 'whole', title: t('range.whole'), sub: t.plural('unit.ayah', surah.ayahs) },
          { value: 'partial', title: t('range.partial'), sub: mode === 'partial' ? t('range.label', { from: f, to: tt }) : undefined },
        ]}
      />
      {mode === 'partial' && (
        <div className="range-row">
          <label className="field grow">
            <span className="field-label">{t('range.from')}</span>
            <select
              className="select"
              value={f}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange(v, Math.max(v, tt));
              }}
            >
              {nums.map((n) => (
                <option key={n} value={n}>
                  {t.n(n)}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span className="field-label">{t('range.to')}</span>
            <select
              className="select"
              value={tt}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange(Math.min(f, v), v);
              }}
            >
              {nums.map((n) => (
                <option key={n} value={n}>
                  {t.n(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
        {t('range.note')}
      </p>
    </div>
  );
}

/** "What will you recite?" — surah search, free recitation, then the ayah range. */
export function RecitePicker({
  open,
  onClose,
  onPick,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (sel: Selection) => void;
  initial?: Selection;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Surah | null>(null);
  const [range, setRange] = useState<{ from: number | null; to: number | null }>({ from: null, to: null });

  useEffect(() => {
    if (open) {
      setQ('');
      setPicked(null);
      setRange({ from: initial?.from ?? null, to: initial?.to ?? null });
    }
  }, [open, initial?.from, initial?.to]);

  const results = useMemo(() => searchSurahs(q), [q]);
  const current = getSurah(initial?.surah);

  if (picked) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={t('range.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPicked(null)}>
              {t('common.back')}
            </Button>
            <Button
              variant="primary"
              icon={<Mic />}
              onClick={() => onPick({ surah: picked.n, from: range.from, to: range.to })}
              data-testid="range-apply"
            >
              {t('range.apply')}
            </Button>
          </>
        }
      >
        <div className="picker-head">
          <SurahNumber n={picked.n} />
          <div className="grow">
            <div className="ar picker-ar" lang="ar">
              {t.surahArabic(picked)}
            </div>
            <div className="muted">
              {t.surahEnglish(picked)} · {t.plural('unit.ayah', picked.ayahs)}
            </div>
          </div>
        </div>
        <RangeChooser surah={picked} from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('picker.title')} width="wide">
      <div className="picker-search">
        <SearchBox value={q} onChange={setQ} placeholder={t('quran.search')} autoFocus />
      </div>
      {!q && (
        <button type="button" className="list-row free-row" onClick={() => onPick({ surah: null, from: null, to: null })}>
          <span className="free-icon">
            <Mic />
          </span>
          <span className="grow">
            <span className="surah-row-en">{t('picker.free')}</span>
            <span className="surah-row-meta">{t('picker.freeSub')}</span>
          </span>
          <ChevronRight className="chev" />
        </button>
      )}
      {!q && current && (
        <div className="picker-current">
          <SurahRow
            s={current}
            onClick={() => {
              setPicked(current);
            }}
          />
        </div>
      )}
      <div className="list">
        {results.map((s) => (
          <SurahRow
            key={s.n}
            s={s}
            onClick={() => {
              setPicked(s);
              setRange(initial?.surah === s.n ? { from: initial.from, to: initial.to } : { from: null, to: null });
            }}
          />
        ))}
        {results.length === 0 && <p className="muted" style={{ padding: 20 }}>{t('quran.noResults', { q })}</p>}
      </div>
    </Sheet>
  );
}
