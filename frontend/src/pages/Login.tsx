import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { AlertCircle, ArrowLeft, Eye, EyeOff, KeyRound, ShieldCheck, User } from 'lucide-react'
import { api, setToken } from '../lib/api'
import { rememberSession } from '../lib/auth'
import { prefersReducedMotion, shouldAnimate } from '../lib/motion'
import { TextAnimate } from '@/registry/magicui/text-animate'
import BrandLockup from '../components/BrandLockup'
import ThemeToggle from '../components/ThemeToggle'
import { CONTOURS, SOUNDINGS } from './login-contours'

/* قرارداد Impeccable — دنیای «نقشه‌ی عمق‌سنجی»
   THESIS: کاسپین به‌شکل داده کشیده می‌شود؛ خطوط تراز عمق روی کاغذ سفید.
           دفترچه‌ی تلفن هم همین است — آدم‌ها به‌شکل داده.
   OWN-WORLD: کاغذ سفید مطلق، مرکبِ سبزآبیِ تیره، یک اکسنت #26B3A2.
   FIRST VIEWPORT: نشانِ برند از عمق بالا می‌آید و نام حرف‌به‌حرف کنارش
           نوشته می‌شود؛ بعد نقشه خودش را زیرِ آن می‌کشد و فرم بالا می‌آید.
   MOTION: یک لحظه‌ی امضایی در دو پرده (اسپلش ← صفحه) + بازخوردهای کوتاه. */

/* مرزِ دو پرده: تا اینجا فقط نشان و نام روی صفحه‌اند. کلیک یا هر کلید،
   پرش به همین‌جاست — اسپلش هرگز نباید سدِ راهِ ورود شود. */
