#!/usr/bin/env node
/**
 * Builds Qari Studio's bundled Quran data from verified upstream sources.
 *
 *   - Tanzil Project (https://tanzil.net) — Uthmani Quran text (v1.1) and surah metadata
 *     (Arabic names, ayah counts, revelation classification, revelation order).
 *   - Quran.com API v4 (https://api.quran.com) — common English transliterations of surah
 *     names, used for display and cross-checked against Tanzil.
 *
 * The Quran text is copied VERBATIM. It is only restructured from XML into JSON; no
 * character is altered. The Tanzil copyright notice is reproduced in the output files as
 * required by its terms of use.
 *
 * Usage: node scripts/build-quran-data.mjs [--from <dir with quran-uthmani.xml, quran-data.xml, chapters.json>]
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src', 'data');

const SOURCES = {
  text: 'https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=xml&agree=true',
  meta: 'https://tanzil.net/res/text/metadata/quran-data.xml',
  chapters: 'https://api.quran.com/api/v4/chapters?language=en',
};

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const fromDir = fromIdx >= 0 ? args[fromIdx + 1] : null;

async function load(name, url, file) {
  if (fromDir) return readFileSync(join(fromDir, file), 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${name}: HTTP ${res.status}`);
  return await res.text();
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

const textXml = await load('Quran text', SOURCES.text, 'quran-uthmani.xml');
const metaXml = await load('Quran metadata', SOURCES.meta, 'quran-data.xml');
const chaptersJson = JSON.parse(await load('Quran.com chapters', SOURCES.chapters, 'chapters.json'));

// ---- Copyright block (must be reproduced verbatim) ----
const copyrightMatch = textXml.match(/<!--([\s\S]*?)-->/);
if (!copyrightMatch) fail('Tanzil copyright block not found in text file');
const copyright = copyrightMatch[1].replace(/^\s*\n/, '').replace(/\s+$/, '');
const versionMatch = copyright.match(/Tanzil Quran Text \(([^)]+)\)/);
const textVersion = versionMatch ? versionMatch[1] : 'unknown';

// ---- Parse text ----
const suras = [];
const suraRe = /<sura\s+([^>]*)>([\s\S]*?)<\/sura>/g;
for (const m of textXml.matchAll(suraRe)) {
  const sa = attrs(m[1]);
  const ayahs = [];
  let bismillah = null;
  for (const a of m[2].matchAll(/<aya\s+([^>]*?)\/>/g)) {
    const aa = attrs(a[1]);
    const idx = Number(aa.index);
    if (idx !== ayahs.length + 1) fail(`Surah ${sa.index}: ayah index ${idx} out of order`);
    if (aa.bismillah) {
      if (idx !== 1) fail(`Surah ${sa.index}: bismillah on ayah ${idx}`);
      bismillah = aa.bismillah;
    }
    ayahs.push(aa.text);
  }
  suras.push({ n: Number(sa.index), name: sa.name, bismillah, ayahs });
}

// ---- Parse metadata ----
const meta = [];
for (const m of metaXml.matchAll(/<sura\s+([^>]*?)\/>/g)) {
  const a = attrs(m[1]);
  meta.push({
    n: Number(a.index),
    ayas: Number(a.ayas),
    start: Number(a.start),
    name: a.name,
    tname: a.tname,
    ename: a.ename,
    type: a.type,
    order: Number(a.order),
    rukus: Number(a.rukus),
  });
}
const chapters = chaptersJson.chapters;

// ---- Verification ----
const report = [];
const check = (cond, msg) => {
  if (!cond) fail(msg);
};
check(suras.length === 114, `Expected 114 surahs in text, found ${suras.length}`);
check(meta.length === 114, `Expected 114 surahs in metadata, found ${meta.length}`);
check(chapters.length === 114, `Expected 114 chapters from Quran.com, found ${chapters.length}`);

let total = 0;
for (let i = 0; i < 114; i++) {
  const s = suras[i];
  const md = meta[i];
  const ch = chapters[i];
  check(s.n === i + 1 && md.n === i + 1 && ch.id === i + 1, `Surah ordering mismatch at ${i + 1}`);
  check(s.ayahs.length === md.ayas, `Surah ${s.n}: text has ${s.ayahs.length} ayahs, metadata says ${md.ayas}`);
  check(md.ayas === ch.verses_count, `Surah ${s.n}: Tanzil ayah count ${md.ayas} ≠ Quran.com ${ch.verses_count}`);
  check(md.start === total, `Surah ${s.n}: metadata start ${md.start} ≠ cumulative ${total}`);
  check(s.name === md.name, `Surah ${s.n}: Arabic name differs between Tanzil text and metadata`);
  const expectBismillah = s.n !== 1 && s.n !== 9;
  check(Boolean(s.bismillah) === expectBismillah, `Surah ${s.n}: unexpected bismillah presence`);
  check(ch.bismillah_pre === expectBismillah, `Surah ${s.n}: Quran.com bismillah_pre disagrees`);
  for (const [j, t] of s.ayahs.entries()) check(t && t.trim().length > 0, `Surah ${s.n}:${j + 1} is empty`);
  const norm = (x) => x.normalize('NFC').replace(/[آأإ]/g, 'ا').replace(/\s+/g, ' ').trim();
  if (norm(md.name) !== norm(ch.name_arabic)) report.push(`note: Arabic name for ${s.n} differs (Tanzil "${md.name}", Quran.com "${ch.name_arabic}") — using Tanzil`);
  const qType = ch.revelation_place === 'makkah' ? 'Meccan' : 'Medinan';
  if (qType !== md.type) report.push(`note: revelation classification for ${s.n} differs (Tanzil ${md.type}, Quran.com ${qType}) — using Tanzil`);
  check(md.order === ch.revelation_order, `Surah ${s.n}: revelation order differs (${md.order} vs ${ch.revelation_order})`);
  total += s.ayahs.length;
}
check(total === 6236, `Expected 6236 ayahs in total, found ${total}`);

// ---- Output ----
const textConcat = suras.map((s) => [s.bismillah ?? '', ...s.ayahs].join('\n')).join('\n');
const sha256 = createHash('sha256').update(textConcat, 'utf8').digest('hex');

const surahs = meta.map((md, i) => ({
  n: md.n,
  ar: md.name,
  en: chapters[i].name_simple,
  tr: md.tname,
  meaning: md.ename,
  ayahs: md.ayas,
  type: md.type === 'Meccan' ? 'meccan' : 'medinan',
  order: md.order,
  start: md.start,
}));

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'surahs.json'),
  JSON.stringify(
    {
      source: {
        metadata: 'Tanzil Project — Quran metadata (tanzil.net/res/text/metadata/quran-data.xml), CC BY 3.0',
        transliteration: 'Quran.com API v4 — chapters (name_simple), cross-checked against Tanzil',
        generated: new Date().toISOString().slice(0, 10),
      },
      surahs,
    },
    null,
    0,
  ) + '\n',
);

writeFileSync(
  join(outDir, 'quran-uthmani.json'),
  JSON.stringify({
    copyright,
    source: 'Tanzil Project — https://tanzil.net',
    edition: `Tanzil Quran Text (${textVersion}) — Uthmani script, Hafs`,
    sha256,
    suras: suras.map((s) => ({ n: s.n, bismillah: s.bismillah, ayahs: s.ayahs })),
  }) + '\n',
);

writeFileSync(
  join(outDir, 'QURAN-TEXT-LICENSE.txt'),
  `The Quran text bundled with Qari Studio (src/data/quran-uthmani.json) is a verbatim copy of:\n\n${copyright}\n\nSource: https://tanzil.net — the text is reproduced without modification (restructured from XML to JSON only).\nSHA-256 of the newline-joined text (bismillah + ayahs per surah): ${sha256}\n`,
);

for (const r of report) console.log(r);
console.log(`✓ 114 surahs, ${total} ayahs verified against Tanzil metadata and Quran.com`);
console.log(`✓ Text edition: Tanzil ${textVersion}; sha256 ${sha256}`);
