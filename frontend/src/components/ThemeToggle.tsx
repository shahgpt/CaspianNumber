import { useEffect, useRef, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import gsap from 'gsap'
import { getTheme, onThemeChange, toggleTheme } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { prefersReducedMotion } from '../lib/motion'

type Props = {
  /** روی سطح تیره (هدر دفترچه) رنگ‌ها معکوس می‌شوند */
  onDark?: boolean
  className?: string
}

/**
 * تعویض تم. هر دو آیکون هم‌زمان در DOM هستند و GSAP بینشان
 * چرخش/محو انجام می‌دهد — بدون پرشِ چیدمان.
 */
export default function ThemeToggle({ onDark = false, className = '' }: Props) {
  const [theme, setTheme] = useState<Theme>(() => getTheme())
  const sunRef = useRef<SVGSVGElement>(null)
  const moonRef = useRef<SVGSVGElement>(null)
  const first = useRef(true)

  useEffect(() => onThemeChange(setTheme), [])

  useEffect(() => {
    // آیکون همان کاری را نشان می‌دهد که کلیک انجام می‌دهد
    const incoming = theme === 'dark' ? sunRef.current : moonRef.current
    const outgoing = theme === 'dark' ? moonRef.current : sunRef.current
    if (!incoming || !outgoing) return

    if (first.current || prefersReducedMotion()) {
      first.current = false
      gsap.set(incoming, { autoAlpha: 1, rotate: 0, scale: 1 })
      gsap.set(outgoing, { autoAlpha: 0, rotate: theme === 'dark' ? -70 : 70, scale: 0.5 })
      return
    }

    gsap.to(outgoing, { autoAlpha: 0, rotate: 70, scale: 0.5, duration: 0.28, ease: 'power2.in' })
    gsap.fromTo(
      incoming,
      { autoAlpha: 0, rotate: -70, scale: 0.5 },
      { autoAlpha: 1, rotate: 0, scale: 1, duration: 0.5, ease: 'expo.out' },
    )
  }, [theme])

  const surface = onDark
    ? 'text-white ring-white/15 hover:bg-white/10'
    : 'text-ink-600 ring-sand-200 hover:text-ink-900 hover:bg-sand-100'

  return (
    <button
      type="button"
      onClick={() => toggleTheme()}
      aria-label={theme === 'dark' ? 'تم روشن' : 'تم تاریک'}
      title={theme === 'dark' ? 'تم روشن' : 'تم تاریک'}
      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 transition-colors duration-200 active:scale-95 ${surface} ${className}`}
    >
      <Sun ref={sunRef} strokeWidth={1.8} className="absolute h-[18px] w-[18px] invisible" />
      <Moon ref={moonRef} strokeWidth={1.8} className="absolute h-[18px] w-[18px] invisible" />
    </button>
  )
}
