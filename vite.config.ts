import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: process.env.QARI_BASE ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1800,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'worklets/*.js'],
      manifest: {
        name: 'Qari Studio',
        short_name: 'Qari Studio',
        description: 'A Quran recitation studio: live headphone monitoring, natural vocal enhancement and a private recordings library.',
        theme_color: '#06110D',
        background_color: '#06110D',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        lang: 'en',
        dir: 'auto',
        categories: ['music', 'education', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the scripts we actually use: Latin, Latin-ext and Arabic font subsets.
        globPatterns: ['**/*.{js,css,html,svg,png,json}', '**/*{latin,latin-ext,arabic}*.woff2'],
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
