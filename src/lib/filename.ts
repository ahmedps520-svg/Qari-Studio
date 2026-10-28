/** Default export names, e.g. Quran_Ar-Rahman_2026-10-28.wav or Quran_Al-Mulk_Beautiful-Plus_2026-10-28.m4a */
export function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\+/g, ' Plus ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^A-Za-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function isoDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function defaultExportBase(opts: {
  surahName: string | null;
  presetName: string | null;
  createdAt: number;
  ayahFrom?: number | null;
  ayahTo?: number | null;
  ayahCount?: number;
}): string {
  const parts = ['Quran', opts.surahName ? slug(opts.surahName) : 'Recitation'];
  const partial = opts.ayahFrom && opts.ayahTo && opts.ayahCount && !(opts.ayahFrom === 1 && opts.ayahTo === opts.ayahCount);
  if (partial) parts.push(opts.ayahFrom === opts.ayahTo ? `Ayah-${opts.ayahFrom}` : `Ayah-${opts.ayahFrom}-${opts.ayahTo}`);
  if (opts.presetName) parts.push(slug(opts.presetName));
  parts.push(isoDate(opts.createdAt));
  return parts.filter(Boolean).join('_');
}

/** Make a user-supplied name safe for every major file system. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'Quran_Recitation';
}

export function stripExtension(name: string): string {
  return name.replace(/\.(wav|m4a|mp3|aac|mp4)$/i, '');
}
