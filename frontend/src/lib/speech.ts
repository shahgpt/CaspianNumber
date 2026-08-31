/**
 * گفتار به نوشتار — فارسی، هم‌زمان.
 *
 * موتور، Web Speech API خودِ مرورگر است (Chrome/Edge/Safari). چیزی روی
 * سرور ما نمی‌رود و کلیدی لازم نیست. قرارداد این ماژول یک چیز است:
 * تا وقتی کاربر حرف می‌زند، متنِ «موقت» هم دیده می‌شود — نه اینکه
 * صفحه ساکت بماند و آخرِ کار یک‌جا متن بیفتد.
 *
 * تایپ‌ها را خودمان اعلام می‌کنیم؛ lib.dom هنوز SpeechRecognition ندارد.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechAlternative {
  transcript: string
}
interface SpeechResult {
  readonly length: number
  isFinal: boolean
  [index: number]: SpeechAlternative
}
interface SpeechResultList {
  readonly length: number
  [index: number]: SpeechResult
}
interface SpeechResultEvent extends Event {
  resultIndex: number
  results: SpeechResultList
}
interface SpeechErrorEvent extends Event {
  error: string
}
interface SpeechRecognizer extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: ((e: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
type SpeechRecognizerCtor = new () => SpeechRecognizer

/**
 * مهلتِ نگهبان. باید از حوصله‌ی یک آدم پشت پنجره‌ی «اجازه می‌دهید؟»
 * بیشتر باشد، وگرنه دقیقاً وقتی کاربر دارد اجازه می‌دهد شکست اعلام
 * می‌کنیم. سکوتِ واقعیِ مرورگر هم جایی نمی‌رود؛ فقط دیرتر گزارش می‌شود.
 */
const WATCHDOG_MS = 12_000

/** سافاریِ واقعی (نه کروم/اج که خودشان را سافاری هم می‌نامند) */
function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua)
}

/** پیامِ فارسیِ هر خطا — کدِ خام برای کاربر معنایی ندارد */
const MESSAGES: Record<string, string> = {
  'not-allowed': 'اجازه‌ی میکروفون داده نشد — از نوار آدرس مرورگر اجازه بدهید',
  'service-not-allowed': 'مرورگر سرویس گفتار را اجازه نداد',
  network: 'سرویس تبدیل گفتار در دسترس نیست (مشکل شبکه)',
  'audio-capture': 'میکروفونی پیدا نشد',
  'no-speech': 'چیزی شنیده نشد',
  'language-not-supported': 'مرورگر فارسی را پشتیبانی نمی‌کند',
}

function engine(): SpeechRecognizerCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognizerCtor
    webkitSpeechRecognition?: SpeechRecognizerCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** آیا این مرورگر اصلاً گوش می‌دهد؟ (فایرفاکس فعلاً نه) */
export const speechSupported = engine() !== null

export interface Speech {
  supported: boolean
  listening: boolean
  /** پیامِ خطا برای نمایش کنارِ دکمه — یا null */
  error: string | null
  start: () => void
  stop: () => void
  toggle: () => void
}

export interface SpeechOptions {
  /**
   * با هر تکه‌ی تازه صدا زده می‌شود — چه موقت چه نهایی.
   * `final` یعنی این تکه دیگر تغییر نمی‌کند.
   */
  onText: (text: string, final: boolean) => void
  lang?: string
}

/**
 * وقتی موتورِ گفتار بی‌صدا می‌ماند، خودِ میکروفون را می‌پرسیم تا بفهمیم
 * گیر کجاست. این کار فقط بعد از شکست انجام می‌شود، نه پیش از `start` —
 * چون سافاری `start()` را فقط داخلِ همان کلیکِ کاربر می‌پذیرد و یک
 * `await` وسط، آن اجازه را می‌سوزاند.
 */
async function diagnose(report: (m: string) => void): Promise<void> {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!media?.getUserMedia) {
    report('این صفحه امن نیست — گفتار فقط روی HTTPS کار می‌کند')
    return
  }

  try {
    const stream = await media.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    // میکروفون هست و اجازه هم داده شده، پس مشکل خودِ موتورِ گفتار است
    report(
      isSafari()
        ? 'میکروفون سالم است ولی سافاری گفتار را شروع نکرد — Dictation را در تنظیمات دستگاه روشن کنید'
        : 'میکروفون سالم است ولی مرورگر گفتار را شروع نکرد',
    )
  } catch (err) {
    const name = (err as { name?: string })?.name ?? ''
    console.warn('[speech] getUserMedia failed:', name, err)
    report(
      name === 'NotAllowedError'
        ? 'دسترسی میکروفون رد شده — از تنظیماتِ سایت در مرورگر اجازه بدهید'
        : name === 'NotFoundError'
          ? 'میکروفونی پیدا نشد'
          : name === 'SecurityError'
            ? 'این صفحه امن نیست — گفتار فقط روی HTTPS کار می‌کند'
            : `میکروفون در دسترس نیست (${name || 'نامشخص'})`,
    )
  }
}

/**
 * یک جلسه‌ی شنیدن. هر بار که کاربر دکمه را می‌زند، نمونه‌ی تازه ساخته
 * می‌شود — استفاده‌ی دوباره از یک نمونه در کروم باگ‌های خاموشی دارد.
 */
