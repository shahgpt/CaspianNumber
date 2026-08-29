import { forwardRef, type ElementType, type ReactNode } from 'react'

export const BRAND_TAGLINE = 'Business Development & Technology'

type BrandLockupProps = {
  className?: string
  title?: ReactNode
  titleAs?: 'span' | 'h1'
  variant?: 'hero' | 'masthead' | 'compact'
  /** نشان زودتر از بقیه‌ی صفحه لازم است — پرده‌ی اولِ ورود روی آن باز می‌شود */
  eager?: boolean
}

const styles = {
  hero: {
    root: 'gap-4',
    mark: 'w-[76px] sm:w-[84px]',
    title: 'text-[20px] sm:text-[22px]',
    tagline: 'max-w-[178px] text-[12px] sm:text-[12.5px]',
  },
  masthead: {
    root: 'gap-3',
    mark: 'w-[42px] sm:w-[46px]',
    title: 'text-[21px] sm:text-[23px]',
    tagline: 'max-w-[190px] text-[11.5px] sm:text-[12px]',
  },
  compact: {
    root: 'gap-3',
    mark: 'w-[38px]',
    title: 'text-[22px]',
    tagline: 'max-w-[175px] text-[11px]',
  },
} as const

const BrandLockup = forwardRef<HTMLDivElement, BrandLockupProps>(function BrandLockup(
  { className = '', title = 'Caspian Number', titleAs = 'span', variant = 'masthead', eager = false },
  ref,
) {
  const s = styles[variant]
  const Title = titleAs as ElementType

  return (
    <div
      ref={ref}
      dir="ltr"
      className={`flex min-w-0 items-center text-left ${s.root} ${className}`}
    >
      <img
        src="/brand-mark.png"
        alt=""
        aria-hidden="true"
        width={384}
        height={384}
        decoding="async"
        {...(eager ? { fetchPriority: 'high' as const } : {})}
        data-brand="mark"
        className={`brand-mark h-auto shrink-0 object-contain ${s.mark}`}
      />
      <div className="min-w-0">
        {title && (
          <Title
            data-brand="title"
            className={`block font-bold leading-tight tracking-[-0.03em] text-ink-900 ${s.title}`}
          >
            {title}
          </Title>
        )}
        <span
          data-brand="tagline"
          className={`block font-medium leading-[1.35] text-ink-500 ${title ? 'mt-1' : ''} ${s.tagline}`}
        >
          {BRAND_TAGLINE}
        </span>
      </div>
    </div>
  )
})

export default BrandLockup
