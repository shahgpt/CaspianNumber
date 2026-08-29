/**
 * تم روشن/تاریک — منبع حقیقت: کلاس `dark` روی <html>.
 * پیش‌فرضِ محصول تاریک است (کاغذِ مرکبی)؛ انتخابِ صریحِ کاربر در
 * localStorage می‌ماند. ترجیحِ سیستم دنبال نمی‌شود — این یک انتخابِ
 * طراحی است، نه یک تنظیمِ فراموش‌شده.
 */

export type Theme = 'light' | 'dark'

const KEY = 'cn_theme'
const listeners = new Set<(t: Theme) => void>()

/** پیش‌فرضِ محصول: تاریک. انتخابِ صریحِ روشن همچنان حفظ می‌شود. */
const DEFAULT_THEME: Theme = 'dark'

/** انتخاب صریح کاربر (اگر وجود داشته باشد) */
export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function getTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** تمِ آغازین: انتخابِ کاربر، وگرنه پیش‌فرضِ تاریک */
export function initTheme() {
  applyTheme(storedTheme() ?? DEFAULT_THEME, false)
}

/** اعمال تم روی سند + هم‌گام‌سازی نوار وضعیت موبایل */
export function applyTheme(theme: Theme, persist = true) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#080808' : '#FFFFFF')

  if (persist) {
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* حالت خصوصی مرورگر — تم فقط برای همین نشست می‌ماند */
    }
  }
  listeners.forEach((fn) => fn(theme))
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

/** اشتراک در تغییر تم — برای هم‌گام ماندن چند دکمه در یک صفحه */
export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
