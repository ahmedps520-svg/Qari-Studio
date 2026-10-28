#!/usr/bin/env node
/** Renders the app icons (PWA manifest + Apple touch icon) from the logo SVG with Chromium. */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const mark = (inner) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="100%" height="100%">
  <defs>
    <linearGradient id="g" x1="24" y1="6" x2="24" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F0D79A"/><stop offset="1" stop-color="#B78D3F"/></linearGradient>
    <radialGradient id="glow" cx="24" cy="12" r="34" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1F6B51"/><stop offset="1" stop-color="#061710"/></radialGradient>
  </defs>
  ${inner}
  <path d="M12.5 39.5V23.2c0-6.4 4.7-10.6 11.5-15.2 6.8 4.6 11.5 8.8 11.5 15.2v16.3" fill="none" stroke="url(#g)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <g stroke="#F4EEDF" stroke-width="2.4" stroke-linecap="round"><path d="M18 29.5v3M21 25.5v11M24 21.5v19M27 25.5v11M30 29.5v3"/></g>
</svg>`;

const variants = [
  // Standard icon: rounded square on transparent.
  { file: 'icons/icon-192.png', size: 192, svg: mark('<rect x="1" y="1" width="46" height="46" rx="12" fill="url(#glow)"/>'), pad: 0 },
  { file: 'icons/icon-512.png', size: 512, svg: mark('<rect x="1" y="1" width="46" height="46" rx="12" fill="url(#glow)"/>'), pad: 0 },
  // Maskable: full-bleed background, artwork inside the 80% safe zone.
  { file: 'icons/icon-maskable-512.png', size: 512, svg: mark(''), pad: 0.08, bg: 'radial-gradient(circle at 50% 22%, #1F6B51, #061710 72%)' },
  { file: 'apple-touch-icon.png', size: 180, svg: mark(''), pad: 0.02, bg: 'radial-gradient(circle at 50% 22%, #1F6B51, #061710 72%)' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const v of variants) {
  await page.setViewportSize({ width: v.size, height: v.size });
  const inset = Math.round(v.size * v.pad);
  await page.setContent(
    `<html><body style="margin:0;background:${v.bg ?? 'transparent'};width:${v.size}px;height:${v.size}px">
      <div style="position:absolute;inset:${inset}px">${v.svg}</div></body></html>`,
  );
  await page.screenshot({ path: join(root, 'public', v.file), omitBackground: !v.bg });
  console.log('wrote', v.file);
}
await browser.close();
