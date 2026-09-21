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
    throw new Error(errorMessage(data, res.status))
  }
  return data as T
}

type ValidationIssue = { loc?: unknown[]; msg?: string }

/**
 * پیامِ خطای سرور، به فارسی و خوانا.
 *
 * ۴۲۲ از FastAPI `detail` را یک آرایه می‌فرستد، نه یک رشته. چسباندنِ مستقیمِ
 * آن به `new Error` رویِ صفحه «[object Object]» می‌شد — یعنی کاربر می‌دید
 * کاری انجام نشده ولی نمی‌فهمید چرا. نامِ فیلدِ ایرادزا از `loc` بیرون
 * می‌آید، چون همان تنها چیزی است که به دردِ کسی می‌خورد که فرم را پر کرده.
 */
export function errorMessage(data: unknown, status = 0): string {
  const detail = (data as { detail?: unknown })?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const parts = (detail as ValidationIssue[])
      .map((issue) => {
        const field = Array.isArray(issue.loc)
          ? issue.loc.filter((p) => p !== 'body').join('.')
          : ''
        // «Value error, ایمیل معتبر نیست» — نیمه‌ی اولش نامِ درونیِ نوعِ
        // خطا در Pydantic است و برای کسی که فرم را پر کرده معنا ندارد.
        const msg = String(issue.msg ?? '').replace(/^(Value|Assertion) error,\s*/i, '').trim()
        return field && msg ? `${field}: ${msg}` : msg || field
      })
      .filter(Boolean)
    if (parts.length) return parts.slice(0, 3).join(' · ')
  }
  if (status === 403) return 'اجازهٔ این کار را ندارید'
  if (status === 404) return 'یافت نشد'
  return 'خطای غیرمنتظره'
}

/** Convert Persian/Arabic digits to Latin for tel: links */
export function toEnDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) =>
    String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d)),
  )
}