const ACT_TWO = 1.15

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const sceneRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const ruleRef = useRef<SVGSVGElement>(null)
  const subRef = useRef<HTMLParagraphElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const footerRef = useRef<HTMLParagraphElement>(null)
  const toggleRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const sweepRef = useRef<HTMLSpanElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)

  /* --- لحظه‌ی امضایی: صحنه خودش را می‌کشد ---
     useLayoutEffect است نه useEffect: حالتِ آغازینِ `from` باید پیش از
     اولین رنگ‌آمیزی بنشیند، وگرنه یک فریم صفحه‌ی کامل دیده می‌شود و
     اسپلش از وسط شروع می‌شود. */
  useLayoutEffect(() => {
    const scene = sceneRef.current
    const column = columnRef.current
    const brand = brandRef.current
    if (!scene || !column || !brand) return

    const lines = scene.querySelectorAll<SVGPathElement>('.sounding-line')
    const dots = scene.querySelectorAll<SVGCircleElement>('.sounding-dot')
    const fields = column.querySelectorAll<HTMLElement>('[data-reveal]')

    if (!shouldAnimate()) {
      gsap.set(dots, { opacity: 0.5 })
      return
    }

    const mark = brand.querySelector<HTMLElement>('[data-brand="mark"]')
    const tagline = brand.querySelector<HTMLElement>('[data-brand="tagline"]')

    // بلوکِ برند در پرده‌ی اول وسطِ کادر می‌ایستد: نیمِ فضایی که فرمِ
    // هنوز نیامده اشغال می‌کند. سقف دارد تا در نماهای کوتاه از کادر نزند.
    const settle = Math.min(
      (column.getBoundingClientRect().bottom - brand.getBoundingClientRect().bottom) / 2,
      130,
    )

    let tl: gsap.core.Timeline | null = null
    const skip = () => {
      if (tl && tl.time() < ACT_TWO) tl.seek(ACT_TWO)
    }

    const ctx = gsap.context(() => {
      // هر تراز طول خودش را دارد؛ dash را از روی همان می‌سازیم تا یکنواخت بکشد
      lines.forEach((line) => {
        const len = line.getTotalLength()
        gsap.set(line, { strokeDasharray: len, strokeDashoffset: len })
      })

      tl = gsap.timeline({ defaults: { ease: 'expo.out' } })

      /* پرده‌ی اول — نشان از عمق بالا می‌آید: از لبه‌ی پایین به بالا
         بریده می‌شود، همان‌طور که یک عمق‌سنجی از کف برمی‌گردد. بعد امضای
         برند از سمتِ نشان می‌لغزد و نام (TextAnimate) حرف‌به‌حرف می‌آید. */
      tl.from(
        mark,
        {
          clipPath: 'inset(100% 0% 0% 0%)',
          y: 14,
          scale: 1.06,
          duration: 0.9,
          transformOrigin: '50% 100%',
          clearProps: 'clipPath,transform',
        },
        0,
      )
        .from(tagline, { opacity: 0, x: -14, duration: 0.7 }, 0.3)
        .from(subRef.current, { opacity: 0, y: 8, duration: 0.6 }, 0.72)

        /* پرده‌ی دوم — صفحه دورِ همان بلوک ساخته می‌شود و بلوک سرِ جای
           خودش می‌نشیند. `from` با immediateRender یعنی هرچه اینجاست از
           همان فریمِ اول پنهان بوده، پس پرده‌ی اول تنها می‌ماند. */
        .from(brand, { y: settle, duration: 0.95 }, ACT_TWO)
        .to(
          lines,
          { strokeDashoffset: 0, duration: 1.9, stagger: { each: 0.09, from: 'start' } },
          ACT_TWO,
        )
        .fromTo(
          dots,
          { opacity: 0, scale: 0 },
          { opacity: 0.5, scale: 1, duration: 0.5, stagger: 0.05, transformOrigin: '50% 50%' },
          ACT_TWO + 0.7,
        )
        .from(toggleRef.current, { opacity: 0, y: -10, duration: 0.6 }, ACT_TWO + 0.08)
        .from(ruleRef.current, { scaleX: 0, duration: 1.1 }, ACT_TWO + 0.18)
        .from(
          fields,
          {
            opacity: 0,
            y: 22,
            filter: 'blur(7px)',
            clipPath: 'inset(0% 0% 100% 0%)',
            duration: 0.85,
            stagger: 0.09,
            clearProps: 'filter,clipPath',
          },
          ACT_TWO + 0.3,
        )
        .from(footerRef.current, { opacity: 0, duration: 0.9 }, ACT_TWO + 0.72)

      // حلقه‌ی بی‌پایان: نقشه بسیار آهسته «نفس می‌کشد»
      gsap.to(scene.querySelector('.sounding-field'), {
        scale: 1.035,
        duration: 22,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        transformOrigin: '50% 48%',
      })
    }, scene)

    window.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', skip)

    return () => {
      window.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', skip)
      ctx.revert()
    }
  }, [])

  /* --- خطا: کارت تکان می‌خورد و پیام می‌نشیند --- */
  useEffect(() => {
    if (!error || prefersReducedMotion()) return
    gsap.fromTo(
      formRef.current,
      { x: -9 },
      { x: 0, duration: 0.55, ease: 'elastic.out(1.5, 0.3)' },
    )
    gsap.from(errorRef.current, { opacity: 0, y: -8, duration: 0.35, ease: 'power2.out' })
  }, [error])

  /* --- بارگذاری: یک موج سبزآبی از راست روی دکمه می‌رود --- */
  useEffect(() => {
    const sweep = sweepRef.current
    if (!sweep) return
    if (!loading || prefersReducedMotion()) {
      gsap.killTweensOf(sweep)
      gsap.set(sweep, { xPercent: 0, opacity: 0 })
      return
    }
    gsap.set(sweep, { opacity: 1 })
    const tween = gsap.fromTo(
      sweep,
      { xPercent: -110 },
      { xPercent: 330, duration: 1.15, ease: 'sine.inOut', repeat: -1 },
    )
    return () => {
      tween.kill()
    }
  }, [loading])

  function trackCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.('CapsLock') ?? false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api<{ access_token: string; username: string }>('/api/auth/login', {
        method: 'POST',
        redirectOn401: false,
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      })
      setToken(res.access_token)
      rememberSession(res.username)
      /* مقصد همان جایی است که گارد او را از آن پرت کرده؛ اگر مستقیم آمده،
         دفترچه. پنل مقصدِ پیش‌فرض نیست — بیشترِ کاربرها ادمین نیستند. */
      const from = (location.state as { from?: string } | null)?.from
      navigate(from ?? '/', { replace: true })
    } catch (err) {
      // خطای شبکه پیام لاتینِ مرورگر می‌دهد؛ آن را به زبان محصول ترجمه می‌کنیم
      const offline = err instanceof TypeError
      setError(
        offline
          ? 'ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید و دوباره تلاش کنید.'
          : err instanceof Error && err.message
            ? err.message
            : 'ورود ناموفق بود. دوباره تلاش کنید.',
      )
      setLoading(false)
    }
  }

  const canSubmit = username.trim().length > 0 && password.length > 0 && !loading

  const fieldBase =
    'peer w-full h-12 rounded-xl border border-sand-200 bg-sand-50 ps-4 pe-11 text-right text-[15px] text-ink-900 transition-[background-color,border-color,box-shadow] duration-200 focus:outline-none focus:border-sea-500 focus:bg-paper focus:ring-4 focus:ring-sea-500/20'

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[rgb(var(--canvas))]">
      {/* صحنه‌ی عمق‌سنجی */}
      <div ref={sceneRef} className="sounding" aria-hidden="true">
        <svg
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full"
        >
          <g className="sounding-fit">
            <g className="sounding-field">
              {CONTOURS.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  className={`sounding-line ${i === 3 || i === 7 ? 'sounding-line--key' : ''}`}
                />
              ))}
              {SOUNDINGS.map(([cx, cy, r], i) => (
                <circle key={i} cx={cx} cy={cy} r={r} className="sounding-dot" />
              ))}
            </g>
          </g>
        </svg>
        <div className="sounding-veil" />
      </div>

      <div ref={toggleRef} className="absolute top-5 end-5 z-20 sm:top-7 sm:end-7">
        <ThemeToggle />
      </div>

      <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-5 py-14">
        <div ref={columnRef} className="w-full max-w-[380px]">
          {/* بلوکِ برند — همان چیزی که در پرده‌ی اول تنها روی صفحه است و
              در پرده‌ی دوم سرِ جای خودش می‌نشیند. امضای رسمی کنار نشان
              می‌ماند؛ نام محصول پایین‌تر لحظه‌ی حرف‌به‌حرف خودش را دارد. */}
          <div ref={brandRef}>
            <BrandLockup
              variant="hero"
              title={null}
              eager
              className="mb-6 justify-center"
            />

            <TextAnimate
              as="h1"
              animation="slideLeft"
              by="character"
              dir="ltr"
              startOnView={false}
              delay={0.34}
              duration={0.7}
              className="text-center text-[clamp(2.1rem,9vw,2.9rem)] font-bold leading-[1.05] tracking-[-0.045em] text-ink-900"
            >
              Caspian Number
            </TextAnimate>

            <p ref={subRef} className="mt-3.5 text-center text-[13px] text-ink-500">
              دفترچه تلفن سازمانی
            </p>
          </div>

          {/* مقیاسِ نقشه — مرزِ بلوکِ عنوان با فرم؛ امضای گرافیکی صفحه */}
          <svg
            ref={ruleRef}
            viewBox="0 0 300 12"
            aria-hidden="true"
            className="depth-rule mx-auto mt-8 block h-3 w-full max-w-[300px] text-sea-600 dark:text-sea-400"
          >
            <line
              x1="8"
              y1="6"
              x2="292"
              y2="6"
              stroke="currentColor"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
            {[8, 79, 150, 221, 292].map((x) => (
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

          <form ref={formRef} onSubmit={submit} noValidate className="mt-8 space-y-4">
            <div data-reveal>
              <label
                htmlFor="username"
                className="mb-2 block text-[13px] font-medium text-ink-700"
              >
                نام کاربری
              </label>
              <div className="relative">
                <input
                  id="username"
                  name="username"
                  type="text"
                  dir="ltr"
                  autoComplete="username"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                  className={fieldBase}
                />
                <User
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="pointer-events-none absolute start-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-400 transition-colors duration-200 peer-focus:text-sea-600"
                />
              </div>
            </div>

            <div data-reveal>
              <label
                htmlFor="password"
                className="mb-2 block text-[13px] font-medium text-ink-700"
              >
                رمز عبور
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={trackCaps}
                  onKeyDown={trackCaps}
                  onBlur={() => setCapsLock(false)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={
                    [error ? 'login-error' : null, capsLock ? 'caps-hint' : null]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  className={`${fieldBase} ps-12`}
                />
                <KeyRound
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="pointer-events-none absolute start-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-400 transition-colors duration-200 peer-focus:text-sea-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                  aria-pressed={showPassword}
                  className="absolute end-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-ink-400 transition-colors duration-200 hover:bg-sand-100 hover:text-ink-700"
                >
                  {showPassword ? (
                    <EyeOff strokeWidth={1.8} className="h-[18px] w-[18px]" />
                  ) : (
                    <Eye strokeWidth={1.8} className="h-[18px] w-[18px]" />
                  )}
                </button>
              </div>
              {capsLock && (
                <p
                  id="caps-hint"
                  className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-500"
                >
                  <AlertCircle strokeWidth={1.8} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  کلید Caps Lock روشن است
                </p>
              )}
            </div>

            {error && (
              <div
                ref={errorRef}
                id="login-error"
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-300/70 bg-red-500/[0.07] px-3.5 py-3 text-[13px] leading-6 text-red-700 dark:border-red-400/30 dark:text-red-300"
              >
                <AlertCircle
                  strokeWidth={1.9}
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
            )}

            <div data-reveal className="pt-1">
              <button
                type="submit"
                disabled={!canSubmit}
                className="group relative h-12 w-full overflow-hidden rounded-xl bg-deep-900 text-[15px] font-bold text-white transition-[background-color,transform] duration-200 hover:bg-deep-800 active:scale-[.985] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-deep-900 dark:bg-sea-500 dark:text-deep-950 dark:hover:bg-sea-400 dark:disabled:hover:bg-sea-500"
              >
                <span
                  ref={sweepRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 h-full w-[45%] opacity-0 bg-gradient-to-r from-transparent via-sea-400/50 to-transparent dark:via-white/35"
                />
                <span
                  className={`relative inline-flex items-center gap-2 ${loading ? 'opacity-0' : ''}`}
                >
                  ورود
                  <ArrowLeft
                    strokeWidth={2.2}
                    aria-hidden="true"
                    className="h-[18px] w-[18px] transition-transform duration-300 ease-out-expo group-hover:-translate-x-1"
                  />
                </span>
                {loading && (
                  <span className="absolute inset-0 grid place-items-center">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      className="search-spinner h-5 w-5"
                      aria-hidden="true"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="2.6"
                      />
                      <path
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="sr-only">در حال ورود…</span>
                  </span>
                )}
              </button>
            </div>
          </form>

          <p
            ref={footerRef}
            className="mt-9 flex items-center justify-center gap-1.5 text-center text-[12px] text-ink-400"
          >
            <ShieldCheck strokeWidth={1.8} className="h-4 w-4 shrink-0" aria-hidden="true" />
            حساب شما توسط مدیر سیستم ایجاد می‌شود
          </p>
        </div>
      </main>
    </div>
  )
}
