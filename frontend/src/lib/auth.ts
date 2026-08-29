import { useEffect, useState } from 'react'
import { api, clearToken, getToken } from './api'

/* نشستِ کاربر — یک منبعِ حقیقت برای «این نفر کیست و چه اجازه‌ای دارد».
   قاعده‌ی این فایل: localStorage فقط برای «سریع نشان دادن» است، هرگز
   برای «اجازه دادن». تصمیمِ دسترسی همیشه با پاسخِ سرور گرفته می‌شود،
   چون localStorage را خودِ کاربر با یک خط در کنسول عوض می‌کند. */

/* هر کارمند حسابِ خودش را دارد؛ دفترچه بدون ورود باز نمی‌شود.
   `is_admin` تنها تفاوت است: پنلِ مدیریت. */
export interface Session {
  id: number
  username: string
  is_active: boolean
  is_admin: boolean
}

const USER_KEY = 'cn_username'

export function rememberSession(username: string) {
  localStorage.setItem(USER_KEY, username)
}

export function forgetSession() {
  clearToken()
  localStorage.removeItem(USER_KEY)
}

/**
 * نشست را از سرور می‌پرسد. بدون توکن اصلاً درخواستی نمی‌رود (دفترچه
 * برای همه باز است و نباید بابت مهمان‌ها رفت‌وبرگشت بی‌خود بدهیم).
 * توکنِ منقضی یا دستکاری‌شده ⇒ null و پاک‌سازیِ نشستِ کهنه.
 */
export async function fetchSession(): Promise<Session | null> {
  if (!getToken()) return null
  try {
    const me = await api<Session>('/api/auth/me', { redirectOn401: false })
    rememberSession(me.username)
    return me
  } catch {
    forgetSession()
    return null
  }
}

export interface SessionState {
  session: Session | null
  /** تا وقتی true است هنوز نمی‌دانیم؛ برای گارد باید صبر کرد */
  loading: boolean
  isAdmin: boolean
}

/**
 * نشست را از سرور می‌گیرد و تا آمدنِ پاسخ `loading` می‌ماند.
 *
 * برخلافِ نسخه‌ی قبل اینجا حدسِ خوش‌بینانه نمی‌زنیم: «ادمین بودن» دیگر
 * از داشتنِ توکن پیدا نیست و اگر خوش‌بین باشیم، کاربرِ عادی یک لحظه
 * دکمه‌ی پنلِ مدیریت را می‌بیند و بعد ناپدید می‌شود.
 */
export function useSession(): SessionState {
  const hasToken = Boolean(getToken())
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(hasToken)

  useEffect(() => {
    if (!hasToken) return
    let alive = true
    fetchSession().then((s) => {
      if (!alive) return
      setSession(s)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [hasToken])

  // بدون توکن نه نشستی هست نه انتظاری — همان‌جا پاسخ می‌دهیم
  if (!hasToken) return { session: null, loading: false, isAdmin: false }

  return { session, loading, isAdmin: Boolean(session?.is_admin) }
}
