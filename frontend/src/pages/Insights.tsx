import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import gsap from 'gsap'
import { Link } from 'react-router-dom'
import { LogOut, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { forgetSession, useSession } from '../lib/auth'
import BrandLockup from '../components/BrandLockup'
import ThemeToggle from '../components/ThemeToggle'
import Select from '../components/ui/select'
import { BookIcon } from '../components/icons'
import { faDigits, shouldAnimate } from '../lib/motion'
import { roleLabel } from '../lib/roles'
import { CONTOURS } from './login-contours'
import { ColumnChart, ShareBars, StatTile, TrendChart } from '../components/charts'
import { faDay, faNumber } from '../lib/format'
import type { Column, ShareRow, TrendPoint } from '../components/charts'

/* قرارداد Impeccable — «نمای کلی» در همان دنیای نقشه‌ی عمق‌سنجی.
   THESIS: استفاده از دفترچه هم یک عمق‌سنجی است — چند بار، کِی، دنبالِ چه.
   این صفحه چیزی تازه ثبت نمی‌کند: همان دفترِ تغییرات را می‌خواند و
   می‌شمارد. پس هیچ عددی اینجا نیست که در تبِ «تغییرات» ردش پیدا نشود.

   DENSITY: یک عددِ سرصفحه، چهار کاشی، یک روند، دو ستونی، سه فهرست.
   COLOR: یک اکسنت و بس. تأکید با پررنگی است نه با رنگِ تازه — این دنیا
          جز قرمزِ خطا رنگِ دیگری ندارد و نباید داشته باشد. */

type Totals = {
  views: number
  directory_views: number
  card_views: number
  list_views: number
  searches: number
  logins: number
  failed_logins: number
  changes: number
  active_users: number
}

type Overview = {
  range: { days: number; from: string; to: string; truncated: boolean }
  totals: Totals
  previous: Totals
  daily: { date: string; views: number; searches: number; logins: number; changes: number }[]
  hourly: { hour: number; views: number }[]
  weekday: { day: number; views: number }[]
  top_queries: { term: string; count: number }[]
  top_people: { id: number; name: string; count: number }[]
  top_actors: { name: string; role: string; count: number }[]
  by_unit: { id: number | null; name: string; views: number }[]
  directory: { employees: number; accounts: number; active_accounts: number; units: number }
}

type Organization = { id: number; name: string; is_active: boolean }

const RANGES = [
  ['7', '۷ روز'],
  ['30', '۳۰ روز'],
  ['90', '۹۰ روز'],
  ['365', 'یک سال'],
] as const

/* معیارهای روند. هر کدام یک سری است و تنها یکی هم‌زمان رسم می‌شود:
   «بازدید» و «ورود» دو مقیاسِ کاملاً متفاوت‌اند و گذاشتنشان روی یک قاب
   با دو محور، همبستگی‌ای می‌سازد که در داده نیست. */
const METRICS = [
  { key: 'views', label: 'بازدید', note: 'هر بار سر زدن به دفترچه یا کارتِ یک نفر' },
  { key: 'searches', label: 'جستجو', note: 'سر زدن‌هایی که با یک عبارتِ جستجو همراه بوده' },
  { key: 'logins', label: 'ورود', note: 'ورودهای موفق به سامانه' },
  { key: 'changes', label: 'تغییر داده', note: 'ثبت، ویرایش، حذف و ایمپورت' },
] as const

type MetricKey = (typeof METRICS)[number]['key']

const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه']

/* تورِ ایمنیِ ورود.

   `shouldAnimate()` تبِ پنهان را می‌گیرد، ولی حالتِ دیگری هم هست: صفحه
   دیده می‌شود، تویین ساخته می‌شود و مقدارِ آغازش (opacity ۰) می‌نشیند،
   بعد requestAnimationFrame وسطِ کار می‌ایستد — پنجره‌ی پس‌زمینه، پنلِ
   بسته، فریمِ جاافتاده. آن‌وقت تویین سرِ جای اول یخ می‌زند و صفحه سفید
   می‌ماند: دقیقاً همان «گروگان گرفتنِ محتوا با موشن» که قرار بود نشود.

   setTimeout برخلاف rAF در پس‌زمینه هم می‌آید. کمی بعد از پایانِ طبیعیِ
   توالی (~۰.۸۵ ثانیه) سر می‌رسد و اگر کاری نیمه‌تمام مانده باشد تمامش
   می‌کند؛ در حالتِ عادی هیچ اثری ندارد. */
const SETTLE_MS = 1600

/** درصدِ تغییر. مبنای صفر نسبتی نمی‌سازد، پس آنجا چیزی گفته نمی‌شود. */
function delta(now: number, before: number): number | null {
  if (!before) return null
  return ((now - before) / before) * 100
}

export default function Insights() {
  const { session } = useSession()
  const isGlobal = session?.role === 'GLOBAL_ADMIN'
  const [days, setDays] = useState<string>('30')
  const [metric, setMetric] = useState<MetricKey>('views')
  const [selectedOrg, setSelectedOrg] = useState('')
  const [showTable, setShowTable] = useState(false)

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api<Organization[]>('/api/admin/organizations'),
    enabled: isGlobal,
  })

  const scope = selectedOrg ? `&organization_id=${selectedOrg}` : ''
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analytics', days, selectedOrg],
    queryFn: () => api<Overview>(`/api/admin/analytics?days=${days}${scope}`),
    // عددِ چند دقیقه پیش برای یک نمای کلی کافی است؛ هر بازگشت به تب
    // نباید یک پرسشِ تازه بسازد.
    staleTime: 60_000,
  })

  const headRef = useRef<HTMLElement>(null)
  const ruleRef = useRef<HTMLSpanElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const head = headRef.current
    if (!head || !shouldAnimate()) return
    let settle = 0
    const ctx = gsap.context(() => {
      const intro = gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from(head, { opacity: 0, y: -14, duration: 0.55 }, 0)
        .from(ruleRef.current, { scaleX: 0, duration: 0.9 }, 0.1)
        .from(bodyRef.current, { opacity: 0, y: 16, duration: 0.6 }, 0.25)
      settle = window.setTimeout(() => intro.progress(1), SETTLE_MS)
    }, head)
    return () => {
      clearTimeout(settle)
      ctx.revert()
    }
  }, [])

  /* کارت‌ها با هر پاسخِ تازه یک‌بار و کوتاه پرده برمی‌دارند — نه با هر
     رندر، وگرنه هر حرکتِ نشانگر روی نمودار یک انیمیشن تازه می‌سازد. */
  const stamp = data?.range.from ?? ''
  useEffect(() => {
    const body = bodyRef.current
    if (!body || !stamp || !shouldAnimate()) return
    const tween = gsap.fromTo(
      body.querySelectorAll('[data-card]'),
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: 'expo.out', clearProps: 'transform,opacity' },
    )
    const settle = window.setTimeout(() => tween.progress(1), SETTLE_MS)
    return () => {
      clearTimeout(settle)
      tween.kill()
    }
  }, [stamp, metric])

  const totals = data?.totals
  const previous = data?.previous

  const trend: TrendPoint[] = useMemo(
    () => (data?.daily ?? []).map((d) => ({ date: d.date, value: d[metric] })),
    [data, metric],
  )

  const hourly: Column[] = useMemo(
    () => (data?.hourly ?? []).map((h) => ({
      key: String(h.hour),
      label: faDigits(h.hour),
      value: h.views,
    })),
    [data],
  )

  const weekly: Column[] = useMemo(
    () => (data?.weekday ?? []).map((w) => ({
      key: String(w.day),
      label: WEEKDAYS[w.day] ?? String(w.day),
      value: w.views,
    })),
    [data],
  )

  const unitRows: ShareRow[] = (data?.by_unit ?? []).map((u) => ({
    key: u.id ?? 'none',
    label: u.name,
    value: u.views,
  }))

  const activeMetric = METRICS.find((m) => m.key === metric) ?? METRICS[0]
  const busiestHour = hourly.reduce(
    (best, h) => (h.value > (hourly[best]?.value ?? -1) ? Number(h.key) : best),
    0,
  )

  return (
    <div className="relative min-h-dvh bg-[rgb(var(--canvas))]">
      <div className="chart-margin" aria-hidden="true">
        <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMax slice" className="h-full w-full">
          {CONTOURS.slice(4).map((d, i) => (
            <path key={i} d={d} className="sounding-line" />
          ))}
        </svg>
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
          <BrandLockup variant="compact" title="نمای کلی" titleAs="h1" />
          <div className="flex shrink-0 items-center gap-1.5 sm:order-2">
            <Link to="/" className="masthead-action">
              <BookIcon className="h-[17px] w-[17px]" />
              <span>دفترچه</span>
            </Link>
            <Link to="/admin" className="masthead-action">
              <ShieldCheck strokeWidth={1.8} className="h-[17px] w-[17px]" aria-hidden="true" />
              <span>پنل</span>
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

        <p className="mx-auto mt-4 w-full max-w-6xl px-5 text-[12.5px] leading-relaxed text-ink-500 sm:px-8">
          این صفحه چیزی جدا ثبت نمی‌کند؛ همان دفترِ تغییرات را می‌شمارد. پس هر عددی
          که اینجا می‌بینید، ردش در تبِ «تغییرات» هم هست. «بازدید» یعنی یک بار سر
          زدن: اسکرول کردن، رفرش و جستجوهای پشت‌سرهم در یک ربع‌ساعت، همان یک بازدید
          می‌مانند.
        </p>

        {/* صافی‌ها همه در یک سطر، بالای نمودارها. */}
        <div className="mx-auto mt-5 flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2.5 px-5 sm:px-8">
          <div role="group" aria-label="بازهٔ زمانی" className="flex flex-wrap items-center gap-1.5">
            {RANGES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                aria-pressed={days === value}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-200 ${
                  days === value
                    ? 'bg-deep-900 text-white dark:bg-sea-500 dark:text-deep-950'
                    : 'bg-tint text-ink-600 ring-1 ring-sand-200 hover:text-tide'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {isGlobal && (
            <>
              <span aria-hidden="true" className="text-sand-300">·</span>
              <Select
                size="sm"
                aria-label="انتخاب واحد سازمانی"
                value={selectedOrg}
                onChange={setSelectedOrg}
                options={[
                  { value: '', label: 'همهٔ واحدها' },
                  ...(organizations ?? []).filter((o) => o.is_active).map((o) => ({
                    value: String(o.id),
                    label: o.name,
                  })),
                ]}
              />
            </>
          )}

          {data && (
            <span className="tnum ms-auto text-[11.5px] text-ink-400">
              {faDay(data.range.from, true)} تا {faDay(data.range.to, true)}
            </span>
          )}
        </div>

        <span
          ref={ruleRef}
          aria-hidden="true"
          className="mx-auto mt-5 block h-px w-full max-w-6xl origin-right bg-sand-200"
        />
      </header>

      <main ref={bodyRef} className="relative z-10 mx-auto w-full max-w-6xl px-5 py-7 pb-20 sm:px-8">
        {isLoading && (
          <p role="status" className="py-20 text-center text-sm text-ink-500">
            در حال خواندن دفتر…
          </p>
        )}

        {isError && (
          <p role="alert" className="rounded-2xl border border-sand-200 bg-paper px-4 py-10 text-center text-sm text-ink-500">
            {error instanceof Error ? error.message : 'خواندن نمای کلی انجام نشد'}
          </p>
        )}

        {data && totals && previous && (
          <>
            {/* عددِ سرصفحه — یکی، و فقط یکی. */}
            <section data-card className="mb-6">
              <p className="text-[13px] text-ink-500">بازدید در این بازه</p>
              <p className="mt-1.5 text-[52px] font-bold leading-none text-ink-900">
                {faNumber(totals.views)}
              </p>
              <p className="mt-2.5 max-w-[60ch] text-[12.5px] leading-relaxed text-ink-500">
                {faNumber(totals.directory_views)} بار دفترچه، {faNumber(totals.card_views)} بار کارتِ
                تماس و {faNumber(totals.list_views)} بار فهرست‌های مدیریتی باز شده است.
                {data.range.truncated && ' (بازه بزرگ‌تر از آن بود که کامل شمرده شود؛ عددها کف‌اند.)'}
              </p>
            </section>

            <section
              aria-label="خلاصهٔ بازه"
              className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0"
            >
              <div data-card>
                <StatTile
                  label="جستجو"
                  value={totals.searches}
                  delta={delta(totals.searches, previous.searches)}
                  values={data.daily.map((d) => d.searches)}
                />
              </div>
              <div data-card>
                <StatTile
                  label="ورود موفق"
                  value={totals.logins}
                  delta={delta(totals.logins, previous.logins)}
                  values={data.daily.map((d) => d.logins)}
                  hint={totals.failed_logins ? `${faNumber(totals.failed_logins)} ورود ناموفق` : undefined}
                />
              </div>
              <div data-card>
                <StatTile
                  label="حساب‌های فعال در بازه"
                  value={totals.active_users}
                  delta={delta(totals.active_users, previous.active_users)}
                  hint={`از ${faNumber(data.directory.active_accounts)} حساب فعال`}
                />
              </div>
              <div data-card>
                <StatTile
                  label="تغییر در داده"
                  value={totals.changes}
                  delta={delta(totals.changes, previous.changes)}
                  values={data.daily.map((d) => d.changes)}
                  hint={`${faNumber(data.directory.employees)} نفر در دفترچه`}
                />
              </div>
            </section>

            {/* روند — یک سری در هر لحظه، با انتخاب‌گرِ معیار. */}
            <section data-card className="mb-6 rounded-2xl border border-sand-200 bg-paper p-5 sm:p-6">
              <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-bold text-ink-900">
                    {activeMetric.label} در {faDigits(data.range.days)} روز گذشته
                  </h2>
                  <p className="mt-1 text-[12px] text-ink-500">{activeMetric.note}</p>
                </div>
                <div role="group" aria-label="معیار نمودار" className="flex flex-wrap gap-1.5">
                  {METRICS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMetric(m.key)}
                      aria-pressed={metric === m.key}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
                        metric === m.key
                          ? 'bg-deep-900 text-white dark:bg-sea-500 dark:text-deep-950'
                          : 'bg-tint text-ink-600 ring-1 ring-sand-200 hover:text-tide'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <TrendChart points={trend} label={activeMetric.label} />
              </div>

              {/* نمودار تنها راهِ رسیدن به عدد نیست. */}
              <div className="mt-3 border-t border-sand-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowTable((v) => !v)}
                  aria-expanded={showTable}
                  className="text-xs text-tide underline-offset-4 transition-colors hover:text-ink-900 hover:underline"
                >
                  {showTable ? 'بستن جدول اعداد' : 'دیدن اعداد به‌شکل جدول'}
                </button>

                {showTable && (
                  <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-sand-200">
                    <table className="w-full text-[13px] tnum">
                      <thead className="sticky top-0 bg-sand-100/90 text-xs text-ink-500 backdrop-blur">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-right font-medium">روز</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">بازدید</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">جستجو</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">ورود</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">تغییر</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...data.daily].reverse().map((d) => (
                          <tr key={d.date} className="border-t border-sand-100">
                            <td className="whitespace-nowrap px-3 py-2 text-ink-700">{faDay(d.date, true)}</td>
                            <td className="px-3 py-2 text-ink-600">{faNumber(d.views)}</td>
                            <td className="px-3 py-2 text-ink-600">{faNumber(d.searches)}</td>
                            <td className="px-3 py-2 text-ink-600">{faNumber(d.logins)}</td>
                            <td className="px-3 py-2 text-ink-600">{faNumber(d.changes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <section data-card className="min-w-0 rounded-2xl border border-sand-200 bg-paper p-5 sm:p-6">
                <h2 className="text-[15px] font-bold text-ink-900">ساعت‌های کاری دفترچه</h2>
                <p className="mt-1 text-[12px] text-ink-500">
                  {totals.views > 0
                    ? `پربارترین ساعت، ${faDigits(busiestHour)} است.`
                    : 'در این بازه بازدیدی ثبت نشده.'}
                </p>
                <div className="mt-3">
                  <ColumnChart columns={hourly} label="بازدید" labelEvery={3} />
                </div>
              </section>

              <section data-card className="min-w-0 rounded-2xl border border-sand-200 bg-paper p-5 sm:p-6">
                <h2 className="text-[15px] font-bold text-ink-900">روزهای هفته</h2>
                <p className="mt-1 text-[12px] text-ink-500">
                  مجموعِ بازدید در کلِ بازه، به تفکیکِ روز هفته.
                </p>
                <div className="mt-3">
                  <ColumnChart columns={weekly} label="بازدید" />
                </div>
              </section>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel
                data-card
                title="بیشترین جستجوها"
                empty="جستجویی ثبت نشده."
                rows={data.top_queries.map((q) => ({ key: q.term, label: `«${q.term}»`, value: q.count }))}
                unit="بار"
              />
              <Panel
                title="پربازدیدترین همکاران"
                empty="کارت تماسی گرفته نشده."
                rows={data.top_people.map((p) => ({ key: p.id, label: p.name, value: p.count }))}
                unit="کارت"
              />
              <Panel
                title="فعال‌ترین حساب‌ها"
                empty="فعالیتی ثبت نشده."
                rows={data.top_actors.map((a) => ({
                  key: a.name,
                  label: a.name,
                  value: a.count,
                  hint: a.role ? roleLabel(a.role) : undefined,
                }))}
                unit="رویداد"
              />
            </div>

            {/* سهمِ واحدها فقط وقتی معنا دارد که بیش از یکی دیده شود. */}
            {unitRows.length > 1 && (
              <section data-card className="mt-4 rounded-2xl border border-sand-200 bg-paper p-5 sm:p-6">
                <h2 className="text-[15px] font-bold text-ink-900">سهم واحدها از بازدید</h2>
                <div className="mt-4">
                  <ShareBars rows={unitRows} unit="بازدید" />
                </div>
              </section>
            )}

            <p className="mt-8 text-[11.5px] leading-relaxed text-ink-400">
              محدودهٔ داده: {selectedOrg
                ? organizations?.find((o) => String(o.id) === selectedOrg)?.name
                : isGlobal ? 'همهٔ واحدها' : session?.organization_name || 'واحد شما'}
              {' · '}نقش شما {roleLabel(session?.role)}
              {' · '}دفتر، کارِ پشتِ هم از یک حساب در یک ربع‌ساعت را یک ردیف نگه می‌دارد و
              همان یک بازدید شمرده می‌شود — پس عدد با اسکرول و رفرش بالا نمی‌رود.
            </p>
          </>
        )}
      </main>
    </div>
  )
}

/** فهرستِ رتبه‌بندی‌شده — سه‌تایشان یک شکل دارند، پس یک‌بار نوشته می‌شود. */
function Panel({
  title, rows, unit, empty,
}: {
  title: string
  rows: ShareRow[]
  unit: string
  empty: string
  'data-card'?: boolean
}) {
  return (
    <section data-card className="min-w-0 rounded-2xl border border-sand-200 bg-paper p-5 sm:p-6">
      <h2 className="text-[15px] font-bold text-ink-900">{title}</h2>
      <div className="mt-4">
        {rows.length ? (
          <ShareBars rows={rows} unit={unit} />
        ) : (
          <p className="py-6 text-center text-[13px] text-ink-400">{empty}</p>
        )}
      </div>
    </section>
  )
}
