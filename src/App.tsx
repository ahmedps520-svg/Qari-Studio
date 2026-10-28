import { lazy, Suspense, useEffect } from 'react';
import { engine } from './audio/engine';
import { useEngine } from './audio/hooks';
import { AppShell, useEffectiveTheme } from './components/AppShell';
import { useT } from './i18n';
import { recoverInterruptedRecordings } from './lib/recovery';
import { setNavigationGuard, useRoute } from './lib/router';
import { useLibrary } from './state/library';
import { useSettings } from './state/settings';
import { useStudio } from './state/studio';
import { HomeScreen } from './screens/Home';
import { QuranScreen } from './screens/Quran';
import { SurahScreen } from './screens/Surah';
import { StudioScreen } from './screens/Studio';
import { LibraryScreen } from './screens/Library';

const ReviewScreen = lazy(() => import('./screens/Review').then((m) => ({ default: m.ReviewScreen })));
const PresetsScreen = lazy(() => import('./screens/Presets').then((m) => ({ default: m.PresetsScreen })));
const SettingsScreen = lazy(() => import('./screens/Settings').then((m) => ({ default: m.SettingsScreen })));
const InfoScreen = lazy(() => import('./screens/Info').then((m) => ({ default: m.InfoScreen })));

function Router() {
  const r = useRoute();
  const [a, b] = r.segments;
  switch (a) {
    case undefined:
      return <HomeScreen />;
    case 'quran':
      return b ? <SurahScreen n={Number(b)} /> : <QuranScreen />;
    case 'studio':
      return <StudioScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'recording':
      return <ReviewScreen id={b ?? ''} />;
    case 'presets':
      return <PresetsScreen />;
    case 'settings':
      return b ? <InfoScreen page={b} /> : <SettingsScreen />;
    default:
      return <HomeScreen />;
  }
}

function useAppEffects() {
  const t = useT();
  const theme = useEffectiveTheme();
  const s = useSettings();
  const params = useStudio((x) => x.params);
  const recState = useEngine((x) => x.recording.state);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.lang = t.lang;
    root.dir = t.dir;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'ivory' ? '#f5f0e3' : '#050f0b');
    document.title = t.lang === 'ar' ? 'استوديو القارئ · Qari Studio' : 'Qari Studio';
  }, [theme, t.lang, t.dir]);

  useEffect(() => {
    engine.configure({
      latencyMode: s.latencyMode,
      inputGainDb: s.inputGainDb,
      monitorVolume: s.monitorVolume,
      noiseSuppression: s.browserNoiseSuppression,
      preferredInput: s.inputDeviceId,
      preferredOutput: s.outputDeviceId,
    });
  }, [s.latencyMode, s.inputGainDb, s.monitorVolume, s.browserNoiseSuppression, s.inputDeviceId, s.outputDeviceId]);

  useEffect(() => {
    engine.setParams(params);
  }, [params]);

  useEffect(() => {
    void (async () => {
      await recoverInterruptedRecordings().catch(() => undefined);
      await useLibrary.getState().refresh();
    })();
    void engine.refreshDevices();
  }, []);

  // Never lose a take to an accidental close or navigation.
  useEffect(() => {
    const active = recState === 'recording' || recState === 'paused' || recState === 'stopping';
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    if (active) window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [recState]);

  useEffect(() => {
    setNavigationGuard(null);
  }, []);
}

export default function App() {
  useAppEffects();
  return (
    <AppShell>
      <Suspense fallback={<div className="page" aria-busy="true" />}>
        <Router />
      </Suspense>
    </AppShell>
  );
}
