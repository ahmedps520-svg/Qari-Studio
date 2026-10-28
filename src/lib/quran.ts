import surahData from '../data/surahs.json';

/**
 * Surah metadata — Tanzil Project (names, ayah counts, classification) with English
 * transliterations from Quran.com, verified against each other at build time
 * (scripts/build-quran-data.mjs). Nothing here is generated or edited by hand.
 */
export interface Surah {
  n: number;
  ar: string;
  en: string;
  tr: string;
  meaning: string;
  ayahs: number;
  type: 'meccan' | 'medinan';
  order: number;
  start: number;
}

export const SURAHS: Surah[] = (surahData as { surahs: Surah[] }).surahs;
export const SURAH_SOURCE = (surahData as { source: Record<string, string> }).source;

export function getSurah(n: number | null | undefined): Surah | null {
  if (!n || n < 1 || n > 114) return null;
  return SURAHS[n - 1] ?? null;
}

const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

export function normalizeArabic(s: string): string {
  return s
    .replace(/^\s*سور[ةه]\s+/, '')
    .replace(ARABIC_MARKS, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/^\s*سورة\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose Latin key so "yaseen" finds "Ya-Sin" and "rahmaan" finds "Ar-Rahman". */
export function latinKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(surah|sura|surat)\s+/, '')
    .replace(/[^a-z]/g, '')
    .replace(/ee/g, 'i')
    .replace(/oo|ou/g, 'u')
    .replace(/(.)\1+/g, '$1');
}

export function toLatinDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

interface Indexed {
  s: Surah;
  ar: string;
  keys: string[];
}
const INDEX: Indexed[] = SURAHS.map((s) => ({
  s,
  ar: normalizeArabic(s.ar),
  keys: [latinKey(s.en), latinKey(s.tr), latinKey(s.meaning)],
}));

/** Search by Arabic name, English name/transliteration/meaning, or surah number. */
export function searchSurahs(query: string): Surah[] {
  const q = toLatinDigits(query).trim();
  if (!q) return SURAHS;
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const exact = SURAHS.filter((s) => s.n === n);
    const prefix = SURAHS.filter((s) => s.n !== n && String(s.n).startsWith(q));
    return [...exact, ...prefix];
  }
  const scored: { s: Surah; score: number }[] = [];
  if (/[؀-ۿ]/.test(q)) {
    const nq = normalizeArabic(q);
    const nqNoAl = nq.replace(/^ال/, '');
    for (const it of INDEX) {
      const name = it.ar;
      const bare = name.replace(/^ال/, '');
      let score = -1;
      if (name === nq || bare === nqNoAl) score = 0;
      else if (name.startsWith(nq) || bare.startsWith(nqNoAl)) score = 1;
      else if (name.includes(nqNoAl)) score = 2;
      if (score >= 0) scored.push({ s: it.s, score });
    }
  } else {
    const k = latinKey(q);
    if (!k) return SURAHS;
    for (const it of INDEX) {
      let score = -1;
      it.keys.forEach((key, i) => {
        const stripped = key.replace(/^(al|an|ar|as|at|ad|adh|ash|az|ath)(?=[a-z]{3})/, '');
        let s = -1;
        if (key === k || stripped === k) s = 0;
        else if (key.startsWith(k) || stripped.startsWith(k)) s = 1;
        else if (key.includes(k)) s = 2;
        if (s >= 0) {
          const w = s * 3 + i; // prefer the common name over transliteration over meaning
          if (score < 0 || w < score) score = w;
        }
      });
      if (score >= 0) scored.push({ s: it.s, score });
    }
  }
  return scored.sort((a, b) => a.score - b.score || a.s.n - b.s.n).map((x) => x.s);
}

export interface SurahText {
  n: number;
  bismillah: string | null;
  ayahs: string[];
}

export interface QuranText {
  copyright: string;
  source: string;
  edition: string;
  sha256: string;
  suras: SurahText[];
}

let textPromise: Promise<QuranText> | null = null;

/** Lazily load the verified Tanzil Uthmani text (bundled; works offline). */
export function loadQuranText(): Promise<QuranText> {
  if (!textPromise) {
    textPromise = import('../data/quran-uthmani.json').then((m) => (m.default ?? m) as unknown as QuranText);
    textPromise.catch(() => {
      textPromise = null;
    });
  }
  return textPromise;
}

export async function loadSurahText(n: number): Promise<SurahText | null> {
  const t = await loadQuranText();
  return t.suras[n - 1] ?? null;
}
