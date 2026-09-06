import { useEffect, useRef } from 'react'

/* یک برگه‌ی مودال باید فوکوس را نگه دارد. بدون این، Tab از داخلِ برگه
   بیرون می‌رفت و روی محتوای پشتِ پرده می‌نشست: کسی که با صفحه‌کلید کار
   می‌کند در دکمه‌هایی می‌چرخید که نمی‌دیدشان.

   شنونده روی خودِ برگه است، نه روی document و نه با capture: انتخاب‌گرِ
   داخلِ برگه باید اول Escape را بگیرد و ببندد، وگرنه یک Escape هم فهرست
   و هم برگه را می‌بست. */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const node = ref.current
    if (!open || !node) return

    const restoreTo = document.activeElement as HTMLElement | null
    const reachable = () =>
      [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )

    // فوکوس به اولین چیزِ کاربردی، نه به دکمه‌ی بستن
    const first = reachable().find((el) => !el.hasAttribute('aria-label')) ?? reachable()[0]
    first?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = reachable()
      if (items.length === 0) return
      const edge = event.shiftKey ? items[0] : items[items.length - 1]
      if (document.activeElement === edge || !node!.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? items[items.length - 1] : items[0]).focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      // برگرداندنِ فوکوس به همان دکمه‌ای که برگه را باز کرد
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus()
    }
  }, [open])

  return ref
}
