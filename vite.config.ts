import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app under /money-app/, so all asset URLs are relative.
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // App shell + self-hosted fonts. Nothing else is precached.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        // Never cache the Apps Script backend (also covers its redirect target).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/script\.google\.com\//,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/script\.googleusercontent\.com\//,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'YOU SPENT',
        short_name: 'YOU SPENT',
        display: 'standalone',
        start_url: './',
        scope: './',
        background_color: '#14110f',
        theme_color: '#14110f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
