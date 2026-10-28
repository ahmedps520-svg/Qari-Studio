import { useCallback, useMemo } from 'react';
import { useSettings, type Language } from '../state/settings';
import { ar } from './ar';
import { en, type MessageKey } from './en';
import type { Preset } from '../audio/presets';
import type { Surah } from '../lib/quran';

export type { MessageKey };
const dicts: Record<Language, Record<MessageKey, string>> = { en, ar };

export type Vars = Record<string, string | number>;

export function fmtNumber(lang: Language, n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', opts).format(n);
}

export function translate(lang: Language, key: MessageKey, vars?: Vars): string {
  let s = dicts[lang][key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      const val = typeof v === 'number' ? fmtNumber(lang, v) : v;
      s = s.split(`{${k}}`).join(val);
    }
  }
  return s;
}

const pluralRules: Partial<Record<Language, Intl.PluralRules>> = {};

export function plural(lang: Language, base: 'unit.ayah' | 'unit.recording', n: number): string {
  const rules = (pluralRules[lang] ??= new Intl.PluralRules(lang));
  let cat = rules.select(n) as string;
  if (cat === 'zero') cat = 'other';
  const key = `${base}.${cat}` as MessageKey;
  return translate(lang, key in en ? key : (`${base}.other` as MessageKey), { n });
}

/** m:ss (or h:mm:ss), with locale digits. */
export function fmtDuration(lang: Language, sec: number, tenths = false): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  const pad = (x: number) => String(x).padStart(2, '0');
  let out = h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  if (tenths) out += `.${Math.floor((s * 10) % 10)}`;
  return lang === 'ar' ? out.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : out;
}

export function fmtDate(lang: Language, ts: number, withTime = false): string {
  const o: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) Object.assign(o, { hour: 'numeric', minute: '2-digit' });
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', o).format(new Date(ts));
}

export function fmtBytes(lang: Language, bytes: number): string {
  const units = lang === 'ar' ? ['بايت', 'ك.ب', 'م.ب', 'غ.ب', 'ت.ب'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${fmtNumber(lang, v, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

export function useLang(): Language {
  return useSettings((s) => s.language);
}

export function useT() {
  const lang = useLang();
  const t = useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang]);
  return useMemo(
    () =>
      Object.assign(t, {
        lang,
        dir: lang === 'ar' ? ('rtl' as const) : ('ltr' as const),
        n: (x: number, o?: Intl.NumberFormatOptions) => fmtNumber(lang, x, o),
        plural: (base: 'unit.ayah' | 'unit.recording', x: number) => plural(lang, base, x),
        duration: (sec: number, tenths = false) => fmtDuration(lang, sec, tenths),
        date: (ts: number, withTime = false) => fmtDate(lang, ts, withTime),
        bytes: (b: number) => fmtBytes(lang, b),
        presetName: (p: Pick<Preset, 'id' | 'builtIn' | 'name'> | undefined, fallback?: string) =>
          presetName(lang, p, fallback),
        surahEnglish: (s: Surah) => `${translate('en', 'surah.prefix')} ${s.en}`,
        surahArabic: (s: Surah) => `سورة ${s.ar}`,
      }),
    [t, lang],
  );
}

export type T = ReturnType<typeof useT>;

export function presetName(lang: Language, p: Pick<Preset, 'id' | 'builtIn' | 'name'> | undefined, fallback = ''): string {
  if (!p) return fallback;
  if (p.builtIn) return translate(lang, `preset.${p.id}.name` as MessageKey);
  return p.name || fallback || translate(lang, 'presets.custom.name');
}
