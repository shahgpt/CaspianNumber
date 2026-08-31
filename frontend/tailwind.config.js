import animate from 'tailwindcss-animate'

/** رنگ توکنی: مقدار از CSS variable خوانده می‌شود تا با کلاس .dark وارونه شود. */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'sans-serif'],
      },
      colors: {
        /* --- اکسنت و عمق: توکنی، چون تمِ تاریک تک‌رنگ است ---
           در تم روشن این‌ها همان سبزآبیِ کاسپین‌اند؛ در تم تاریک به
           نردبانِ خاکستری/سفید تبدیل می‌شوند تا هیچ آبی‌ای نماند. */
        deep: {
          50: v('--deep-50'),
          100: v('--deep-100'),
          200: v('--deep-200'),
          300: v('--deep-300'),
          400: v('--deep-400'),
          500: v('--deep-500'),
          600: v('--deep-600'),
          700: v('--deep-700'),
          800: v('--deep-800'),
          900: v('--deep-900'),
          950: v('--deep-950'),
        },
        sea: {
          300: v('--sea-300'),
          400: v('--sea-400'),
          500: v('--sea-500'),
          600: v('--sea-600'),
          700: v('--sea-700'),
        },

        /* --- توکنی: با تم وارونه می‌شوند --- */
        // کاغذ: سطح کارت/پنل (روشن: سفید — تاریک: سطح برجسته‌ی عمیق)
        paper: v('--paper'),
        // شن: سطوح گرمِ پس‌زمینه و خطوط مویی
        sand: {
          50: v('--sand-50'),
          100: v('--sand-100'),
          200: v('--sand-200'),
          300: v('--sand-300'),
        },
        // جزرومد: متن/آیکونِ اکسنت روی سطوح روشن — با تم وارونه می‌شود
        tide: v('--tide'),
        // تینتِ اکسنت: زمینه‌ی چیپ‌ها، بنرها و هاور ردیف‌ها
        tint: v('--tint'),
        // مرکب: نردبان متن
        ink: {
          DEFAULT: v('--ink-900'),
          300: v('--ink-300'),
          400: v('--ink-400'),
          500: v('--ink-500'),
          600: v('--ink-600'),
          700: v('--ink-700'),
          900: v('--ink-900'),
        },

        /* --- نام‌های سمانتیکِ shadcn ---
           کامپوننت‌های وندورشده‌ی shadcn با این نام‌ها نوشته شده‌اند. به‌جای
           آوردنِ پالتِ خاکستریِ خودشان، روی همین توکن‌های دنیا نگاشت
           می‌شوند — پس دراپ‌داون هم‌رنگِ صفحه درمی‌آید و تم تاریک بدونِ
           هیچ کلاسِ اضافه کار می‌کند. */
        background: v('--canvas'),
        foreground: v('--ink-900'),
        popover: {
          DEFAULT: v('--paper'),
          foreground: v('--ink-900'),
        },
        muted: {
          DEFAULT: v('--sand-100'),
          foreground: v('--ink-500'),
        },
        accent: {
          DEFAULT: v('--tint'),
          foreground: v('--tide'),
        },
        border: v('--sand-200'),
        input: v('--sand-200'),
        ring: v('--accent'),
        destructive: {
          DEFAULT: v('--destructive'),
          foreground: v('--paper'),
        },
      },
      // نردبان شفافیت پیش‌فرض تِیل‌ویند پله‌های ۵تایی ندارد؛ پله‌های میانی را
      // اضافه می‌کنیم تا کلاس‌هایی مثل `/12` بی‌صدا از قلم نیفتند.
      opacity: {
        8: '0.08',
        12: '0.12',
        15: '0.15',
        35: '0.35',
        45: '0.45',
        55: '0.55',
        65: '0.65',
        85: '0.85',
      },
      // حلقه‌ی فوکوس پیش‌فرض تِیل‌ویند آبی است و به این دنیا تعلق ندارد
      ringColor: {
        DEFAULT: v('--accent'),
      },
      boxShadow: {
        lift: 'var(--shadow-lift)',
        panel: 'var(--shadow-panel)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [animate],
}
