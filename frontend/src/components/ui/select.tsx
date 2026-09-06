import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'

/* انتخاب‌گرِ دنیا — جایگزینِ `<select>` بومی.
   `<select>` را سیستم‌عامل می‌کشد، نه ما: قلمِ خودش، حاشیه‌ی خودش،
   فهرستِ خاکستریِ خودش. وسطِ کاغذِ سفید و خطوطِ ترازِ این محصول، تنها
   چیزی است که به آن تعلق ندارد.

   فهرست از طریق پرتال و با موقعیتِ fixed باز می‌شود، نه absolute: مودالِ
   «سطح دسترسی» خودش overflow-y-auto دارد و هر لایه‌ی absolute داخلش
   بریده می‌شد. */

export type SelectOption = {
  value: string
  label: string
  /** خطِ دومِ گزینه — جایی که «این نقش یعنی چه» گفته می‌شود */
  hint?: string
}

type Props = {
  id?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  'aria-label'?: string
  'aria-labelledby'?: string
  disabled?: boolean
  /** فشرده: برای نوارِ سربرگ. وگرنه هم‌اندازه‌ی فیلدهای فرم. */
  size?: 'sm' | 'md'
  className?: string
  placeholder?: string
}

/* موقعیت را صریح حساب می‌کنیم، نه با inset-inline-start: آن ویژگی در
   صفحه‌ی راست‌به‌چپ به `right` نگاشت می‌شود و عددِ فاصله‌از‌چپ آنجا معنای
   دیگری دارد — فهرست کنارِ دکمه نمی‌ماند. لبه‌ی آغازِ فهرست روی لبه‌ی
   آغازِ دکمه می‌نشیند، و اگر از کادر بزند برمی‌گردد تو. */
function placement(rect: DOMRect) {
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
  const width = Math.max(rect.width, 208)
  const raw = rtl ? rect.right - width : rect.left
  const left = Math.max(8, Math.min(raw, window.innerWidth - width - 8))
  const below = window.innerHeight - rect.bottom
  return {
    left,
    width,
    ...(below < 220 && rect.top > below
      ? { bottom: window.innerHeight - rect.top + 6 }
      : { top: rect.bottom + 6 }),
  }
}

const TRIGGER = {
  sm: 'h-8 rounded-lg px-2.5 text-[12.5px] font-medium',
  md: 'h-[42px] w-full rounded-xl px-3 text-sm',
} as const

export default function Select({
  id,
  value,
  options,
  onChange,
  disabled = false,
  size = 'md',
  className = '',
  placeholder = 'انتخاب کنید',
  ...aria
}: Props) {
  const baseId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })

  const selected = options.findIndex((o) => o.value === value)
  const current = selected >= 0 ? options[selected] : undefined

  const place = useCallback(() => {
    const el = triggerRef.current
    if (el) setRect(el.getBoundingClientRect())
  }, [])

  const openList = useCallback(() => {
    if (disabled) return
    place()
    setActive(selected >= 0 ? selected : 0)
    setOpen(true)
  }, [disabled, place, selected])

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      if (option) onChange(option.value)
      close()
    },
    [close, onChange, options],
  )

  // فهرست همیشه چسبیده به دکمه می‌ماند — اسکرول و تغییر اندازه جابه‌جایش
  // می‌کنند، و در ظرفِ اسکرول‌دار «capture» لازم است تا رویداد برسد.
  useLayoutEffect(() => {
    if (!open) return
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [close, open])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    const last = options.length - 1

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openList()
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        // برگه‌ی مودالِ بیرون هم به Escape گوش می‌دهد؛ اگر رد شود، یک
        // فشار هم فهرست و هم برگه را می‌بندد.
        e.stopPropagation()
        close()
        return
      case 'Tab':
        close(false)
        return
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(last, i + 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        return
      case 'Home':
        e.preventDefault()
        setActive(0)
        return
      case 'End':
        e.preventDefault()
        setActive(last)
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(active)
        return
    }

    // تایپِ نامِ گزینه — همان رفتاری که از یک انتخاب‌گر انتظار می‌رود
    if (e.key.length === 1) {
      const now = Date.now()
      typed.current = {
        text: now - typed.current.at > 900 ? e.key : typed.current.text + e.key,
        at: now,
      }
      const found = options.findIndex((o) => o.label.startsWith(typed.current.text))
      if (found >= 0) setActive(found)
    }
  }

  return (
    <>
      <button
        {...aria}
        id={id}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${baseId}-list` : undefined}
        aria-activedescendant={open ? `${baseId}-opt-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`group inline-flex items-center justify-between gap-2 border bg-paper text-ink-900 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sea-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'border-sea-500' : 'border-sand-300 hover:border-sea-500/60'
        } ${TRIGGER[size]} ${className}`}
      >
        <span className={`truncate ${current ? '' : 'text-ink-300'}`}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown
          strokeWidth={2}
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-ink-400 transition-transform duration-200 ${
            open ? '-rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            id={`${baseId}-list`}
            role="listbox"
            aria-label={aria['aria-label']}
            style={{ position: 'fixed', ...placement(rect) }}
            className="depth-select z-[60] max-h-[15rem] overflow-y-auto overscroll-contain rounded-xl border border-sand-200 bg-paper p-1 shadow-panel"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              return (
                <div
                  key={option.value}
                  id={`${baseId}-opt-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => commit(index)}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors duration-100 ${
                    index === active ? 'bg-tint text-tide' : 'text-ink-700'
                  }`}
                >
                  <Check
                    strokeWidth={2.4}
                    aria-hidden="true"
                    className={`mt-[3px] h-3.5 w-3.5 shrink-0 text-tide ${
                      isSelected ? '' : 'invisible'
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.hint && (
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-400">
                        {option.hint}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
