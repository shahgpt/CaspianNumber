export interface Employee {
  id: number
  organization_id: number
  first_name: string
  last_name: string
  latin_name: string
  /** شماره‌ی مستقیمِ ثبت‌شده — اگر خالی باشد سرور از داخلی می‌سازد */
  direct_number: string
  /** شماره‌ی مستقیمِ آماده‌ی تماس (همیشه پر، اگر داخلی وجود داشته باشد) */
  direct: string
  extension: string
  phone: string
  email: string
  department: string
  company: string
  job_title: string
  location: string
  photo_url: string
  keywords: string
  skills: string
  languages: string
  working_hours: string
  notes: string
  full_name: string
}

const TOKEN_KEY = 'cn_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * روی صفحه‌ی ورود، ۴۰۱ یعنی «نام کاربری یا رمز اشتباه است» — نه «نشست منقضی شد».
 * پس آنجا با `redirectOn401: false` صدا زده می‌شود تا پیام خودِ سرور نمایش داده شود.
 */
export async function api<T = unknown>(
  path: string,
  options: RequestInit & { redirectOn401?: boolean } = {},
): Promise<T> {
  const { redirectOn401 = true, ...init } = options
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (!(init.body instanceof FormData) && init.body) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(path, { ...init, headers })
  if (res.status === 401 && redirectOn401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('unauthorized')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { detail?: string }).detail || 'خطای غیرمنتظره')
  }
  return data as T
}

/** Convert Persian/Arabic digits to Latin for tel: links */
export function toEnDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) =>
    String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d)),
  )
}
