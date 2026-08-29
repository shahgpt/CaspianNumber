import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Link } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { api, toEnDigits } from '../lib/api'
import { forgetSession } from '../lib/auth'
import BrandLockup from '../components/BrandLockup'
import ThemeToggle from '../components/ThemeToggle'
import type { Employee } from '../lib/api'
import { createRevealer, faDigits, prefersReducedMotion, shouldAnimate } from '../lib/motion'
import type { Revealer } from '../lib/motion'
import { CONTOURS } from './login-contours'
import {
  BookIcon,
  UploadIcon,
  UserPlusIcon,
  CloseIcon,
  CheckIcon,
  PersonIcon,
  SearchIcon,
  SparkIcon,
} from '../components/icons'

const EMPTY: Partial<Employee> = {
  first_name: '', last_name: '', latin_name: '', direct_number: '', extension: '',
  phone: '', email: '', department: '', company: '', job_title: '',
  location: '', keywords: '', skills: '', languages: '', working_hours: '', notes: '',
}

type Field = {
  key: keyof Employee
  label: string
  ltr?: boolean
  hint?: string
  wide?: boolean
  rows?: number
}

/* آنچه ادمین از پرونده می‌داند — شناسه، شماره، جای کار. */
const FIELDS: Field[] = [
  { key: 'first_name', label: 'نام' },
  { key: 'last_name', label: 'نام خانوادگی' },
  { key: 'latin_name', label: 'نام لاتین', ltr: true },
  { key: 'extension', label: 'داخلی', ltr: true },
  {
    key: 'direct_number',
    label: 'شماره مستقیم',
    ltr: true,
    hint: 'خالی بگذارید تا از روی داخلی ساخته شود',
  },
  { key: 'phone', label: 'تلفن ثابت', ltr: true },
  { key: 'email', label: 'ایمیل', ltr: true },
  { key: 'department', label: 'واحد / دپارتمان' },
  { key: 'company', label: 'شرکت' },
  { key: 'job_title', label: 'سمت' },
  { key: 'location', label: 'محل خدمت' },
  { key: 'working_hours', label: 'ساعت کاری' },
]

/* آنچه دفترچه را جستجوپذیر می‌کند — و مدل می‌تواند از روی بالایی‌ها بنویسدش. */
const AI_FIELDS: Field[] = [
  { key: 'keywords', label: 'کلیدواژه‌ها و نام‌های مستعار (با ؛ جدا کنید)', wide: true },
  { key: 'skills', label: 'مهارت‌ها / حوزه کاری' },
  { key: 'languages', label: 'زبان‌ها' },
  { key: 'notes', label: 'یادداشت', wide: true, rows: 2 },
]

/* مدل بی‌مصالح چیزی نمی‌سازد: دست‌کم یکی از این‌ها باید پر باشد. */
const AI_SEEDS: (keyof Employee)[] = ['first_name', 'last_name', 'job_title', 'department']

const TABS = [
  ['people', 'پرسنل'],
  ['users', 'کاربران'],
  ['logs', 'تغییرات'],
] as const

/* --- دفترِ تغییرات ---------------------------------------------------
   لاگ خام فنی و انگلیسی است («toggle_admin روی user»). اینجا به جمله‌ی
   فارسی ترجمه می‌شود، با نامِ کسی که کار رویش انجام شده و ریزِ آنچه عوض
   شده — وگرنه دفتری که فقط فعل را نشان می‌دهد، چیزی را روشن نمی‌کند. */

type LogEntry = {
  id: number
  action: string
  entity: string
  entity_id: number | null
  actor_name: string
  details: unknown
  at: string | null
}

type Tone = 'add' | 'edit' | 'remove'

const LOG_VERBS: Record<string, { verb: string; tone: Tone }> = {
  create: { verb: 'ساخت', tone: 'add' },
  update: { verb: 'ویرایش کرد', tone: 'edit' },
  delete: { verb: 'حذف کرد', tone: 'remove' },
  import: { verb: 'ایمپورت کرد', tone: 'add' },
  toggle_admin: { verb: 'نقشِ حساب را عوض کرد', tone: 'edit' },
  toggle_active: { verb: 'وضعیتِ حساب را عوض کرد', tone: 'edit' },
  set_credentials: { verb: 'یوزر/رمز را عوض کرد', tone: 'edit' },
  reset_password: { verb: 'رمز موقت ساخت', tone: 'edit' },
}

const TONE_DOT: Record<Tone, string> = {
  add: 'bg-sea-500',
  edit: 'bg-ink-300',
  remove: 'bg-red-500',
}

const LOG_FILTERS = [
  ['all', 'همه'],
  ['employee', 'پرسنل'],
  ['user', 'حساب‌ها'],
  ['import', 'ایمپورت'],
] as const

/* برچسبِ فارسیِ فیلدها را از همان فرمِ ویرایش قرض می‌گیریم؛ راهنمای داخل
   پرانتز به دردِ یک سطرِ لاگ نمی‌خورد. */
const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  [...FIELDS, ...AI_FIELDS].map((f) => [f.key, f.label.replace(/\s*\(.*?\)/, '')]),
)

const CRED_LABELS: Record<string, string> = { username: 'نام کاربری', password: 'رمز' }

/** مقدارِ خالی در لاگ باید دیده شود، نه اینکه جایش سفید بماند */
function logValue(v: unknown): string {
  const s = String(v ?? '').trim()
  return s ? faDigits(s) : '—'
}

