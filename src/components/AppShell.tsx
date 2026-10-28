import { BookOpen, Home, Library, Moon, Settings, SlidersHorizontal, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { engine } from '../audio/engine';
import { useEngine, useFrameValue } from '../audio/hooks';
import { useT, type MessageKey } from '../i18n';
import { navigate, useRoute } from '../lib/router';
import { useSettings } from '../state/settings';
import { LogoMark, Wordmark } from './Brand';
import { ConfirmDialog, PromptDialog, Toasts } from './Overlays';

function StudioIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M5 20V11.5C5 7.7 8.1 5.2 12 3c3.9 2.2 7 4.7 7 8.5V20" />
      <path d="M9.5 14v2M12 11.5v7M14.5 14v2" />
    </svg>
  );
}

const NAV: { to: string; key: MessageKey; icon: ReactNode; match: (p: string) => boolean }[] = [
  { to: '/', key: 'nav.home', icon: <Home />, match: (p) => p === '/' },
  { to: '/quran', key: 'nav.quran', icon: <BookOpen />, match: (p) => p.startsWith('/quran') },
  { to: '/studio', key: 'nav.studio', icon: <StudioIcon />, match: (p) => p.startsWith('/studio') },
  { to: '/library', key: 'nav.library', icon: <Library />, match: (p) => p.startsWith('/library') || p.startsWith('/recording') },
];

export function useEffectiveTheme(): 'midnight' | 'ivory' {
  const theme = useSettings((s) => s.theme);
  const prefersLight = useFrameValue(() => window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false, theme === 'system', 2000);
  if (theme === 'system') return prefersLight ? 'ivory' : 'midnight';
  return theme;
}

export function ThemeToggle() {
  const t = useT();
  const effective = useEffectiveTheme();
  const set = useSettings((s) => s.set);
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
      onClick={() => set({ theme: effective === 'midnight' ? 'ivory' : 'midnight' })}
    >
      {effective === 'midnight' ? <Sun /> : <Moon />}
    </button>
  );
}

function RecordingIndicator() {
  const t = useT();
  const rec = useEngine((s) => s.recording.state);
  const route = useRoute();
  const active = rec === 'recording' || rec === 'paused';
  const secs = useFrameValue(() => engine.getRecordedSeconds(), active, 250);
  if (!active || route.path.startsWith('/studio')) return null;
  return (
    <button type="button" className="rec-pill" onClick={() => navigate('/studio')} aria-label={t('studio.returnToStudio')}>
      <span className={`dot ${rec === 'recording' ? 'pulse' : ''}`} />
      <span>{rec === 'recording' ? t('state.recording') : t('state.paused')}</span>
      <span className="num">{t.duration(secs)}</span>
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const route = useRoute();
  const rec = useEngine((s) => s.recording.state);
  const recActive = rec === 'recording' || rec === 'paused';
  const settingsActive = route.path.startsWith('/settings');
  const presetsActive = route.path.startsWith('/presets');

  return (
    <div className="app" dir={t.dir}>
      <a className="skip-link" href="#main" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        {t('nav.skip')}
      </a>
      <nav className="sidebar" aria-label={t('nav.main')}>
        <a className="brand" href="#/" aria-label={t('app.name')}>
          <LogoMark className="brand-mark" />
          <span className="brand-text">
            <Wordmark />
            <span className="brand-sub" style={{ display: 'block' }}>
              {t('app.tagline')}
            </span>
          </span>
        </a>
        {NAV.map((n) => (
          <a key={n.to} href={`#${n.to}`} className="side-link" aria-current={n.match(route.path) ? 'page' : undefined}>
            {n.icon}
            <span>{t(n.key)}</span>
            {n.to === '/studio' && recActive && <span className="side-rec-dot" aria-hidden="true" />}
          </a>
        ))}
        <a href="#/presets" className="side-link" aria-current={presetsActive ? 'page' : undefined}>
          <SlidersHorizontal />
          <span>{t('nav.presets')}</span>
        </a>
        <div className="spacer" />
        <a href="#/settings" className="side-link" aria-current={settingsActive ? 'page' : undefined}>
          <Settings />
          <span>{t('nav.settings')}</span>
        </a>
        <div className="side-theme">
          <ThemeToggle />
        </div>
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>

      <nav className="bottom-nav" aria-label={t('nav.main')}>
        {NAV.map((n) => (
          <a key={n.to} href={`#${n.to}`} className="tab" aria-current={n.match(route.path) ? 'page' : undefined}>
            <span className="tab-icon">{n.icon}</span>
            <span>{t(n.key)}</span>
            {n.to === '/studio' && recActive && <span className="rec-dot" aria-hidden="true" />}
          </a>
        ))}
      </nav>
      <RecordingIndicator />
      <Toasts />
      <ConfirmDialog />
      <PromptDialog />
    </div>
  );
}
