import { ArrowRight, BookOpen, Headphones, Library, Mic, Settings, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { GeometricPattern, LogoMark, Wordmark } from '../components/Brand';
import { RecordingRow } from '../components/RecordingRow';
import { ThemeToggle } from '../components/AppShell';
import { RecitePicker, SurahNumber } from '../components/SurahPicker';
import { recordingPresetName } from '../components/ExportSheet';
import { Button, IconButton, Notice } from '../components/ui';
import { useT } from '../i18n';
import { getSurah } from '../lib/quran';
import { navigate } from '../lib/router';
import { useLibrary } from '../state/library';
import { useSettings, type Selection } from '../state/settings';

export function hijriDate(lang: 'en' | 'ar', d = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-islamic-umalqura' : 'en-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return null;
  }
}

export function startRecitation(sel: Selection) {
  useSettings.getState().set({ selection: sel, ...(sel.surah ? { lastSurahVisited: sel.surah } : {}) });
  navigate('/studio');
}

export function HomeScreen() {
  const t = useT();
  const name = useSettings((s) => s.name);
  const selection = useSettings((s) => s.selection);
  const lastVisited = useSettings((s) => s.lastSurahVisited);
  const reading = useSettings((s) => s.reading);
  const recordings = useLibrary((s) => s.recordings);
  const [picker, setPicker] = useState(false);

  const saved = useMemo(() => recordings.filter((r) => r.status === 'saved'), [recordings]);
  const drafts = useMemo(() => recordings.filter((r) => r.status === 'draft'), [recordings]);
  const lastSurah = getSurah(selection.surah ?? lastVisited);
  const lastForSurah = lastSurah ? saved.find((r) => r.surah === lastSurah.n) : undefined;
  const readingSurah = reading ? getSurah(reading.surah) : null;
  const weekday = new Intl.DateTimeFormat(t.lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long' }).format(new Date());
  const hijri = hijriDate(t.lang);

  return (
    <div className="page home">
      <header className="home-top">
        <a className="brand home-brand" href="#/" aria-label={t('app.name')}>
          <LogoMark className="brand-mark" />
          <Wordmark />
        </a>
        <div className="grow" />
        <ThemeToggle />
        <IconButton label={t('settings.open')} onClick={() => navigate('/settings')}>
          <Settings />
        </IconButton>
      </header>

      <section className="greeting" aria-labelledby="greeting">
        <p className="eyebrow">
          {weekday}
          {hijri ? ` · ${hijri}` : ''}
        </p>
        <h1 id="greeting" className="page-title">
          {name ? t('greeting.withName', { name }) : t('greeting.salam')}
        </h1>
        <p className="page-sub">{t('home.subtitle')}</p>
      </section>

      <button type="button" className="hero-start" onClick={() => setPicker(true)} data-testid="start-reciting">
        <GeometricPattern id="hero-pattern" />
        <span className="hero-mic">
          <Mic />
        </span>
        <span className="hero-text">
          <span className="hero-title">{t('home.start')}</span>
          <span className="hero-sub">{t('home.startSub')}</span>
        </span>
        <span className="hero-arrow">
          <ArrowRight />
        </span>
      </button>

      {drafts.length > 0 && (
        <div className="section">
          <Notice
            kind="warn"
            actions={
              <Button size="sm" variant="secondary" onClick={() => navigate(`/recording/${drafts[0].id}`)}>
                {t('home.review')}
              </Button>
            }
          >
            <strong>{t('home.recovered')}</strong>
            <br />
            {t('home.recoveredBody', { date: t.date(drafts[0].createdAt, true) })}
          </Notice>
        </div>
      )}

      <div className="home-grid">
        <div className="home-col">
          {lastSurah && (
            <section className="section" aria-labelledby="continue-h">
              <div className="section-head">
                <h2 id="continue-h" className="section-title">
                  {t('home.continue')}
                </h2>
              </div>
              <div className="card card-pad continue-card">
                <div className="continue-top">
                  <SurahNumber n={lastSurah.n} />
                  <div className="grow">
                    <div className="continue-ar ar" lang="ar">
                      {t.surahArabic(lastSurah)}
                    </div>
                    <div className="continue-en">{t.surahEnglish(lastSurah)}</div>
                    <div className="faint continue-meta">
                      {t.plural('unit.ayah', lastSurah.ayahs)} · {lastSurah.type === 'meccan' ? t('quran.meccan') : t('quran.medinan')}
                    </div>
                  </div>
                </div>
                <div className="continue-last">
                  {lastForSurah ? (
                    <>
                      <span className="faint">{t('home.lastSaved')}</span>
                      <button type="button" className="link-inline" onClick={() => navigate(`/recording/${lastForSurah.id}`)}>
                        {lastForSurah.title}
                      </button>
                      <span className="faint num">
                        {t.date(lastForSurah.createdAt)} · {t.duration(lastForSurah.duration)} · {recordingPresetName(t, lastForSurah)}
                      </span>
                    </>
                  ) : (
                    <span className="faint">{t('home.noRecordingYet')}</span>
                  )}
                </div>
                <div className="continue-actions">
                  <Button
                    variant="primary"
                    icon={<Mic />}
                    onClick={() =>
                      startRecitation(
                        selection.surah === lastSurah.n ? selection : { surah: lastSurah.n, from: null, to: null },
                      )
                    }
                  >
                    {t('home.continueRecording')}
                  </Button>
                  <Button variant="secondary" icon={<BookOpen />} onClick={() => navigate(`/quran/${lastSurah.n}`)}>
                    {t('home.openSurah')}
                  </Button>
                </div>
              </div>
            </section>
          )}

          <section className="section" aria-labelledby="recent-h">
            <div className="section-head">
              <h2 id="recent-h" className="section-title">
                {t('home.recent')}
              </h2>
              {saved.length > 0 && (
                <a className="section-link" href="#/library">
                  {t('home.viewAll')}
                </a>
              )}
            </div>
            {saved.length > 0 ? (
              <div className="card rec-list">
                {saved.slice(0, 4).map((r) => (
                  <RecordingRow key={r.id} meta={r} compact />
                ))}
              </div>
            ) : (
              <div className="card-quiet empty-inline">
                <p className="muted">{t('home.recentEmpty')}</p>
              </div>
            )}
          </section>
        </div>

        <div className="home-col">
          <section className="section" aria-labelledby="quick-h">
            <div className="section-head">
              <h2 id="quick-h" className="section-title">
                {t('home.quick')}
              </h2>
            </div>
            <div className="quick-grid">
              <a className="quick-tile" href="#/studio?panel=live">
                <span className="quick-icon emerald">
                  <Headphones />
                </span>
                <span className="quick-title">{t('quick.live')}</span>
                <span className="quick-sub">{t('quick.liveSub')}</span>
              </a>
              <a className="quick-tile" href="#/studio">
                <span className="quick-icon rec">
                  <Mic />
                </span>
                <span className="quick-title">{t('quick.new')}</span>
                <span className="quick-sub">{t('quick.newSub')}</span>
              </a>
              <a className="quick-tile" href="#/library">
                <span className="quick-icon gold">
                  <Library />
                </span>
                <span className="quick-title">{t('quick.library')}</span>
                <span className="quick-sub">{t.plural('unit.recording', saved.length)}</span>
              </a>
              <a className="quick-tile" href="#/presets">
                <span className="quick-icon">
                  <SlidersHorizontal />
                </span>
                <span className="quick-title">{t('quick.presets')}</span>
                <span className="quick-sub">{t('quick.presetsSub')}</span>
              </a>
            </div>
          </section>

          <section className="section" aria-labelledby="daily-h">
            <div className="section-head">
              <h2 id="daily-h" className="section-title">
                {t('home.daily')}
              </h2>
            </div>
            <div className="card card-pad daily-card">
              <p className="muted">{t('home.dailyBody')}</p>
              {readingSurah && reading && (
                <p className="daily-resume">
                  <span className="ar" lang="ar">
                    {t.surahArabic(readingSurah)}
                  </span>
                  <span className="faint">{t('home.dailyResumeAt', { surah: readingSurah.en, ayah: reading.ayah })}</span>
                </p>
              )}
              <div className="continue-actions">
                <Button variant="secondary" icon={<BookOpen />} onClick={() => navigate('/quran')}>
                  {t('home.dailyChoose')}
                </Button>
                {readingSurah && reading && (
                  <Button variant="gold" onClick={() => navigate(`/quran/${readingSurah.n}?read=1&ayah=${reading.ayah}`)}>
                    {t('home.dailyResume')}
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      <RecitePicker
        open={picker}
        onClose={() => setPicker(false)}
        initial={selection}
        onPick={(sel) => {
          setPicker(false);
          startRecitation(sel);
        }}
      />
    </div>
  );
}
