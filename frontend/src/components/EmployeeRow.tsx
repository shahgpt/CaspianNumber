import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import gsap from 'gsap'
import { motion } from 'motion/react'
import type { Transition } from 'motion/react'
import { Phone, Pin, X } from 'lucide-react'
import type { Employee } from '../lib/api'
import { toEnDigits } from '../lib/api'
import { faDigits } from '../lib/motion'

/* قرارداد Impeccable — دنیای «نقشه‌ی عمق‌سنجی»
   هر همکار یک «نشانه‌ی عمق» روی محورِ کنارِ لیست است، نه یک کارت.
   ردیف چگال است: نام، سمت، و خودِ عدد — چون در دفترچه تلفن، عدد همان محصول است.
   عددِ ردیف داخلی است؛ شیتِ تماس شماره‌ی مستقیم را هم می‌دهد، چون
   داخلی را از بیرونِ سازمان نمی‌شود گرفت.
   پین همان «سنجاقِ نقشه» است: نشانه‌ای که خودِ کاربر روی چارت می‌کوبد. */

interface Props {
  emp: Employee
  pinned?: boolean
  onTogglePin?: () => void
  /** فنرِ جابه‌جایی بینِ گروه‌ها — از PinList می‌آید */
  layoutTransition?: Transition
}

