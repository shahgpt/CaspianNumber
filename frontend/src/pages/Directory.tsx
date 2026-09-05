import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import gsap from 'gsap'
import { Link } from 'react-router-dom'
import { ChevronDown, LogOut, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { forgetSession, useSession } from '../lib/auth'
import type { Employee } from '../lib/api'
import PinList from '../components/PinList'
import EmployeeAutocomplete from '../components/EmployeeAutocomplete'
import BrandLockup from '../components/BrandLockup'
import ThemeToggle from '../components/ThemeToggle'
import { countTo, createRevealer, faDigits, shouldAnimate } from '../lib/motion'
import type { Revealer } from '../lib/motion'
import { readPins, writePins } from '../lib/pins'
import { CONTOURS, SOUNDINGS } from './login-contours'

/* قرارداد Impeccable — دنیای «نقشه‌ی عمق‌سنجی» (ادامه‌ی صفحه‌ی ورود)
   THESIS: دفترچه، خودِ نقشه است. صفحه همان کاغذِ سفیدِ ورود می‌ماند و
           فهرست همکاران روی یک «محور عمق» عمودی نشانه‌گذاری می‌شود.
   FOCAL MOTION: سنجاق که زده شد، ردیف با یک فنر بینِ دو گروه پرواز می‌کند.
   DENSITY: ردیف به‌جای کارت — عدد همان‌جا خوانده می‌شود، نه پشت یک دکمه. */

const SUGGESTIONS = ['استخدام', 'شبکه', 'مالی', 'فاکتور']
const PAGE = 30

export default function Directory() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  // نقش را سرور تأیید می‌کند؛ اینجا فقط تصمیمِ نمایش گرفته می‌شود
  const { isAdmin, session } = useSession()
  const isGlobal = session?.role === 'GLOBAL_ADMIN'
  const [selectedOrg, setSelectedOrg] = useState('')
  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api<Array<{ id: number; name: string; is_active: boolean }>>('/api/admin/organizations'),
    enabled: isGlobal,
  })

  /* فهرست صفحه‌صفحه پایین می‌آید: هر بار که ته فهرست به کادرِ دید نزدیک
     می‌شود، یک تراز عمیق‌تر خوانده می‌شود. صفحه‌ی ناقص یعنی ته رسیده‌ایم. */
  const { data, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['employees', query, selectedOrg],
      queryFn: ({ pageParam }) =>
        api<Employee[]>(
          `/api/employees?q=${encodeURIComponent(query)}&limit=${PAGE}&offset=${pageParam}${selectedOrg ? `&organization_id=${selectedOrg}` : ''}`,
        ),
      initialPageParam: 0,
      getNextPageParam: (last, pages) =>
        last.length < PAGE ? undefined : pages.length * PAGE,
    })

  const results = data?.pages.flat()

  const pageRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const mastheadRef = useRef<HTMLDivElement>(null)
  const logoRef = useRef<HTMLDivElement>(null)
  const ruleRef = useRef<SVGSVGElement>(null)
  const subRef = useRef<HTMLParagraphElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const adminRef = useRef<HTMLAnchorElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const countLineRef = useRef<HTMLParagraphElement>(null)
  const rosterRef = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const emptyRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const revealerRef = useRef<Revealer | null>(null)
  const lastCount = useRef(-1)
  const [atEnd, setAtEnd] = useState(false)

  /* سنجاق‌ها روی همین مرورگر می‌مانند — سرور از آن‌ها خبر ندارد */
  const [pins, setPins] = useState<Set<number>>(readPins)

  const browsing = query.trim() === ''
  const rows = (results ?? []).map((emp) => ({ ...emp, pinned: pins.has(emp.id) }))
  const isEmpty = results && results.length === 0 && !browsing

  function togglePin(id: number) {
    setPins((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      writePins(next)
      return next
    })
  }

  /* --- لحظه‌ی امضایی: محور کشیده می‌شود و صحنه پرده برمی‌دارد.
         عنوان اینجا حرف‌به‌حرف نمی‌آید — آن یک‌بار در صفحه‌ی ورود اجرا شد؛
         تکرارش روی صفحه‌ای که هر روز باز می‌شود، خسته‌کننده است. --- */
  useEffect(() => {
    const masthead = mastheadRef.current
    if (!masthead || !shouldAnimate()) return

    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from(logoRef.current, { opacity: 0, y: 12, duration: 0.7 }, 0.05)
        .from(subRef.current, { opacity: 0, y: 8, duration: 0.6 }, 0.16)
        .from(
          actionsRef.current?.children ?? [],
          { opacity: 0, y: 10, duration: 0.55, stagger: 0.06 },
          0.22,
        )
        .from(ruleRef.current, { scaleX: 0, duration: 0.9 }, 0.3)
        .from(
          barRef.current,
          {
            opacity: 0,
            y: 16,
            filter: 'blur(6px)',
            clipPath: 'inset(0% 0% 100% 0%)',
            duration: 0.8,
            clearProps: 'filter,clipPath',
          },
          0.38,
        )
        .from(countLineRef.current, { opacity: 0, y: 8, duration: 0.45 }, 0.58)
    }, masthead)

    return () => ctx.revert()
  }, [])

  /* --- دکمه‌ی پنل مدیریت ---
         نقش را سرور می‌گوید، پس این دکمه دیرتر از بقیه‌ی سربرگ به دنیا
         می‌آید و توالیِ بالا دیگر تمام شده است. ورودِ خودش را جدا
         می‌گیرد، با همان وزن و فاصله‌ی بقیه‌ی ابزارها. --- */
  useEffect(() => {
    const link = adminRef.current
    if (!isAdmin || !link || !shouldAnimate()) return
    const tween = gsap.from(link, { opacity: 0, y: 10, duration: 0.55, ease: 'expo.out' })
    return () => {
      tween.kill()
      gsap.set(link, { clearProps: 'transform,opacity' })
    }
  }, [isAdmin])

  /* --- نوار ابزار وقتی می‌چسبد، خطِ مویی زیرش می‌نشیند --- */
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    let raf = 0
    function onScroll() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (bar) bar.dataset.stuck = String(bar.getBoundingClientRect().top <= 0)
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  /* --- ورودِ پلکانیِ ردیف‌ها ---
         ترنسفورمِ خودِ <li> دستِ Motion است تا سنجاق‌زدن ردیف را بینِ دو
         گروه پرواز بدهد؛ پس پرده‌برداری روی لایه‌ی داخلیِ .roster-reveal
         می‌نشیند و دو موتور به هم نمی‌خورند. یک ناظرِ ماندگار، مثل پنل
         مدیریت. تأخیرِ دسته‌ی اول پشتِ توالیِ سربرگ می‌ماند. --- */
  useEffect(() => {
    const roster = rosterRef.current
    if (!roster) return
    const revealer = createRevealer(roster, '.roster-reveal, .roster-status--end', {
      y: 12,
      duration: 0.55,
      each: 0.04,
      maxStagger: 0.34,
      firstBatchDelay: 0.6,
    })
    revealerRef.current = revealer
    revealer.scan()
    return () => {
      revealer.destroy()
      revealerRef.current = null
    }
  }, [])

  /* فقط ردیف‌های تازه. وابستگی طول است نه خودِ `results` — آن آرایه هر
     رندر از نو ساخته می‌شود. سنجاق که خورد طول عوض نمی‌شود، پس ردیفی که
     در گروهِ دیگر از نو ساخته شده پنهان نمی‌شود و هم‌زمان با پروازِ
     Motion یک‌بار دیگر پرده نمی‌زند. */
  useEffect(() => {
    revealerRef.current?.scan()
  }, [results?.length, query])

  /* --- شمارنده‌ی نتایج --- */
  useEffect(() => {
    const n = results?.length ?? -1
    if (n < 0 || !countRef.current || n === lastCount.current) return
    countTo(countRef.current, n)
    lastCount.current = n
  }, [results])

  /* --- حالت خالی --- */
  useEffect(() => {
    if (isEmpty && emptyRef.current) {
      gsap.from(emptyRef.current, { opacity: 0, y: 10, duration: 0.5, ease: 'expo.out' })
    }
  }, [isEmpty, query])

  /* --- پژواکِ عمق‌سنج ---
         هر ده ثانیه یک حلقه از کنارِ نشانِ برند بیرون می‌زند و خطوطِ ترازی
         را که از آن‌ها می‌گذرد روشن می‌کند. سرعتِ ثابت (ease none) چون
         پژواک شتاب نمی‌گیرد؛ صدا در آب سرعتِ خودش را دارد.
         این تنها حرکتِ «فعالِ» پس‌زمینه است — بقیه فقط می‌لغزند. */
  useEffect(() => {
    const chart = chartRef.current
    // اینجا shouldAnimate() نه: آن نگهبان برای حرکتِ یک‌باره است که اگر در
    // تبِ پنهان یخ بزند محتوا پنهان می‌ماند. این یک حلقه‌ی بی‌پایانِ
    // پس‌زمینه است — GSAP خودش در تبِ پنهان می‌ایستد و با برگشتِ کاربر
    // ادامه می‌دهد. با shouldAnimate() هرکس صفحه را در تبِ پس‌زمینه باز
    // می‌کرد، پژواک را دیگر هرگز نمی‌دید.
    if (!chart) return
    const lines = Array.from(chart.querySelectorAll<SVGPathElement>('.echo-line'))
    if (!lines.length) return

    const ctx = gsap.context(() => {
      lines.forEach((line, i) => {
        /* از هر حلقه فقط کمانِ پایینی توی کادرِ سربرگ است — کمتر از یک
           سومِ طول. پس یک قطعه‌ی تنها تقریباً همیشه بیرونِ قاب می‌ماند و
           حرکت دیده نمی‌شود. به‌جایش SEGMENTS قطعه‌ی هم‌فاصله دورِ حلقه
           می‌چینیم: همیشه چندتایی داخلِ کادر است.
           طولِ تکرار دقیقاً len/SEGMENTS است و آفست هم به همان اندازه
           می‌رود — پس حلقه بی‌درز بسته می‌شود و پرش ندارد. */
        const SEGMENTS = 5
        const len = line.getTotalLength()
        const period = len / SEGMENTS
        const dash = period * 0.36
        gsap.set(line, { strokeDasharray: `${dash} ${period - dash}`, strokeDashoffset: 0 })
        // ترازِ بیرونی‌تر کندتر می‌گردد — عمقِ بیشتر، پژواکِ دیرتر
        gsap.to(line, {
          strokeDashoffset: -period,
          duration: 7 + i * 2,
          ease: 'none',
          repeat: -1,
        })
      })
    }, chart)

    return () => ctx.revert()
  }, [])

  /* --- عمقِ حاشیه: پارالاکس ---
         سه لایه‌ی نقشه با سه ضریب جابه‌جا می‌شوند تا صفحه «کاغذ» نماند و
         لایه‌لایه شود. یک شنونده، یک rAF، دو متغیرِ CSS — بقیه‌ی کار در
         استایل‌شیت انجام می‌شود، پس اینجا هیچ layout ای خوانده نمی‌شود.
         روی لمس، پارالاکسِ اشاره‌گر معنا ندارد؛ فقط اسکرول می‌ماند. */
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const fine = window.matchMedia('(pointer: fine)').matches
    let raf = 0
    let px = 0
    let py = 0
    let sy = 0

    function flush() {
      raf = 0
      if (!chart) return
      chart.style.setProperty('--px', `${px.toFixed(2)}px`)
      chart.style.setProperty('--py', `${py.toFixed(2)}px`)
      chart.style.setProperty('--sy', `${sy.toFixed(2)}px`)
    }
    function schedule() {
      if (!raf) raf = requestAnimationFrame(flush)
    }
    function onMove(e: PointerEvent) {
      px = (e.clientX / window.innerWidth - 0.5) * 46
      py = (e.clientY / window.innerHeight - 0.5) * 26
      schedule()
    }
    function onScroll() {
      // سقف دارد: پایین‌ترِ حاشیه‌ی نقشه دیگر حرکتی لازم نیست
      sy = Math.min(window.scrollY, 420) * 0.34
      schedule()
    }

    if (fine) window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  /* --- راهنمای اسکرول ---
         نگهبانی ته فهرست می‌نشیند: تا وقتی دیده نشده یعنی عمق ادامه دارد و
         راهنما کفِ صفحه می‌ماند. حاشیه‌ی ۹۶ پیکسلی به‌اندازه‌ی قدِ خودِ راهنماست
         تا درست پیش از رسیدن به ته، کنار برود.
         روی فهرستِ کوتاه که صفحه اصلاً اسکرول ندارد هم راهنما نباید بیاید — پس
         کوتاهیِ صفحه را جدا می‌سنجیم و با تغییرِ داده‌ها دوباره حساب می‌کنیم. --- */
  useEffect(() => {
    const page = pageRef.current
    const roster = rosterRef.current
    if (!page || !roster) return

    let reachedEnd = false
    function sync() {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight > 24
      page?.classList.toggle('at-end', reachedEnd || !scrollable)
    }
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const io = new IntersectionObserver(
      ([entry]) => {
        reachedEnd = entry.isIntersecting
        setAtEnd(entry.isIntersecting)
        sync()
      },
      { rootMargin: '96px' },
    )
    io.observe(sentinel)

    const ro = new ResizeObserver(sync)
    ro.observe(document.documentElement)
    ro.observe(roster)
    window.addEventListener('resize', sync)
    window.addEventListener('load', sync)
    sync()

    return () => {
      io.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  /* --- خواندنِ ترازِ بعدی ---
         همان نگهبانِ ته فهرست ماشه را می‌کشد. چون وضعیت است نه متغیرِ محلی،
         اگر صفحه‌ی تازه هم کوتاه‌تر از کادرِ دید بود و نگهبان همچنان دیده
         می‌شد، خواندنِ بعدی خودش دنبال می‌شود. --- */
  useEffect(() => {
    if (atEnd && hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [atEnd, hasNextPage, isFetchingNextPage, fetchNextPage, rows.length])

  /* یک کادرِ دید پایین‌تر — کمی هم‌پوشانی می‌ماند تا رشته‌ی نگاه پاره نشود */
  function scrollDown() {
    window.scrollBy({
      top: window.innerHeight * 0.82,
      behavior: 'smooth',
    })
  }

  function search(text?: string) {
    const t = text ?? q
    setQ(t)
    setQuery(t)
  }

  function changeSearchText(text: string) {
    setQ(text)
    if (text.trim() === '') setQuery('')
  }

  function logout() {
    forgetSession()
    window.location.href = '/'
  }

  return (
    <div className="relative min-h-dvh bg-[rgb(var(--canvas))]">
      {/* حاشیه‌ی نقشه — همان خطوط ترازِ صفحه‌ی ورود، ایستا و بسیار محو */}
      <div ref={chartRef} className="chart-margin" aria-hidden="true">
        <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMax slice" className="h-full w-full">
          {/* لایه‌ی پایه — خطوط ایستا */}
          {CONTOURS.slice(4).map((d, i) => (
            <path key={i} d={d} className="sounding-line" />
          ))}

          {/* لایه‌ی پژواک — همان خطوط، روشن، اما هر کدام فقط یک قطعه‌ی
              کوتاه که دورِ ترازِ خودش می‌گردد */}
          <g className="chart-echo">
            {CONTOURS.slice(4).map((d, i) => (
              <path key={i} d={d} className="echo-line" />
            ))}
          </g>

          {/* نشانه‌های عمق — هرکدام روی ساعتِ خودش */}
          {SOUNDINGS.map(([cx, cy, r], i) => (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} className="chart-sounding" style={{ animationDelay: `${i * 0.9}s` }} />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                className="chart-sounding-ping"
                style={{ animationDelay: `${i * 0.9}s` }}
              />
            </g>
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

      <div ref={pageRef} className="page-bottom relative mx-auto w-full max-w-6xl px-5 sm:px-8">
        {/* سربرگ برند */}
        <div ref={mastheadRef} className="pt-7 sm:pt-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 sm:order-1">
              <BrandLockup ref={logoRef} variant="masthead" />
              <p ref={subRef} className="mt-2.5 text-[13.5px] text-ink-500">
                دفترچه تلفن سازمانی
              </p>
            </div>

            {/* روی موبایل این ردیف تمام‌عرض است: «پنل مدیریت» لبه‌ی آغاز
                می‌ماند و «خروج/تم» با ms-auto به لبه‌ی پایان می‌روند.
                روی دسکتاپ ردیف به‌اندازه‌ی محتواست، پس ms-auto اثری ندارد
                و همه مثل قبل کنار هم می‌نشینند. */}
            <div ref={actionsRef} className="flex shrink-0 items-center gap-1.5 sm:order-2">
              {isAdmin && (
                <Link ref={adminRef} to="/admin" className="masthead-action">
                  <ShieldCheck strokeWidth={1.8} className="h-[17px] w-[17px]" aria-hidden="true" />
                  <span>پنل مدیریت</span>
                </Link>
              )}
              {/* اینجا دیگر «ورود» لازم نیست: پشتِ گارد، همیشه کسی وارد
                  شده است. تنها راهِ بیرون رفتن می‌ماند. */}
              <div className="ms-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={logout}
                  className="masthead-action masthead-action--exit"
                >
                  <LogOut strokeWidth={1.8} className="h-[17px] w-[17px]" aria-hidden="true" />
                  <span>خروج</span>
                </button>
                <ThemeToggle />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ink-500">
            <span className="rounded-xl border border-sand-200 bg-paper px-3 py-2">
              محدودهٔ داده: <strong className="text-ink-900">{selectedOrg ? organizations?.find((org) => String(org.id) === selectedOrg)?.name : isGlobal ? 'همهٔ واحدها' : session?.organization_name || 'واحد شما'}</strong>
            </span>
            {isGlobal && (
              <select aria-label="انتخاب واحد سازمانی" value={selectedOrg} onChange={(event) => setSelectedOrg(event.target.value)}
                className="rounded-xl border border-sand-300 bg-paper px-3 py-2 text-sm text-ink-900">
                <option value="">همهٔ واحدها</option>
                {(organizations ?? []).filter((org) => org.is_active).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            )}
          </div>

          {/* مقیاسِ نقشه — مرزِ عنوان با ابزار، امضای مشترک با صفحه‌ی ورود */}
          <svg
            ref={ruleRef}
            viewBox="0 0 300 12"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="depth-rule mt-6 block h-3 w-full text-sea-600 dark:text-sea-400"
          >
            <line x1="0" y1="6" x2="300" y2="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
            {[0, 75, 150, 225, 300].map((x) => (
              <line
                key={x}
                x1={x}
                y1={x === 150 ? 1.5 : 3}
                x2={x}
                y2={x === 150 ? 10.5 : 9}
                stroke="currentColor"
                strokeOpacity={x === 150 ? 0.85 : 0.4}
                strokeWidth="1"
              />
            ))}
          </svg>
        </div>

        {/* ابزار جستجو — با اسکرول بالای صفحه می‌چسبد */}
        <div ref={barRef} className="search-bar">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              search()
            }}
            role="search"
          >
            {/* پیشنهادها پیش از Enter بالا می‌آیند؛ Enter بدون انتخاب
                همان جستجوی متنِ خام است، مثل قبل */}
            <EmployeeAutocomplete
              value={q}
              organizationId={selectedOrg}
              onValueChange={changeSearchText}
              onSearch={search}
              busy={isFetching && !isFetchingNextPage}
            />
          </form>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => search(query === s ? '' : s)}
                aria-pressed={query === s}
                className={`rounded-full px-4 py-2 text-[13px] transition-colors duration-200 ${
                  query === s
                    ? 'bg-sea-500 font-medium text-white dark:bg-sea-400 dark:text-deep-950'
                    : 'bg-tint text-tide ring-1 ring-sand-200 hover:bg-sand-100'
                }`}
              >
                {s}
              </button>
            ))}

            {!browsing && !SUGGESTIONS.includes(query) && (
              <button
                type="button"
                onClick={() => search('')}
                className="rounded-full px-3 py-1.5 text-[12px] text-ink-400 underline decoration-sand-300 underline-offset-4 transition-colors duration-200 hover:text-ink-700"
              >
                پاک کردن جستجو
              </button>
            )}
          </div>
        </div>

        {/* برچسبِ چارت — وقتی نتیجه‌ای نیست، حالتِ خالی خودش گویاست */}
        {!isEmpty && (
          <p
            ref={countLineRef}
            className="mt-7 mb-1.5 flex items-baseline gap-1.5 ps-8 text-[12px] text-ink-400"
          >
            <span ref={countRef} className="tnum font-bold text-tide">
              {faDigits(rows.length)}
            </span>
            <span>{browsing ? 'همکار در فهرست' : 'نتیجه برای جستجوی شما'}</span>
          </p>
        )}

        {/* فهرست همکاران */}
        <main ref={rosterRef} className="roster">
          <PinList items={rows} onToggle={(emp) => togglePin(emp.id)} />

          {isEmpty && (
            <div ref={emptyRef} className="py-16 text-center">
              {/* یک وصله‌ی خالی از نقشه: خطوط تراز هست، نشانه‌ای نیست */}
              <svg
                viewBox="0 0 96 56"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                aria-hidden="true"
                className="mx-auto mb-5 h-14 w-24 text-sea-600 dark:text-sea-400"
              >
                <path d="M4 42C18 30 30 40 44 30S72 12 92 20" strokeOpacity="0.45" />
                <path d="M4 30C20 18 32 28 46 18S74 2 92 9" strokeOpacity="0.28" />
                <path d="M4 52C16 43 30 51 44 42S70 26 92 33" strokeOpacity="0.28" />
              </svg>
              <p className="font-bold text-ink-700">در این عمق چیزی ثبت نشده.</p>
              <p className="mx-auto mt-2 max-w-[40ch] text-[13.5px] leading-7 text-ink-500">
                با بخشی از نام خانوادگی، نام واحد، یا واژه‌ای از شرح کار جستجو کنید.
              </p>
              <button
                type="button"
                onClick={() => search('')}
                className="mt-5 rounded-xl bg-deep-900 px-4 py-2.5 text-[13px] font-bold text-white transition-[background-color,transform] duration-200 hover:bg-deep-800 active:scale-[.98] dark:bg-sea-500 dark:text-deep-950 dark:hover:bg-sea-400"
              >
                نمایش همه‌ی همکاران
              </button>
            </div>
          )}

          {/* ترازِ در حالِ خواندن — پژواکی که هنوز برنگشته */}
          {isFetchingNextPage && (
            <p className="roster-status" role="status">
              <svg viewBox="0 0 120 8" aria-hidden="true" className="roster-status-line">
                <path d="M0 4C15 1 25 7 40 4S65 1 80 4s25 3 40 0" />
              </svg>
              <span>در حال خواندنِ ادامه</span>
            </p>
          )}

          {/* کفِ نقشه */}
          {!hasNextPage && !isFetching && rows.length > 0 && (
            <p className="roster-status roster-status--end">
              {browsing ? 'پایان فهرست' : 'پایان نتایج'}
            </p>
          )}

          <div ref={sentinelRef} aria-hidden="true" />
        </main>

        {/* راهنمای اسکرول — کفِ کادرِ دید می‌ماند تا ته فهرست بیاید */}
        <div className="scroll-cue" aria-hidden="true">
          <button
            type="button"
            tabIndex={-1}
            onClick={scrollDown}
            className="scroll-cue-button"
          >
            <ChevronDown strokeWidth={2} className="scroll-cue-chevron h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  )
}
