import { useCallback, useEffect, useRef } from 'react'
import { Mic } from 'lucide-react'
import { useSpeech } from '../lib/speech'

type Props = {
  /** متنِ فعلیِ فیلد — گفتار به انتهای همین اضافه می‌شود */
  value: string
  /** متنِ تازه (شاملِ بخشِ موقت) */
  onChange: (text: string) => void
  /** وقتی یک جمله نهایی شد — مثلاً برای اجرای جستجو */
  onFinal?: (text: string) => void
  className?: string
}

/** چسباندنِ تکه‌ی تازه به متنِ قبلی با یک فاصله، بدون فاصله‌ی اضافه */
function join(base: string, chunk: string): string {
  const b = base.replace(/\s+$/, '')
  const c = chunk.trim()
  if (!b) return c
  if (!c) return b
  return `${b} ${c}`
}

/**
 * دکمه‌ی گفتار. کاربر می‌زند، حرف می‌زند، و متن هم‌زمان در فیلد نوشته
 * می‌شود — بخشِ موقت هم دیده می‌شود و با نهایی‌شدن جای خودش را می‌دهد.
 * روی مرورگری که موتور گفتار ندارد، اصلاً رندر نمی‌شود؛ یک دکمه‌ی
 * همیشه‌خاموش بدتر از نبودن است.
 */
export default function MicButton({ value, onChange, onFinal, className = '' }: Props) {
  /** متنِ ثابت‌شده: هرچه پیش از این جلسه بود + جمله‌های نهایی‌شده */
  const baseRef = useRef(value)
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  })

  /**
   * متنِ موقت جایگزین می‌شود، نه اینکه جمع شود — موتورِ گفتار هر بار
   * کلِ تکه‌ی موقتِ فعلی را می‌فرستد («سلام» بعد «سلام روز بخیر»)؛ اگر
   * روی هم انباشته شود فیلد پر از «سلام سلام …» می‌شود.
   */
  const interimRef = useRef('')

  const emit = useCallback(() => {
    onChange(interimRef.current ? join(baseRef.current, interimRef.current) : baseRef.current)
  }, [onChange])

  const handleText = useCallback(
    (text: string, isFinal: boolean) => {
      if (isFinal) {
        interimRef.current = ''
        baseRef.current = join(baseRef.current, text)
        onFinal?.(baseRef.current)
      } else {
        interimRef.current = text.trim()
      }
      emit()
    },
    [emit, onFinal],
  )

  const speech = useSpeech({ onText: handleText })

  // شروعِ هر جلسه از روی متنی که همان لحظه در فیلد است
  useEffect(() => {
    if (speech.listening) {
      baseRef.current = valueRef.current
      interimRef.current = ''
    }
  }, [speech.listening])

  if (!speech.supported) return null

  const label = speech.listening ? 'پایانِ گفتن' : 'گفتن به‌جای نوشتن'

  return (
    <span className="mic-wrap">
      <button
        type="button"
        onClick={speech.toggle}
        aria-label={label}
        aria-pressed={speech.listening}
        title={speech.error ?? label}
        className={`mic-button ${speech.listening ? 'mic-button--live' : ''} ${className}`}
      >
        <Mic strokeWidth={1.8} className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>

      {/* خطا باید دیده شود، نه اینکه فقط در tooltip بماند — دکمه‌ای که
          بی‌صدا شکست می‌خورد، از نبودنش بدتر است */}
      {speech.error && (
        <span className="mic-note" role="status" aria-live="polite">
          {speech.error}
        </span>
      )}
    </span>
  )
}
