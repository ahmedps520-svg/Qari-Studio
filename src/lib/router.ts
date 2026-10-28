import { useSyncExternalStore } from 'react';

/** Minimal hash router — works on any static host and offline. */
export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  const path = p.startsWith('/') ? p : `/${p}`;
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

let current = typeof window !== 'undefined' ? parse() : { path: '/', segments: [], query: new URLSearchParams() };
const listeners = new Set<() => void>();
let guard: ((to: string) => boolean) | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse();
    for (const l of listeners) l();
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (guard && !guard(to)) return;
  const hash = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (opts.replace) {
    window.history.replaceState(null, '', hash);
    current = parse();
    for (const l of listeners) l();
  } else if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
  window.scrollTo({ top: 0 });
}

export function back(fallback = '/') {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

export function setNavigationGuard(fn: ((to: string) => boolean) | null) {
  guard = fn;
}