/** جمله‌ی فارسی + سطرهای ریزِ تغییر */
function describeLog(l: LogEntry, subject: string) {
  const d = (l.details ?? {}) as Record<string, unknown>
  const { verb, tone } = LOG_VERBS[l.action] ?? { verb: l.action, tone: 'edit' as Tone }
  const lines: string[] = []

  if (l.action === 'update') {
    for (const [key, ch] of Object.entries(d)) {
      if (ch && typeof ch === 'object' && 'to' in (ch as object)) {
        const { from, to } = ch as { from: unknown; to: unknown }
        lines.push(`${FIELD_LABELS[key] ?? key}: ${logValue(from)} ← ${logValue(to)}`)
      }
    }
  } else if (l.action === 'toggle_admin') {
    lines.push(d.is_admin ? 'دسترسیِ مدیریت داده شد' : 'دسترسیِ مدیریت گرفته شد')
  } else if (l.action === 'toggle_active') {
    lines.push(d.active ? 'حساب فعال شد' : 'حساب غیرفعال شد')
  } else if (l.action === 'set_credentials') {
    const fields = Array.isArray(d.fields) ? (d.fields as string[]) : []
    if (fields.length) lines.push(fields.map((f) => CRED_LABELS[f] ?? f).join(' و ') + ' عوض شد')
  } else if (l.action === 'import') {
    lines.push(
      `${faDigits(Number(d.created ?? 0))} تازه · ${faDigits(Number(d.updated ?? 0))} به‌روز · ${faDigits(Number(d.skipped ?? 0))} ردشده`,
    )
    const errors = Array.isArray(d.errors) ? d.errors.length : 0
    if (errors) lines.push(`${faDigits(errors)} سطر خطا داشت`)
  }

  return { verb, tone, subject, lines }
}

/** «۵ دقیقه پیش» برای امروز، ساعت برای روزهای قبل — تاریخ روی سرگروه است */
function logTime(iso: string): string {
  const d = new Date(iso)
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (secs < 60) return 'همین حالا'
  if (secs < 3600) return `${faDigits(Math.floor(secs / 60))} دقیقه پیش`
  if (secs < 86400) return `${faDigits(Math.floor(secs / 3600))} ساعت پیش`
  return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
}

/** سرگروهِ روز: امروز / دیروز / تاریخِ کامل */
function logDay(iso: string): string {
  const d = new Date(iso)
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((midnight(new Date()) - midnight(d)) / 86_400_000)
  if (days <= 0) return 'امروز'
  if (days === 1) return 'دیروز'
  return d.toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' })
}

gsap.registerPlugin(ScrollTrigger)

/* قرارداد Impeccable — پنل مدیریت در همان دنیای «نقشه‌ی عمق‌سنجی».
   کاغذ سفید، خط تراز به‌عنوان امضا، و ورودِ پلکانیِ ردیف‌های جدول
   هنگام اسکرول — همان زبانِ دفترچه، این بار روی داده‌ی خام. */

/* حساب یعنی «حقِ دیدنِ دفترچه». `is_admin` تنها نقشِ اضافه است: همین پنل.
   حساب به رکوردِ پرسنل گره نمی‌خورد. */
type AdminUser = {
  id: number
  username: string
  is_active: boolean
  is_admin: boolean
}

/* رمزِ موقتی که تازه ساخته شده — یک‌بار نشان داده می‌شود و بعد از بسته‌شدنِ
   این کارت دیگر از هیچ‌جا خوانده نمی‌شود. */
type IssuedCredential = {
  username: string
  temp_password: string
}