export default function EmployeeRow({ emp, pinned = false, onTogglePin, layoutTransition }: Props) {
  const [open, setOpen] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLAnchorElement | null>>([])

  /* نمایش با رقم فارسی — هم‌زبانِ بقیه‌ی صفحه؛ لینکِ tel: با رقم لاتین */
  const extension = emp.extension?.trim() || ''
  const direct = emp.direct?.trim() || ''
  const hasNumber = Boolean(extension || direct)

  const unit = emp.department || emp.company || ''
  /* روی صفحه‌های باریک، سمت و واحد یک سطرند؛ روی صفحه‌ی پهن، واحد
     ستونِ خودش را می‌گیرد تا عرضِ خالیِ وسطِ ردیف با داده پر شود. */
  const meta = [emp.job_title, unit].filter(Boolean).join(' · ')

  /* شیتِ تماس: پرده می‌نشیند، پنل از دلِ نقشه بالا می‌آید،
     گزینه‌ها پلکانی مثل فیلدهای فرم ورود پرده برمی‌دارند */
  useEffect(() => {
    if (!open || !dialogRef.current || !panelRef.current) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    optionRefs.current[0]?.focus({ preventScroll: true })

    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .fromTo(dialogRef.current, { opacity: 0 }, { opacity: 1, duration: 0.32 }, 0)
        .fromTo(
          panelRef.current,
          { opacity: 0, y: 30, scale: 0.95, filter: 'blur(6px)' },
          { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.6, clearProps: 'filter' },
          0.04,
        )
        .fromTo(
          optionRefs.current.filter(Boolean),
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.45, stagger: 0.07 },
          0.2,
        )
    }, dialogRef)

    return () => {
      ctx.revert()
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  function close() {
    const panel = panelRef.current
    const dlg = dialogRef.current
    if (!panel || !dlg) {
      setOpen(false)
      return
    }
    gsap
      .timeline({ onComplete: () => setOpen(false) })
      .to(optionRefs.current.filter(Boolean), {
        opacity: 0,
        y: 8,
        duration: 0.16,
        stagger: 0.03,
        ease: 'power2.in',
      })
      .to(panel, { opacity: 0, y: 16, scale: 0.97, duration: 0.24, ease: 'power2.in' }, '<0.06')
      .to(dlg, { opacity: 0, duration: 0.2, ease: 'power1.in' }, '-=0.1')
  }

  return (
    <>
      <motion.li
        data-row
        layout
        layoutId={`emp-${emp.id}`}
        transition={layoutTransition}
        className="roster-item"
      >
        <div className="roster-reveal">
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!hasNumber}
            aria-haspopup="dialog"
            aria-label={`شماره‌های ${emp.full_name}`}
            className="roster-row group"
          >
            <span className="min-w-0 flex-1 text-start md:w-[22rem] md:flex-none lg:w-[26rem]">
              <span className="block truncate text-[16px] font-bold leading-tight text-ink-900">
                {emp.full_name}
              </span>
              {meta && (
                <span className="mt-1 block truncate text-[13px] leading-tight text-ink-500 md:hidden">
                  {meta}
                </span>
              )}
              {emp.job_title && (
                <span className="mt-1 hidden truncate text-[13px] leading-tight text-ink-500 md:block">
                  {emp.job_title}
                </span>
              )}
            </span>

            {/* ستونِ واحد — فقط روی صفحه‌ی پهن؛ فضای اضافه را همین ستون می‌گیرد
                تا وسطِ ردیف خالی نماند و عددها لبه‌ی چارت بمانند */}
            <span className="hidden min-w-0 flex-1 truncate text-[13.5px] text-ink-500 md:block">
              {unit || <span className="text-ink-300">—</span>}
            </span>

            {/* ستونِ عدد — لبه‌ی پایانیِ چارت، اعداد روی یک خط تراز.
                آیکون جای ثابت دارد ولی فقط در هاور/فوکوس دیده می‌شود تا
                تکرارِ یک گلیف در سی ردیف، فهرست را شلوغ نکند. */}
            <span className="flex shrink-0 items-center gap-2">
              <Phone
                strokeWidth={1.8}
                aria-hidden="true"
                className="h-4 w-4 text-sea-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:opacity-0 dark:text-sea-400"
              />
              <span className="w-[76px] text-end">
                {extension ? (
                  <span dir="ltr" className="tnum text-[17px] font-bold leading-none text-tide">
                    {faDigits(extension)}
                  </span>
                ) : direct ? (
                  <span className="text-[12.5px] leading-none text-ink-400">مستقیم</span>
                ) : (
                  <span aria-hidden="true" className="text-[13px] leading-none text-ink-300">
                    —
                  </span>
                )}
              </span>
            </span>

          </button>

          {/* سنجاق — بیرونِ دکمه‌ی ردیف می‌ماند چون دکمه در دکمه معتبر نیست.
              پین‌شده همیشه پیداست؛ پین‌نشده فقط زیرِ نشانگر یا فوکوس، تا
              تکرارِ یک گلیف در سی ردیف فهرست را شلوغ نکند. */}
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              aria-pressed={pinned}
              aria-label={pinned ? `برداشتن سنجاق ${emp.full_name}` : `سنجاق کردن ${emp.full_name}`}
              className="roster-pin"
              data-pinned={pinned || undefined}
            >
              <Pin
                strokeWidth={1.8}
                aria-hidden="true"
                className="h-4 w-4"
                fill={pinned ? 'currentColor' : 'none'}
              />
            </button>
          )}
        </div>
      </motion.li>

      {/* شیت روی body سوار می‌شود، نه داخلِ <ul> فهرست: آن ul درونِ یک
          div با z-index است، پس هر z-50‌ای اینجا در همان لایه حبس می‌شد و
          نوارِ چسبانِ جستجو و راهنمای اسکرول رویش می‌افتادند. */}
      {open &&
        createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`تماس با ${emp.full_name}`}
            onClick={(e) => {
              if (e.target === e.currentTarget) close()
            }}
            className="fixed inset-0 z-50 grid place-items-center bg-deep-950/45 px-5 backdrop-blur-sm"
          >
            <div
              ref={panelRef}
              className="relative w-full max-w-sm rounded-2xl border border-sand-200 bg-paper p-6 shadow-panel"
            >
              <button
                type="button"
                onClick={close}
                aria-label="بستن"
                className="absolute end-4 top-4 grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-colors duration-200 hover:bg-sand-100 hover:text-ink-700"
              >
                <X strokeWidth={1.9} className="h-4 w-4" />
              </button>

              <h2 className="pe-10 text-lg font-bold leading-snug text-ink-900">{emp.full_name}</h2>
              {meta && <p className="mt-1 text-sm text-ink-500">{meta}</p>}

              {/* مستقیم اول می‌آید: از گوشی همین یکی گرفتنی است.
                  داخلی زیرِ آن می‌ماند برای وقتی که کاربر پشتِ تلفنِ سازمان است. */}
              <div className="mt-5 space-y-2.5">
                {direct && (
                  <a
                    ref={(el) => {
                      optionRefs.current[0] = el
                    }}
                    href={`tel:${toEnDigits(direct)}`}
                    onClick={() => close()}
                    className="flex items-center justify-between gap-3 rounded-xl border border-sand-200 bg-sand-50 px-4 py-3.5 transition-[border-color,box-shadow,background-color] duration-200 hover:border-sea-400 hover:bg-paper hover:ring-4 hover:ring-sea-500/15"
                  >
                    <span className="flex items-center gap-2.5">
                      <Phone strokeWidth={1.8} className="h-[18px] w-[18px] text-sea-600 dark:text-sea-400" />
                      <span>
                        <span className="block text-sm font-bold text-ink-900">شماره مستقیم</span>
                        <span className="block text-xs text-ink-500">تماس از بیرون سازمان</span>
                      </span>
                    </span>
                    <span dir="ltr" className="tnum font-bold text-sea-700 dark:text-sea-300">
                      {faDigits(direct)}
                    </span>
                  </a>
                )}

                {extension && (
                  <a
                    ref={(el) => {
                      optionRefs.current[1] = el
                    }}
                    href={`tel:${toEnDigits(extension)}`}
                    onClick={() => close()}
                    className="flex items-center justify-between gap-3 rounded-xl border border-sand-200 bg-sand-50 px-4 py-3.5 transition-[border-color,box-shadow,background-color] duration-200 hover:border-sea-400 hover:bg-paper hover:ring-4 hover:ring-sea-500/15"
                  >
                    <span className="flex items-center gap-2.5">
                      <Phone strokeWidth={1.8} className="h-[18px] w-[18px] text-sea-600 dark:text-sea-400" />
                      <span>
                        <span className="block text-sm font-bold text-ink-900">داخلی</span>
                        <span className="block text-xs text-ink-500">از تلفن سازمانی</span>
                      </span>
                    </span>
                    <span dir="ltr" className="tnum font-bold text-sea-700 dark:text-sea-300">
                      {faDigits(extension)}
                    </span>
                  </a>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
