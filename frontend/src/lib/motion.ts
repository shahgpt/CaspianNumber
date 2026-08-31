import gsap from 'gsap'

/**
 * آیا اصلاً باید انیمیشن اجرا شود؟
 *
 * در تبِ پنهان، requestAnimationFrame اجرا نمی‌شود و GSAP یخ می‌زند — یعنی
 * هرچه با `.from()` پنهان شده، پنهان می‌ماند تا کاربر به تب برگردد. کسی هم
 * که تب را در پس‌زمینه باز می‌کند، انیمیشن را نمی‌بیند. پس صفحه را همان‌جا
 * کامل نشان می‌دهیم؛ محتوا هرگز نباید گروگانِ موشن باشد.
 */
export function shouldAnimate(): boolean {
  return typeof document === 'undefined' || !document.hidden
}

/**
 * شمارنده‌ی عدد نتایج — از صفر تا تعداد یافته‌ها.
 * تبِ پنهان → همان عدد نهایی بلافاصله.
 */
export function countTo(el: HTMLElement, value: number, duration = 0.7) {
  if (!shouldAnimate() || !Number.isFinite(value)) {
    el.textContent = faDigits(value)
    return
  }
  const obj = { n: 0 }
  el.textContent = faDigits(0)
  gsap.to(obj, {
    n: value,
    duration,
    ease: 'power2.out',
    onUpdate: () => {
      el.textContent = faDigits(Math.round(obj.n))
    },
  })
}

/** تبدیل رقم لاتین به فارسی برای نمایش */
export function faDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

export interface Revealer {
  /** ردیف‌های تازه را پیدا کن، پنهانشان کن و به کادر دید بسپار */
  scan: () => void
  /** خاموش شدن: هرچه هنوز پنهان است پیدا می‌شود */
  destroy: () => void
}

/**
 * ورودِ یک‌باره‌ی ردیف‌ها هنگام رسیدن به کادر دید.
 *
 * یک ناظرِ ماندگار برای کل عمر صفحه ساخته می‌شود و با هر تغییرِ داده فقط
 * `scan()` صدا زده می‌شود — نه یک ناظرِ تازه. این تنها راهِ پایدارِ کار است:
 * چند ناظرِ هم‌زمان روی یک فهرست، ردیف‌ها را از ترتیب خارج می‌کند.
 *
 * ردیف‌هایی که در یک فراخوانِ observer با هم می‌رسند پلکانی می‌آیند؛
 * کلِ تأخیر سقف دارد. `firstBatchDelay` فقط به اولین دسته اعمال می‌شود
 * تا صفحه از بالا به پایین بارگذاری شود.
 */
export function createRevealer(
  root: HTMLElement,
  selector: string,
  opts: {
    y?: number
    duration?: number
    each?: number
    maxStagger?: number
    firstBatchDelay?: number
  } = {},
): Revealer {
  const { y = 14, duration = 0.62, each = 0.05, maxStagger = 0.38, firstBatchDelay = 0 } = opts
  const done = 'cnRevealed'
  const instant = !shouldAnimate() || typeof IntersectionObserver === 'undefined'

  // IntersectionObserver ردیف‌های یک صفحه را در چند فراخوانِ پشت‌سرهم تحویل
  // می‌دهد، نه یک‌جا. پس «تأخیرِ دسته‌ی اول» با شمارنده جواب نمی‌دهد؛ یک
  // «دروازه‌ی زمانی» می‌گذاریم: هر ردیفی که پیش از این لحظه برسد، از همان
  // لحظه و پشت سر هم وارد می‌شود.
  const gateUntil = performance.now() + firstBatchDelay * 1000
  let gatedCount = 0
  const hidden = new Set<HTMLElement>()

  /** GSAP روی آرایه‌ی خالی هشدار می‌دهد — بی‌صدا رد شو */
  function tween(targets: HTMLElement[], vars: gsap.TweenVars) {
    if (targets.length) gsap.to(targets, vars)
  }

  const io = instant
    ? null
    : new IntersectionObserver(
        (entries) => {
          const arrived = entries
            .filter((e) => e.isIntersecting)
            .map((e) => e.target as HTMLElement)
            .filter((el) => hidden.has(el))
          if (!arrived.length) return

          arrived.forEach((el) => {
            el.dataset[done] = '1'
            hidden.delete(el)
            io?.unobserve(el)
          })

          const stagger = { each, amount: Math.min(each * arrived.length, maxStagger) }
          const wait = Math.max(0, (gateUntil - performance.now()) / 1000)
          // پشتِ دروازه، هر فراخوان بعد از قبلی می‌آید تا آبشار از بالا به
          // پایین بشکند، نه اینکه همه با هم بپرند
          const offset = wait > 0 ? Math.min(gatedCount * each, maxStagger) : 0
          if (wait > 0) gatedCount += arrived.length
          const delay = wait + offset

          tween(arrived, {
            opacity: 1,
            y: 0,
            duration,
            delay,
            ease: 'expo.out',
            stagger,
            clearProps: 'transform,opacity',
          })
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.01 },
      )

  function scan() {
    const fresh = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => !(done in el.dataset) && !hidden.has(el),
    )
    if (!fresh.length) return

    if (!io) {
      // بدون ناظر: محتوا از همان اول پیداست، فقط علامت می‌خورد
      fresh.forEach((el) => {
        el.dataset[done] = '1'
      })
      return
    }

    gsap.set(fresh, { opacity: 0, y })
    fresh.forEach((el) => {
      hidden.add(el)
      io.observe(el)
    })
  }

  function destroy() {
    io?.disconnect()
    const stuck = Array.from(hidden)
    hidden.clear()
    if (!stuck.length) return
    // هیچ ردیفی نباید نامرئی جا بماند
    gsap.killTweensOf(stuck)
    gsap.set(stuck, { clearProps: 'transform,opacity' })
  }

  return { scan, destroy }
}