export default function Admin() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'people' | 'users' | 'logs'>('people')
  const [editing, setEditing] = useState<Partial<Employee> | null>(null)
  /* تکمیلِ ماشینی: خطا باید داخلِ همین شیت دیده شود — نوارِ پیامِ صفحه
     زیرِ پرده‌ی مودال می‌ماند و کسی نمی‌بیندش. */
  const [suggesting, setSuggesting] = useState(false)
  const [aiError, setAiError] = useState('')
  const [notice, setNotice] = useState('')
  const [importing, setImporting] = useState(false)

  /* حساب‌ها: رمز هیچ‌جا نگه داشته نمی‌شود. اگر کسی رمزش را گم کرد، ادمین
     «رمز موقت» می‌سازد و همان یک‌بار می‌بیندش. */
  const [issued, setIssued] = useState<IssuedCredential | null>(null)
  const [credEditing, setCredEditing] = useState<AdminUser | null>(null)
  const [credForm, setCredForm] = useState({ username: '', password: '' })
  const [newUser, setNewUser] = useState({ username: '', is_admin: false })
  const [logFilter, setLogFilter] = useState<(typeof LOG_FILTERS)[number][0]>('all')
  const [logQuery, setLogQuery] = useState('')

  /* پیش‌شماره از سرور می‌آید تا در دو جا دوباره نوشته نشود */
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ direct_prefix: string }>('/api/health'),
    staleTime: Infinity,
  })
  const directPrefix = health?.direct_prefix ?? ''

  /** پیش‌نمایشِ شماره‌ی مستقیم برای وقتی که ادمین فیلد را خالی می‌گذارد */
  function directPreview(extension?: string): string {
    const ext = toEnDigits(extension || '').replace(/\D/g, '')
    return ext ? `${directPrefix}${ext}` : ''
  }

  const { data: people } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => api<Employee[]>('/api/admin/employees'),
  })
  const { data: users } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<AdminUser[]>('/api/admin/users'),
    // در تبِ تغییرات هم لازم است: لاگِ toggle نامِ حساب را همراه ندارد
    enabled: tab === 'users' || tab === 'logs',
  })
  const { data: logs } = useQuery({
    queryKey: ['admin-logs'],
    queryFn: () => api<LogEntry[]>('/api/admin/logs?limit=100'),
    enabled: tab === 'logs',
  })

  // --- refs موشن ---
  const headRef = useRef<HTMLElement>(null)
  const ruleRef = useRef<HTMLSpanElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const underlineRef = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  const switched = useRef(false)
  const revealerRef = useRef<Revealer | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLFormElement>(null)

  // زیرخطِ متحرک تب‌ها — با هر تغییر تب سر جایش می‌لغزد،
  // و با تغییر اندازه‌ی پنجره دوباره اندازه‌گیری می‌شود
  useEffect(() => {
    const nav = navRef.current
    const line = underlineRef.current
    if (!nav || !line) return

    function place(animate: boolean) {
      const active = nav?.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)
      if (!active || !line) return
      const to = { x: active.offsetLeft, width: active.offsetWidth, opacity: 1 }
      // بارِ اول، تغییرِ اندازه، و حالتِ کاهشِ حرکت: بدون لغزش، سرِ جای درست
      if (!animate || !placed.current || prefersReducedMotion()) {
        placed.current = true
        gsap.set(line, to)
        return
      }
      gsap.to(line, { ...to, duration: 0.45, ease: 'expo.out', overwrite: 'auto' })
    }

    place(true)
    const ro = new ResizeObserver(() => place(false))
    ro.observe(nav)
    // فونت که دیر می‌رسد، عرض تب‌ها را عوض می‌کند
    document.fonts?.ready.then(() => place(false)).catch(() => {})
    return () => ro.disconnect()
  }, [tab])

  /* --- یک توالیِ واحد، از بالا به پایین: سربرگ، خط تراز، تب‌ها، محتوا.
         ردیف‌های جدول در ادامه‌ی همین توالی می‌آیند (پایین‌تر). --- */
  useEffect(() => {
    const head = headRef.current
    if (!head || !shouldAnimate()) return
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from(head, { opacity: 0, y: -14, duration: 0.55 }, 0)
        .from(ruleRef.current, { scaleX: 0, duration: 0.9 }, 0.1)
        .from(
          navRef.current?.querySelectorAll('[data-tab]') ?? [],
          { opacity: 0, y: 8, duration: 0.45, stagger: 0.06 },
          0.2,
        )
        .from(
          contentRef.current,
          {
            opacity: 0,
            y: 16,
            clipPath: 'inset(0% 0% 100% 0%)',
            duration: 0.7,
            clearProps: 'clipPath',
          },
          0.32,
        )
    }, head)
    return () => ctx.revert()
  }, [])

  /* --- تعویض تب: محتوا یک‌تکه و کوتاه عوض می‌شود.
         هر بلوک جداگانه پرده نمی‌زند — آن حرکتِ پلکانی روی یک جدول،
         شلوغ بود و کندی را نشان می‌داد، نه ساختار را. --- */
  useEffect(() => {
    const content = contentRef.current
    const wasSwitched = switched.current
    switched.current = true
    // StrictMode افکت را دوبار اجرا می‌کند؛ پرچم باید سرِ جایش برگردد،
    // وگرنه محتوا هم‌زمان با توالیِ ورود یک‌بار دیگر پرده می‌زند.
    if (!content || !wasSwitched || prefersReducedMotion()) {
      return () => {
        switched.current = wasSwitched
      }
    }
    const tween = gsap.fromTo(
      content,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.32, ease: 'expo.out', clearProps: 'transform,opacity' },
    )
    return () => {
      tween.kill()
      gsap.set(content, { clearProps: 'transform,opacity' })
      switched.current = wasSwitched
    }
  }, [tab])

  // ردیف‌های جدول در ادامه‌ی همان توالی — یک ناظرِ ماندگار، مثل دفترچه
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const revealer = createRevealer(content, '[data-row]', {
      y: 10,
      duration: 0.5,
      each: 0.03,
      maxStagger: 0.3,
      firstBatchDelay: 0.7,
    })
    revealerRef.current = revealer
    revealer.scan()
    return () => {
      revealer.destroy()
      revealerRef.current = null
    }
  }, [])

  // داده یا تبِ تازه: فقط ردیف‌های جدید به همان ناظر سپرده می‌شوند
  useEffect(() => {
    revealerRef.current?.scan()
    const id = requestAnimationFrame(() => ScrollTrigger.refresh())
    return () => cancelAnimationFrame(id)
  }, [tab, people, users, logs])

  // بنر اعلان
  useEffect(() => {
    if (!notice || !noticeRef.current || prefersReducedMotion()) return
    gsap.from(noticeRef.current, { opacity: 0, y: -10, duration: 0.35, ease: 'expo.out' })
  }, [notice])

  /* انیمیشن مودال هنگام باز شدن + بستن با Escape.
     وابسته به «باز بودن» است، نه به شیٔ editing — وگرنه هر تایپ یک
     gsap.from تازه می‌ساخت و مودال پله‌پله محو می‌شد. */
  const modalOpen = editing !== null
  useEffect(() => {
    if (!modalOpen) return
    if (!prefersReducedMotion() && overlayRef.current && sheetRef.current) {
      gsap.from(overlayRef.current, { opacity: 0, duration: 0.32 })
      gsap.from(sheetRef.current, {
        y: 40,
        scale: 0.96,
        opacity: 0,
        filter: 'blur(6px)',
        duration: 0.6,
        ease: 'expo.out',
        clearProps: 'filter',
      })
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setEditing(null)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [modalOpen])

  function flashNotice(msg: string, ms = 2600) {
    setNotice(msg)
    setTimeout(() => setNotice(''), ms)
  }

  async function saveEmployee(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    try {
      if (editing.id) {
        await api(`/api/admin/employees/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editing),
        })
      } else {
        await api('/api/admin/employees', {
          method: 'POST',
          body: JSON.stringify(editing),
        })
      }
      setEditing(null)
      flashNotice('ذخیره شد')
      qc.invalidateQueries({ queryKey: ['admin-employees'] })
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'خطا در ذخیره', 4000)
    }
  }

  /* یک ورودی، دو دسته — تا نشانه‌گذاریِ فیلد در دو جا تکرار نشود. */
  function renderField({ key, label, ltr, hint, wide, rows }: Field) {
    const shared = `w-full rounded-xl border border-sand-300 bg-sand-50/60 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-sea-500 focus:ring-2 focus:ring-sea-500/20 focus:bg-paper transition-colors ${
      ltr ? 'text-left' : ''
    }`
    const value = (editing?.[key] as string) || ''
    const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setEditing((cur) => (cur ? { ...cur, [key]: e.target.value } : cur))

    return (
      <div key={String(key)} className={wide ? 'sm:col-span-2' : ''}>
        <label className="block text-xs font-medium text-ink-500 mb-1" htmlFor={`f-${String(key)}`}>
          {label}
        </label>
        {rows ? (
          <textarea
            id={`f-${String(key)}`}
            rows={rows}
            value={value}
            onChange={onChange}
            className={`${shared} resize-y leading-6`}
          />
        ) : (
          <input
            id={`f-${String(key)}`}
            value={value}
            dir={ltr ? 'ltr' : undefined}
            placeholder={key === 'direct_number' ? directPreview(editing?.extension) : undefined}
            onChange={onChange}
            className={shared}
          />
        )}
        {hint && <p className="mt-1 text-[11px] text-ink-400">{hint}</p>}
      </div>
    )
  }

  const canSuggest = AI_SEEDS.some((k) => ((editing?.[k] as string) || '').trim())

  /** باز کردنِ فرم — خطای تکمیلِ دفعه‌ی قبل با آن پاک می‌شود. */
  function openEditor(emp: Partial<Employee>) {
    setAiError('')
    setEditing(emp)
  }

  /* از روی فیلدهای بالا، چهار فیلدِ پایین را می‌نویسد. چیزی ذخیره نمی‌شود؛
     پیشنهاد در فرم می‌نشیند تا ادمین قبل از «ذخیره» درستش کند. */
  async function suggestFields() {
    if (!editing) return
    setSuggesting(true)
    setAiError('')
    try {
      const out = await api<Pick<Employee, 'keywords' | 'skills' | 'languages' | 'notes'>>(
        '/api/admin/employees/suggest',
        { method: 'POST', body: JSON.stringify(editing) },
      )
      setEditing((cur) => (cur ? { ...cur, ...out } : cur))
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'تکمیل نشد؛ دوباره تلاش کنید')
    } finally {
      setSuggesting(false)
    }
  }

  async function removeEmployee(id: number, name: string) {
    if (!confirm(`«${name}» حذف شود؟`)) return
    await api(`/api/admin/employees/${id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['admin-employees'] })
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api<{
        created: number
        updated: number
        errors: string[]
      }>('/api/admin/import', { method: 'POST', body: fd })

      let msg = `ایمپورت انجام شد: ${faDigits(res.created)} نفر جدید، ${faDigits(res.updated)} نفر به‌روزرسانی`
      if (res.errors.length) msg += `\nخطاها:\n${res.errors.slice(0, 5).join('\n')}`
      flashNotice(msg, 6000)

      qc.invalidateQueries({ queryKey: ['admin-employees'] })
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'خطا در ایمپورت', 4000)
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  async function resetPassword(u: AdminUser) {
    if (!confirm(`برای «${u.username}» رمز موقت ساخته شود؟ رمز فعلی از کار می‌افتد.`)) return
    try {
      const res = await api<IssuedCredential>(`/api/admin/users/${u.id}/reset-password`, {
        method: 'POST',
      })
      setIssued(res)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'خطا در ساخت رمز موقت', 4000)
    }
  }

  async function toggleActive(userId: number) {
    try {
      await api(`/api/admin/users/${userId}/toggle-active`, { method: 'POST' })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'خطا در تغییر وضعیت', 4000)
    }
  }

  async function toggleAdmin(u: AdminUser) {
    const ask = u.is_admin
      ? `دسترسی مدیریت از «${u.username}» گرفته شود؟`
      : `«${u.username}» به پنل مدیریت دسترسی کامل پیدا کند؟`
    if (!confirm(ask)) return
    try {
      await api(`/api/admin/users/${u.id}/toggle-admin`, { method: 'POST' })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'خطا در تغییر نقش', 4000)
    }
  }

  function openCredentials(u: AdminUser) {
    setCredEditing(u)
    // رمز خالی باز می‌شود: چیزی برای پیش‌نویسی نیست، سیستم رمز را نمی‌داند.
    setCredForm({ username: u.username, password: '' })
  }

  async function saveCredentials(e: React.FormEvent) {
    e.preventDefault()
    if (!credEditing) return
    try {
      await api(`/api/admin/users/${credEditing.id}/credentials`, {
        method: 'PATCH',
        body: JSON.stringify(credForm),
      })
      setCredEditing(null)
      flashNotice(credForm.password ? 'نام کاربری و رمز ذخیره شد' : 'نام کاربری ذخیره شد')
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'خطا در ذخیره', 4000)
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    try {
      const res = await api<{ username: string; temp_password: string }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      })
      setNewUser({ username: '', is_admin: false })
      setIssued({ username: res.username, temp_password: res.temp_password })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'خطا در ساخت کاربر', 4000)
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      flashNotice(`${label} کپی شد`, 1600)
    } catch {
      flashNotice('کپی نشد — دستی بردارید', 2600)
    }
  }

  /* دفترِ تغییرات: نام‌ها را از همان دو جدولِ بالا حل می‌کنیم (رکوردِ
     حذف‌شده در جدول نیست — نامش از خودِ لاگ درمی‌آید)، بعد فیلترِ سمت
     کاربر و گروه‌بندیِ روزانه. صد ردیف است؛ همه‌اش همین‌جا در حافظه. */
  const logRows = (logs ?? []).map((l) => {
    const d = (l.details ?? {}) as Record<string, unknown>
    const subject =
      l.entity === 'employee'
        ? people?.find((p) => p.id === l.entity_id)?.full_name ??
          String(d.name ?? `#${l.entity_id ?? ''}`)
        : l.entity === 'user'
          ? String(d.username ?? users?.find((u) => u.id === l.entity_id)?.username ?? `#${l.entity_id ?? ''}`)
          : String(d.file ?? 'فایل')
    return { ...l, ...describeLog(l, subject) }
  })

  const q = logQuery.trim().toLowerCase()
  const visibleLogs = logRows.filter(
    (l) =>
      (logFilter === 'all' || l.entity === logFilter) &&
      (!q ||
        `${l.actor_name} ${l.subject} ${l.verb} ${l.lines.join(' ')}`.toLowerCase().includes(q)),
  )

  const logDays: [string, typeof visibleLogs][] = []
  for (const l of visibleLogs) {
    const day = l.at ? logDay(l.at) : 'بدون تاریخ'
    if (logDays[logDays.length - 1]?.[0] !== day) logDays.push([day, []])
    logDays[logDays.length - 1][1].push(l)
  }

  return (
    <div className="relative min-h-dvh bg-[rgb(var(--canvas))]">
      {/* حاشیه‌ی نقشه — همان خطوط ترازِ دفترچه و صفحه‌ی ورود */}
      <div className="chart-margin" aria-hidden="true">
        <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMax slice" className="h-full w-full">
          {CONTOURS.slice(4).map((d, i) => (
            <path key={i} d={d} className="sounding-line" />
          ))}
        </svg>
        {/* ردپای برند در مقیاسِ نقشه — بریده به لبه‌ی حاشیه، زیرِ همان
            پرده‌ای که خطوط تراز را محو می‌کند */}
        <img
          src="/brand-mark.png"
          alt=""
          aria-hidden="true"
          width={384}
          height={384}
          loading="lazy"
          decoding="async"
          className="chart-watermark brand-mark"
        />
        <div className="chart-margin-veil" />
      </div>

      <header ref={headRef} className="relative z-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 pt-6 sm:flex-row sm:items-start sm:justify-between sm:px-8">
          <BrandLockup variant="compact" title="پنل مدیریت" titleAs="h1" />
          {/* همان قاعده‌ی دفترچه: روی موبایل «خروج/تم» به لبه‌ی پایان */}
          <div className="flex shrink-0 items-center gap-1.5 sm:order-2">
            <Link to="/" className="masthead-action">
              <BookIcon className="h-[17px] w-[17px]" />
              <span>دفترچه</span>
            </Link>
            <div className="ms-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  forgetSession()
                  window.location.href = '/'
                }}
                className="masthead-action masthead-action--exit"
              >
                <LogOut strokeWidth={1.8} className="h-[17px] w-[17px]" aria-hidden="true" />
                <span>خروج</span>
              </button>
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* تب‌ها با زیرخط متحرک */}
        <nav ref={navRef} className="admin-tabs relative mx-auto mt-6 flex w-full max-w-6xl gap-1 px-5 text-[14px] sm:px-8">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              data-tab={key}
              onClick={() => setTab(key)}
              aria-selected={tab === key}
              role="tab"
              className={`px-4 py-2.5 font-medium transition-colors duration-200 ${
                tab === key ? 'text-tide' : 'text-ink-500 hover:text-ink-900'
              }`}
            >
              {label}
            </button>
          ))}
          {/* خط تراز به‌عنوان کفِ تب‌ها؛ نشانگرِ سبزآبی روی آن می‌لغزد */}
          <span ref={ruleRef} aria-hidden="true" className="admin-tabs-rule" />
          <span
            ref={underlineRef}
            aria-hidden="true"
            className="absolute bottom-0 left-0 h-[2px] rounded-full bg-sea-500 opacity-0 dark:bg-sea-400"
            style={{ width: 0 }}
          />
        </nav>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 py-7 pb-28 sm:px-8">
        {notice && (
          <div
            ref={noticeRef}
            role="status"
            className="mb-4 whitespace-pre-line rounded-xl bg-tint ring-1 ring-sand-200 text-ink-900 px-4 py-2.5 text-sm inline-flex items-start gap-2"
          >
            <CheckIcon className="w-4 h-4 mt-0.5 text-sea-600" />
            <span>{notice}</span>
          </div>
        )}

        <div ref={contentRef}>
          {tab === 'people' && (
            <>
              {/* toolbar */}
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <button
                  onClick={() => openEditor({ ...EMPTY })}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-deep-900 hover:bg-deep-800 text-white text-sm font-medium px-4 py-2.5 transition-colors duration-200 active:scale-[.97] dark:bg-sea-500 dark:text-deep-950 dark:hover:bg-sea-400"
                >
                  <UserPlusIcon className="w-4 h-4" />
                  افزودن نفر
                </button>

                <label
                  className={`inline-flex items-center gap-1.5 rounded-xl ring-1 ring-dashed ring-ink-300 hover:ring-sea-500 hover:text-tide text-ink-500 text-sm px-4 py-2.5 cursor-pointer transition-colors duration-200 ${
                    importing ? 'opacity-50 pointer-events-none' : ''
                  }`}
                >
                  <UploadIcon className="w-4 h-4" />
                  {importing ? (
                    <span className="inline-flex items-center gap-2">
                      در حال ایمپورت
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 search-spinner" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </span>
                  ) : (
                    'ایمپورت اکسل/CSV'
                  )}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleImport}
                    className="hidden"
                  />
                </label>
              </div>

              {/* list */}
              {/* جدول روی صفحه‌ی باریک خودش می‌لغزد، نه اینکه ستون‌های
                  آخر بیرون از کادر بمانند */}
              <div className="overflow-x-auto rounded-2xl border border-sand-200 bg-paper shadow-card">
                <table className="w-full min-w-[46rem] text-[14px] tnum">
                  <thead className="bg-sand-100/70 text-ink-500 text-xs">
                    <tr>
                      <th className="text-right px-4 py-3 font-medium">نام</th>
                      <th className="text-right px-4 py-3 font-medium">واحد</th>
                      <th className="text-right px-4 py-3 font-medium">سمت</th>
                      <th className="text-right px-4 py-3 font-medium">داخلی</th>
                      <th className="text-right px-4 py-3 font-medium">شماره مستقیم</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(people ?? []).map((p) => (
                      <tr
                        key={p.id}
                        data-row
                        className="border-t border-sand-100 hover:bg-tint/50 transition-colors duration-150"
                      >
                        <td className="px-4 py-3 font-medium text-ink-900">{p.full_name}</td>
                        <td className="px-4 py-3 text-ink-600">{p.department}</td>
                        <td className="px-4 py-3 text-ink-600">{p.job_title}</td>
                        <td className="px-4 py-3 text-ink-600" dir="ltr">{p.extension || '—'}</td>
                        <td className="px-4 py-3 text-ink-600" dir="ltr">{p.direct || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-left">
                          <button
                            onClick={() => openEditor(p)}
                            className="text-tide hover:text-ink-900 hover:underline underline-offset-4 text-xs ml-3"
                          >
                            ویرایش
                          </button>
                          <button
                            onClick={() => removeEmployee(p.id, p.full_name)}
                            className="text-red-500 hover:text-red-600 hover:underline underline-offset-4 text-xs"
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(people ?? []).length === 0 && (
                  <div className="text-center py-14 px-4">
                    <PersonIcon className="w-10 h-10 mx-auto text-ink-300 mb-3" />
                    <p className="text-sm text-ink-500">
                      هنوز کسی ثبت نشده — فایل اکسل را ایمپورت کنید یا نفر اضافه کنید.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'users' && (
            <>
            {/* ساخت حسابِ تازه. رمز نمی‌گیرد — سرور رمزِ موقت می‌سازد و
                همان یک‌بار نشانش می‌دهد. پیش‌فرض کاربرِ عادی است؛ دسترسیِ
                مدیریت باید صریح تیک بخورد. */}
            <form
              onSubmit={addUser}
              className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-sand-200 bg-paper p-4 shadow-card"
            >
              <div className="min-w-[10rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-ink-500">نام کاربری</label>
                <input
                  dir="ltr"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full rounded-xl border border-sand-300 bg-sand-50/60 px-3 py-2 text-left text-sm text-ink-900 transition-colors focus:border-sea-500 focus:bg-paper focus:outline-none focus:ring-2 focus:ring-sea-500/20"
                />
              </div>
              <label className="flex cursor-pointer select-none items-center gap-2 py-2.5 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={newUser.is_admin}
                  onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })}
                  className="h-4 w-4 rounded border-sand-300 accent-sea-500"
                />
                دسترسی مدیریت
              </label>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-sea-500 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-sea-600 active:scale-[.98] dark:text-deep-950 dark:hover:bg-sea-400"
              >
                <UserPlusIcon className="h-4 w-4" />
                افزودن حساب
              </button>
              <p className="w-full text-[11px] text-ink-400">
                بدونِ حساب هیچ‌کس دفترچه را نمی‌بیند، پس هر کارمند یکی لازم دارد. رمزِ موقت
                خودکار ساخته می‌شود و فقط همان لحظه نشان داده می‌شود؛ صاحبش سرِ اولین ورود
                باید رمز خودش را بگذارد.
              </p>
            </form>

            <div className="overflow-x-auto rounded-2xl border border-sand-200 bg-paper shadow-card">
              <table className="w-full min-w-[30rem] text-[14px] tnum">
                <thead className="bg-sand-100/70 text-ink-500 text-xs">
                  <tr>
                    {/* دو ستونِ اول به‌اندازه‌ی محتوا؛ ستونِ دکمه‌ها باقیِ عرض را
                        می‌گیرد تا با کم‌شدنِ ستون‌ها جدول از هم باز نشود. */}
                    <th className="whitespace-nowrap text-right px-4 py-3 font-medium">نام کاربری</th>
                    <th className="whitespace-nowrap text-right px-4 py-3 font-medium">نقش</th>
                    <th className="whitespace-nowrap text-right px-4 py-3 font-medium">وضعیت</th>
                    <th className="w-full"></th>
                  </tr>
                </thead>
                <tbody>
                  {(users ?? []).map((u) => (
                    <tr
                      key={u.id}
                      data-row
                      className="border-t border-sand-100 hover:bg-tint/50 transition-colors duration-150"
                    >
                      <td className="px-4 py-3 text-left text-ink-900" dir="ltr">
                        <button
                          type="button"
                          onClick={() => copyText(u.username, 'نام کاربری')}
                          title="کپی نام کاربری"
                          className="rounded px-1 transition-colors hover:bg-tint hover:text-tide"
                        >
                          {u.username}
                        </button>
                      </td>

                      <td className="px-4 py-3 text-xs">
                        {u.is_admin ? (
                          <span className="font-medium text-tide">مدیر</span>
                        ) : (
                          <span className="text-ink-400">کاربر</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-xs">
                        {u.is_active ? (
                          <span className="text-sea-600 font-medium">فعال</span>
                        ) : (
                          <span className="text-red-500">غیرفعال</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-left">
                        <button
                          onClick={() => openCredentials(u)}
                          className="text-tide hover:text-ink-900 hover:underline underline-offset-4 text-xs ml-3"
                        >
                          تغییر یوزر/رمز
                        </button>
                        <button
                          onClick={() => resetPassword(u)}
                          className="text-ink-500 hover:text-ink-900 hover:underline underline-offset-4 text-xs ml-3"
                        >
                          رمز موقت
                        </button>
                        <button
                          onClick={() => toggleAdmin(u)}
                          className="text-ink-500 hover:text-ink-900 hover:underline underline-offset-4 text-xs ml-3"
                        >
                          {u.is_admin ? 'سلبِ مدیریت' : 'دادنِ مدیریت'}
                        </button>
                        <button
                          onClick={() => toggleActive(u.id)}
                          className="text-ink-500 hover:text-ink-900 hover:underline underline-offset-4 text-xs"
                        >
                          {u.is_active ? 'غیرفعال' : 'فعال'}‌سازی
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(users ?? []).length === 0 && (
                <div className="text-center text-ink-400 py-12 text-sm">حسابی ثبت نشده.</div>
              )}
            </div>
            </>
          )}

          {tab === 'logs' && (
            <>
              {/* صافی‌ها: صد ردیفِ آخر همین‌جاست، پس فیلتر و جستجو بدون
                  رفت‌وبرگشت به سرور انجام می‌شود. */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {LOG_FILTERS.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setLogFilter(key)}
                    aria-pressed={logFilter === key}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-200 ${
                      logFilter === key
                        ? 'bg-deep-900 text-white dark:bg-sea-500 dark:text-deep-950'
                        : 'bg-tint text-ink-600 ring-1 ring-sand-200 hover:text-tide'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <label className="relative ms-auto">
                  <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
                  <input
                    value={logQuery}
                    onChange={(e) => setLogQuery(e.target.value)}
                    placeholder="جستجو در تغییرات"
                    className="w-52 rounded-xl border border-sand-300 bg-sand-50/60 py-2 pe-3 ps-9 text-sm text-ink-900 transition-colors focus:border-sea-500 focus:bg-paper focus:outline-none focus:ring-2 focus:ring-sea-500/20"
                  />
                </label>
              </div>

              {logDays.map(([day, rows]) => (
                <section key={day} className="mb-5 last:mb-0">
                  <h3 className="mb-2 flex items-center gap-3 text-xs font-medium text-ink-400">
                    {day}
                    <span aria-hidden="true" className="h-px flex-1 bg-sand-200" />
                    <span className="tnum">{faDigits(rows.length)}</span>
                  </h3>

                  <div className="overflow-hidden rounded-2xl border border-sand-200 bg-paper shadow-card">
                    {rows.map((l) => (
                      <article
                        key={l.id}
                        data-row
                        className="flex items-start gap-3 border-t border-sand-100 px-4 py-3 text-sm transition-colors duration-150 first:border-t-0 hover:bg-tint/50"
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[l.tone]}`}
                        />

                        <div className="min-w-0 flex-1">
                          <p className="text-ink-500">
                            <span className="font-medium text-ink-900">{l.actor_name}</span>{' '}
                            {l.verb}{' '}
                            <span className="font-medium text-ink-900">{l.subject}</span>
                          </p>

                          {/* ریزِ آنچه عوض شده — همان چیزی که دفتر برایش هست */}
                          {l.lines.length > 0 && (
                            <ul className="mt-1.5 space-y-1 text-xs text-ink-500">
                              {l.lines.map((line, i) => (
                                <li key={i} className="break-words">
                                  {line}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <time
                          dateTime={l.at ?? undefined}
                          title={l.at ? new Date(l.at).toLocaleString('fa-IR') : ''}
                          className="tnum shrink-0 whitespace-nowrap text-xs text-ink-400"
                        >
                          {l.at ? logTime(l.at) : '—'}
                        </time>
                      </article>
                    ))}
                  </div>
                </section>
              ))}

              {visibleLogs.length === 0 && (
                <div className="rounded-2xl border border-sand-200 bg-paper px-4 py-14 text-center shadow-card">
                  <BookIcon className="mx-auto mb-3 h-10 w-10 text-ink-300" />
                  <p className="text-sm text-ink-500">
                    {(logs ?? []).length === 0
                      ? 'هنوز تغییری ثبت نشده.'
                      : 'با این صافی چیزی پیدا نشد.'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* رمزِ موقت — یک‌بار و همین یک‌بار */}
      {issued && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`رمز موقت ${issued.username}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIssued(null)
          }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-deep-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        >
          <div className="w-full max-w-md space-y-4 rounded-t-2xl border border-sand-200 bg-paper p-6 shadow-panel sm:rounded-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink-900">رمز موقت ساخته شد</h2>
              <button
                type="button"
                onClick={() => setIssued(null)}
                aria-label="بستن"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-colors duration-200 hover:bg-sand-100 hover:text-ink-700"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-ink-500">
              این رمز فقط همین یک‌بار نشان داده می‌شود — روی سرور فقط هشش می‌ماند. اگر ببندیدش
              و یادداشت نکرده باشید، باید رمز موقتِ تازه‌ای بسازید.
            </p>

            <dl className="space-y-2 rounded-xl border border-sand-200 bg-sand-50/60 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-ink-500">نام کاربری</dt>
                <dd dir="ltr" className="text-sm font-medium text-ink-900">
                  {issued.username}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-ink-500">رمز موقت</dt>
                <dd dir="ltr" className="select-all text-base font-bold tracking-wide text-ink-900">
                  {issued.temp_password}
                </dd>
              </div>
            </dl>

            <p className="text-[11px] text-ink-400">
              کاربر با همین رمز وارد می‌شود و بلافاصله باید رمز خودش را بگذارد.
            </p>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() =>
                  copyText(
                    `${issued.username} / ${issued.temp_password}`,
                    'نام کاربری و رمز موقت',
                  )
                }
                className="flex-1 rounded-xl bg-sea-500 py-3 font-medium text-white transition-colors duration-200 hover:bg-sea-600 active:scale-[.98] dark:text-deep-950 dark:hover:bg-sea-400"
              >
                کپی نام کاربری و رمز
              </button>
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="rounded-xl bg-sand-100 px-6 text-ink-700 transition-colors hover:bg-sand-200"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ست‌کردن دستی نام کاربری و رمز */}
      {credEditing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`نام کاربری و رمز ${credEditing.username}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCredEditing(null)
          }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-deep-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        >
          <form
            onSubmit={saveCredentials}
            className="w-full max-w-md space-y-4 rounded-t-2xl border border-sand-200 bg-paper p-6 shadow-panel sm:rounded-2xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink-900">نام کاربری و رمز</h2>
              <button
                type="button"
                onClick={() => setCredEditing(null)}
                aria-label="بستن"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-colors duration-200 hover:bg-sand-100 hover:text-ink-700"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">نام کاربری</label>
              <input
                dir="ltr"
                value={credForm.username}
                onChange={(e) => setCredForm({ ...credForm, username: e.target.value })}
                className="w-full rounded-xl border border-sand-300 bg-sand-50/60 px-3 py-2 text-left text-sm text-ink-900 transition-colors focus:border-sea-500 focus:bg-paper focus:outline-none focus:ring-2 focus:ring-sea-500/20"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">رمز عبور</label>
              <input
                dir="ltr"
                value={credForm.password}
                placeholder="خالی = بدون تغییر"
                onChange={(e) => setCredForm({ ...credForm, password: e.target.value })}
                className="w-full rounded-xl border border-sand-300 bg-sand-50/60 px-3 py-2 text-left text-sm text-ink-900 transition-colors placeholder:text-ink-300 focus:border-sea-500 focus:bg-paper focus:outline-none focus:ring-2 focus:ring-sea-500/20"
              />
              <p className="mt-1 text-[11px] text-ink-400">
                دست‌کم ۶ نویسه. بعد از ذخیره، رمز فقط هش می‌شود و دیگر از پنل خوانده نمی‌شود —
                همین‌جا یادداشتش کنید.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 rounded-xl bg-sea-500 py-3 font-medium text-white transition-colors duration-200 hover:bg-sea-600 active:scale-[.98] dark:text-deep-950 dark:hover:bg-sea-400"
              >
                ذخیره
              </button>
              <button
                type="button"
                onClick={() => setCredEditing(null)}
                className="rounded-xl bg-sand-100 px-6 text-ink-700 transition-colors hover:bg-sand-200"
              >
                انصراف
              </button>
            </div>
          </form>
        </div>
      )}

      {/* edit modal */}
      {editing && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label={editing.id ? 'ویرایش پرسنل' : 'افزودن پرسنل جدید'}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null)
          }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-deep-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        >
          <form
            ref={sheetRef}
            onSubmit={saveEmployee}
            className="max-h-[92dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-2xl border border-sand-200 bg-paper p-6 shadow-panel sm:rounded-2xl"
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-lg text-ink-900">
                {editing.id ? 'ویرایش پرسنل' : 'افزودن پرسنل جدید'}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="بستن"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-colors duration-200 hover:bg-sand-100 hover:text-ink-700"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FIELDS.map(renderField)}
            </div>

            {/* --- خط تراز: بالایی‌ها را ادمین می‌داند، پایینی‌ها را مدل می‌نویسد --- */}
            <div className="pt-5">
              <div className="flex flex-wrap items-end justify-between gap-3 border-t border-sand-200 pt-4">
                <h3 className="text-sm font-bold text-ink-900">شرح و کلیدواژه‌ها</h3>
                <button
                  type="button"
                  onClick={suggestFields}
                  disabled={suggesting || !canSuggest}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium text-tide ring-1 ring-sand-300 transition-colors duration-200 hover:bg-tint hover:ring-sea-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sea-500 disabled:cursor-not-allowed disabled:text-ink-400 disabled:ring-sand-200 disabled:hover:bg-transparent"
                >
                  {suggesting ? (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" className="search-spinner h-4 w-4" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      در حال نوشتن
                    </>
                  ) : (
                    <>
                      <SparkIcon className="h-4 w-4" />
                      تکمیل با هوش مصنوعی
                    </>
                  )}
                </button>
              </div>

              {!canSuggest && (
                <p className="mt-3 text-[11px] text-ink-400">
                  برای تکمیل خودکار، اول نام یا سمت یا واحد را پر کنید.
                </p>
              )}
              {aiError && (
                <p role="alert" className="mt-3 rounded-xl bg-sand-100 px-3 py-2 text-[12px] leading-5 text-ink-700">
                  {aiError}
                </p>
              )}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {AI_FIELDS.map(renderField)}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 rounded-xl bg-sea-500 hover:bg-sea-600 text-white font-medium py-3 transition-colors duration-200 active:scale-[.98] dark:text-deep-950 dark:hover:bg-sea-400"
              >
                ذخیره
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-xl bg-sand-100 hover:bg-sand-200 text-ink-700 px-6 transition-colors"
              >
                انصراف
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
