import { AArrowDown, AArrowUp, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { loadSurahText, type Surah, type SurahText } from '../lib/quran';
import { useSettings } from '../state/settings';
import { IconButton, Notice } from './ui';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const arabicDigits = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

/**
 * Verified Quran text (Tanzil Uthmani, unmodified). Ayahs are separated with the standard end-
 * of-ayah sign; the basmala is shown as a heading where Tanzil provides it (not for Al-Fatihah,
 * where it is the first ayah, nor At-Tawbah, which has none).
 */
export function ReadingView({
  surah,
  from,
  to,
  trackProgress,
  scrollToAyah,
  onHide,
  compact,
}: {
  surah: Surah;
  from?: number | null;
  to?: number | null;
  trackProgress?: boolean;
  scrollToAyah?: number | null;
  onHide?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const scale = useSettings((s) => s.readingScale);
  const setSettings = useSettings((s) => s.set);
  const [text, setText] = useState<SurahText | null>(null);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(false);
    loadSurahText(surah.n)
      .then((x) => alive && setText(x))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [surah.n]);

  const start = Math.max(1, from ?? 1);
  const end = Math.min(surah.ayahs, to ?? surah.ayahs);

  useEffect(() => {
    if (!text || !scrollToAyah || !ref.current) return;
    const el = ref.current.querySelector(`[data-ayah="${scrollToAyah}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [text, scrollToAyah]);

  useEffect(() => {
    if (!trackProgress || !text || !ref.current) return;
    const seen = new Map<number, boolean>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(Number((e.target as HTMLElement).dataset.ayah), e.isIntersecting);
        const visible = [...seen.entries()].filter(([, v]) => v).map(([k]) => k);
        if (visible.length === 0) return;
        const first = Math.min(...visible);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setSettings({ reading: { surah: surah.n, ayah: first } }), 600);
      },
      { rootMargin: '-20% 0px -40% 0px' },
    );
    ref.current.querySelectorAll('[data-ayah]').forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [trackProgress, text, surah.n, setSettings]);

  const setScale = (v: number) => setSettings({ readingScale: Math.max(0.75, Math.min(1.9, Math.round(v * 100) / 100)) });

  return (
    <div className={`reading ${compact ? 'compact' : ''}`}>
      <div className="reading-tools">
        <span className="faint reading-source">{t('reading.source')}</span>
        <div className="grow" />
        <IconButton size="sm" label={t('reading.smaller')} onClick={() => setScale(scale - 0.1)} disabled={scale <= 0.75}>
          <AArrowDown />
        </IconButton>
        <IconButton size="sm" label={t('reading.larger')} onClick={() => setScale(scale + 0.1)} disabled={scale >= 1.9}>
          <AArrowUp />
        </IconButton>
        {onHide && (
          <IconButton size="sm" label={t('reading.hide')} onClick={onHide}>
            <EyeOff />
          </IconButton>
        )}
      </div>
      {error && <Notice kind="error">{t('reading.error')}</Notice>}
      {!text && !error && (
        <p className="faint" style={{ padding: '24px 0' }}>
          {t('reading.loading')}
        </p>
      )}
      {text && (
        <div
          ref={ref}
          className="reading-body quran-text"
          lang="ar"
          dir="rtl"
          style={{ '--q-scale': scale } as React.CSSProperties}
        >
          {text.bismillah && start === 1 && <p className="basmala">{text.bismillah}</p>}
          <p className="ayahs">
            {text.ayahs.slice(start - 1, end).map((a, i) => {
              const n = start + i;
              return (
                <span key={n} className="ayah" data-ayah={n}>
                  {a}
                  <span className="ayah-end" aria-label={t('reading.ayahLabel', { n })}>
                    {'۝'}
                    {arabicDigits(n)}
                  </span>{' '}
                </span>
              );
            })}
          </p>
        </div>
      )}
      <p className="faint reading-foot">{t('reading.noTranslation')}</p>
    </div>
  );
}
