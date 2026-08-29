import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ElementType, JSX } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion } from '../../lib/motion'

/**
 * TextAnimate — همان API کامپوننت MagicUI، اما موتورش GSAP است
 * تا با تایم‌لاین ورودِ بقیه‌ی صفحه هماهنگ بماند و دپندنسی تازه‌ای نیاورد.
 *
 *   <TextAnimate animation="slideLeft" by="character">Caspian Number</TextAnimate>
 *
 * بدون JS یا با prefers-reduced-motion متن از همان ابتدا کامل و خواناست.
 */

export type AnimationVariant =
  | 'fadeIn'
  | 'blurIn'
  | 'blurInUp'
  | 'blurInDown'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'scaleUp'
  | 'scaleDown'

export type SegmentBy = 'text' | 'word' | 'character' | 'line'

/** حالت «پنهان» هر واریانت — GSAP از این حالت به حالت طبیعی می‌رسد. */
const VARIANTS: Record<AnimationVariant, gsap.TweenVars> = {
  fadeIn: { opacity: 0, y: 20 },
  blurIn: { opacity: 0, filter: 'blur(10px)' },
  blurInUp: { opacity: 0, filter: 'blur(10px)', y: 20 },
  blurInDown: { opacity: 0, filter: 'blur(10px)', y: -20 },
  slideUp: { opacity: 0, y: 20 },
  slideDown: { opacity: 0, y: -20 },
  slideLeft: { opacity: 0, x: 20 },
  slideRight: { opacity: 0, x: -20 },
  scaleUp: { opacity: 0, scale: 0.5, transformOrigin: '50% 50%' },
  scaleDown: { opacity: 0, scale: 1.5, transformOrigin: '50% 50%' },
}

/** پیش‌فرض فاصله‌ی بین قطعات، متناسب با ریزی قطعه */
const STAGGER: Record<SegmentBy, number> = {
  text: 0,
  line: 0.06,
  word: 0.05,
  character: 0.028,
}

function segment(text: string, by: SegmentBy): string[] {
  if (by === 'text') return [text]
  if (by === 'line') return text.split('\n')
  if (by === 'word') return text.split(/(\s+)/).filter(Boolean)
  return Array.from(text)
}

export interface TextAnimateProps {
  children: string
  className?: string
  segmentClassName?: string
  /** تأخیر پیش از شروع (ثانیه) */
  delay?: number
  /** مدت انیمیشن هر قطعه (ثانیه) */
  duration?: number
  by?: SegmentBy
  as?: ElementType
  animation?: AnimationVariant
  /** فقط وقتی وارد دید شد اجرا کن */
  startOnView?: boolean
  /** تکرار نشود اگر دوباره وارد دید شد */
  once?: boolean
  /**
   * جهت متن. قطعه‌ها inline-block هستند و الگوریتم دوجهته آن‌ها را «شیء»
   * می‌بیند؛ پس یک متن لاتین داخل صفحه‌ی RTL باید صریحاً ltr اعلام شود.
   */
  dir?: 'rtl' | 'ltr'
}

export function TextAnimate({
  children,
  className,
  segmentClassName,
  delay = 0,
  duration = 0.6,
  by = 'word',
  as: Component = 'p',
  animation = 'fadeIn',
  startOnView = true,
  once = false,
  dir,
}: TextAnimateProps) {
  const hostRef = useRef<HTMLElement>(null)
  const segments = useMemo(() => segment(children, by), [children, by])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || prefersReducedMotion()) return

    const parts = host.querySelectorAll<HTMLElement>('[data-ta-segment]')
    if (!parts.length) return

    const play = () =>
      gsap.from(parts, {
        ...VARIANTS[animation],
        duration,
        delay,
        stagger: STAGGER[by],
        ease: 'expo.out',
        clearProps: 'transform,opacity,filter',
      })

    if (!startOnView) {
      const tween = play()
      return () => {
        tween.kill()
      }
    }

    let tween: gsap.core.Tween | undefined
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          tween = play()
          if (once) io.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    io.observe(host)
    return () => {
      io.disconnect()
      tween?.kill()
    }
  }, [animation, by, delay, duration, once, startOnView, segments])

  const Tag = Component as keyof JSX.IntrinsicElements

  return (
    // @ts-expect-error — Tag پویاست؛ ref روی هر عنصر HTML معتبر است
    <Tag ref={hostRef} className={className} dir={dir} aria-label={children}>
      {segments.map((part, i) => (
        <span
          key={`${part}-${i}`}
          data-ta-segment=""
          aria-hidden="true"
          className={`ta-char ${segmentClassName ?? ''}`}
        >
          {part}
        </span>
      ))}
    </Tag>
  )
}

export default TextAnimate
