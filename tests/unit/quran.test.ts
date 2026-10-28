import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import text from '../../src/data/quran-uthmani.json';
import { getSurah, searchSurahs, SURAHS } from '../../src/lib/quran';

describe('surah metadata', () => {
  it('has all 114 surahs and 6236 ayahs', () => {
    expect(SURAHS).toHaveLength(114);
    expect(SURAHS.reduce((a, s) => a + s.ayahs, 0)).toBe(6236);
    SURAHS.forEach((s, i) => expect(s.n).toBe(i + 1));
  });

  it('matches well-known values', () => {
    expect(getSurah(55)).toMatchObject({ ar: 'الرحمن', en: 'Ar-Rahman', ayahs: 78 });
    expect(getSurah(67)).toMatchObject({ ar: 'الملك', en: 'Al-Mulk', ayahs: 30, type: 'meccan' });
    expect(getSurah(1)).toMatchObject({ ar: 'الفاتحة', ayahs: 7, type: 'meccan' });
    expect(getSurah(2)).toMatchObject({ ar: 'البقرة', ayahs: 286, type: 'medinan' });
    expect(getSurah(114)).toMatchObject({ ar: 'الناس', ayahs: 6 });
    expect(getSurah(0)).toBeNull();
    expect(getSurah(115)).toBeNull();
  });
});

describe('Quran text (Tanzil Uthmani, verbatim)', () => {
  const q = text as unknown as { sha256: string; copyright: string; suras: { n: number; bismillah: string | null; ayahs: string[] }[] };

  it('is unmodified since generation (checksum)', () => {
    const joined = q.suras.map((s) => [s.bismillah ?? '', ...s.ayahs].join('\n')).join('\n');
    expect(createHash('sha256').update(joined, 'utf8').digest('hex')).toBe(q.sha256);
  });

  it('keeps the Tanzil copyright notice', () => {
    expect(q.copyright).toContain('Tanzil Project');
    expect(q.copyright).toContain('CHANGING IT IS NOT ALLOWED');
  });

  it('has the right ayah count for every surah and the basmala where Tanzil marks it', () => {
    q.suras.forEach((s, i) => {
      expect(s.ayahs).toHaveLength(SURAHS[i].ayahs);
      expect(Boolean(s.bismillah)).toBe(s.n !== 1 && s.n !== 9);
    });
    // Exact code points as published by Tanzil (shadda precedes fatha — not NFC order — so the
    // app must never Unicode-normalise the text).
    const cp = (hex: string) => String.fromCodePoint(...hex.split(' ').map((h) => parseInt(h, 16)));
    expect(q.suras[0].ayahs[0]).toBe(
      cp('628 650 633 652 645 650 20 671 644 644 651 64e 647 650 20 671 644 631 651 64e 62d 652 645 64e 670 646 650 20 671 644 631 651 64e 62d 650 64a 645 650'),
    );
    expect(q.suras[1].bismillah).toBe(q.suras[0].ayahs[0]);
    expect(q.suras[0].ayahs[0].normalize('NFC')).not.toBe(q.suras[0].ayahs[0]);
  });
});

describe('surah search', () => {
  const first = (q: string) => searchSurahs(q)[0]?.n;
  it('finds by English name, loosely', () => {
    expect(first('rahman')).toBe(55);
    expect(first('Ar-Rahman')).toBe(55);
    expect(first('mulk')).toBe(67);
    expect(first('yaseen')).toBe(36);
    expect(first('fatiha')).toBe(1);
    expect(first('Surah Al-Kahf')).toBe(18);
    expect(first('the cow')).toBe(2);
  });
  it('finds by Arabic name, with or without diacritics, hamza or the article', () => {
    expect(first('الرحمن')).toBe(55);
    expect(first('رحمن')).toBe(55);
    expect(first('سورة الملك')).toBe(67);
    expect(first('الإخلاص')).toBe(112);
    expect(first('الاخلاص')).toBe(112);
  });
  it('finds by number, in Latin or Arabic-Indic digits', () => {
    expect(first('55')).toBe(55);
    expect(first('٥٥')).toBe(55);
    expect(searchSurahs('11').map((s) => s.n).slice(0, 4)).toEqual([11, 110, 111, 112]);
  });
  it('returns everything for an empty query and nothing for nonsense', () => {
    expect(searchSurahs('')).toHaveLength(114);
    expect(searchSurahs('zzzzqqq')).toHaveLength(0);
  });
});