export function useSpeech({ onText, lang = 'fa-IR' }: SpeechOptions): Speech {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognizer | null>(null)

  // کال‌بک را در ref نگه می‌داریم تا شنونده‌ها با هر رندر بازبسته نشوند
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const stop = useCallback(() => {
    recRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    const Ctor = engine()
    if (!Ctor || recRef.current) return

    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setError(null)
      setListening(true)
    }

    rec.onresult = (e) => {
      // فقط نتایجِ تازه از resultIndex به بعد؛ قبلی‌ها را قبلاً فرستاده‌ایم
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0]?.transcript ?? ''
        if (r.isFinal) final += text
        else interim += text
      }
      // اگر در یک رویداد هم جمله‌ی نهایی آمده و هم تکه‌ی بعدی، هر دو را
      // می‌فرستیم: اول نهایی تثبیت شود، بعد موقتِ تازه رویش بنشیند —
      // وگرنه متنِ موقت یک لحظه از فیلد غیب می‌شود
      if (final) onTextRef.current(final, true)
      if (interim) onTextRef.current(interim, false)
    }

    rec.onerror = (e) => {
      // کدِ خام همیشه در کنسول بماند — بدون آن، عیب‌یابیِ گفتار حدس زدن است
      console.warn('[speech] error:', e.error)

      // کاربر خودش قطع کرده؛ خطا نیست
      if (e.error === 'aborted') return

      // سافاری موتور گفتارش را از Dictation سیستم می‌گیرد؛ وقتی آن خاموش
      // باشد بدون هیچ پرسشی همین خطا را می‌دهد. گفتنِ «مرورگر اجازه نداد»
      // کاربر را به نوار آدرس می‌فرستد، جایی که چیزی برای زدن نیست.
      const safariHint =
        isSafari() && (e.error === 'service-not-allowed' || e.error === 'not-allowed')
          ? 'سافاری گفتار را اجازه نداد — Dictation را در تنظیمات دستگاه (Keyboard → Dictation) روشن کنید و صفحه را روی HTTPS باز کنید'
          : null

      setError(safariHint ?? MESSAGES[e.error] ?? `مشکل در تبدیل گفتار (${e.error})`)

      // بعضی نسخه‌های کروم پس از خطا `end` نمی‌فرستند؛ اگر ref پاک نشود
      // دکمه برای همیشه در حالتِ «در حال شنیدن» گیر می‌کند و کلیکِ بعدی
      // هیچ کاری نمی‌کند. پس همین‌جا خودمان می‌بندیم.
      window.setTimeout(() => {
        if (recRef.current === rec) {
          recRef.current = null
          setListening(false)
        }
      }, 300)
    }

    rec.onend = () => {
      recRef.current = null
      setListening(false)
    }

    // نگهبان: اگر مرورگر نه `start` بدهد نه `error`، کاربر روبه‌روی یک
    // دکمه‌ی بی‌جان می‌ماند و باید خودمان حرف را بزنیم.
    //
    // مهلت سخاوتمندانه است و دلیل دارد: پنجره‌ی اجازه‌ی میکروفون منتظرِ
    // خودِ کاربر می‌ماند و تا وقتی «اجازه» را نزده، `start` نمی‌آید.
    // مهلتِ کوتاه یعنی درست وقتی کاربر دارد اجازه می‌دهد، ما شکست را
    // اعلام کنیم — بدترین حالتِ ممکن. اگر کاربر تبِ دیگری برود هم
    // شمارش را از سر می‌گیریم، چون پنجره‌ی اجازه صفحه را پنهان می‌کند.
    let started = false
    let watchdog = 0
    const arm = () => {
      window.clearTimeout(watchdog)
      watchdog = window.setTimeout(() => {
        if (started || recRef.current !== rec) return
        if (document.hidden) {
          arm()
          return
        }
        console.warn('[speech] no start/error event — likely blocked by the browser')
        document.removeEventListener('visibilitychange', arm)
        void diagnose(setError)
        recRef.current = null
        setListening(false)
      }, WATCHDOG_MS)
    }
    arm()

    const clearWatchdog = () => {
      window.clearTimeout(watchdog)
      document.removeEventListener('visibilitychange', arm)
    }
    document.addEventListener('visibilitychange', arm)

    const onStart = rec.onstart
    rec.onstart = () => {
      started = true
      clearWatchdog()
      onStart?.()
    }
    const onErr = rec.onerror
    rec.onerror = (e) => {
      clearWatchdog()
      onErr?.(e)
    }
    const onEnd = rec.onend
    rec.onend = () => {
      clearWatchdog()
      onEnd?.()
    }

    recRef.current = rec
    try {
      rec.start()
    } catch (err) {
      // start() روی نمونه‌ای که هنوز تمام نشده استثنا می‌دهد
      console.warn('[speech] start() threw:', err)
      clearWatchdog()
      recRef.current = null
      setListening(false)
    }
  }, [lang])

  const toggle = useCallback(() => {
    if (recRef.current) stop()
    else start()
  }, [start, stop])

  // ترکِ صفحه در میانه‌ی ضبط نباید میکروفون را روشن بگذارد
  useEffect(() => {
    return () => {
      recRef.current?.abort()
      recRef.current = null
    }
  }, [])

  return { supported: speechSupported, listening, error, start, stop, toggle }
}
