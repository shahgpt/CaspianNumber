import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32.png', 'favicon-16.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'کاسپین نامبر — دفترچه تلفن سازمانی',
        short_name: 'کاسپین',
        description: 'دفترچه تلفن هوشمند کارکنان',
        lang: 'fa',
        dir: 'rtl',
        theme_color: '#080808',
        background_color: '#080808',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          // اندروید آیکون را داخل ماسک می‌برد؛ بدون این نسخه، لبه‌های
          // نشان بریده می‌شوند.
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // فقط پوسته کش می‌شود. پاسخ‌های /api دیگر کش نمی‌شوند: دفترچه
        // حالا پشتِ ورود است و فهرستِ کش‌شده بعد از خروج روی یک دستگاهِ
        // مشترک، همان چیزی است که گارد قرار بود جلویش را بگیرد.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // ویت هر Host ناشناسی را رد می‌کند. برای تستِ گفتار روی سافاری/موبایل
    // که HTTPS واقعی لازم دارد، دامنه‌های تونل را از پیش مجاز می‌کنیم.
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com'],
    proxy: {
      '/api': 'http://127.0.0.1:8899',
    },
  },
})
