import { useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import type { HTMLMotionProps, Transition } from 'motion/react'
import type { Employee } from '../lib/api'
import EmployeeRow from './EmployeeRow'

/* برگرفته از کامپوننت Pin List (arhamkhnz) — سازوکارِ اصلی دست‌نخورده
   مانده: LayoutGroup + layoutId ردیف را بینِ دو گروه پرواز می‌دهد،
   AnimatePresence برچسبِ گروهِ خالی را می‌برد، و گروهِ مبدأ تا پایانِ
   حرکت زیر می‌رود تا ردیفِ در حالِ جابه‌جایی از رویِ بقیه رد شود.

   دو چیز عوض شده: ردیف همان EmployeeRow دفترچه است (تماس و شماره باید
   بماند)، و پین با دکمه‌ی خودش زده می‌شود نه با کلیکِ کلِ ردیف — چون
   داخلِ ردیف لینکِ تماس هست و کلیکِ سراسری آن را می‌دزدید. */

export type PinListItem = Employee & { pinned: boolean }

export interface PinListProps {
  items: PinListItem[]
  labels?: { pinned?: string; unpinned?: string }
  transition?: Transition
  labelMotionProps?: HTMLMotionProps<'p'>
  className?: string
  labelClassName?: string
  pinnedSectionClassName?: string
  unpinnedSectionClassName?: string
  /** باید با طولِ انیمیشن هم‌خوان بماند */
  zIndexResetDelay?: number
  onToggle?: (item: PinListItem) => void
}

export default function PinList({
  items,
  labels = { pinned: 'پین‌شده', unpinned: 'همه همکاران' },
  transition = { stiffness: 320, damping: 20, mass: 0.8, type: 'spring' },
  labelMotionProps = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.22, ease: 'easeInOut' },
  },
  className = '',
  labelClassName = '',
  pinnedSectionClassName = '',
  unpinnedSectionClassName = '',
  zIndexResetDelay = 500,
  onToggle,
}: PinListProps) {
  const [togglingGroup, setTogglingGroup] = useState<'pinned' | 'unpinned' | null>(null)
  const reduced = useReducedMotion()

  const pinned = items.filter((e) => e.pinned)
  const unpinned = items.filter((e) => !e.pinned)
  const move: Transition = reduced ? { duration: 0 } : transition

  function toggle(item: PinListItem) {
    setTogglingGroup(item.pinned ? 'pinned' : 'unpinned')
    onToggle?.(item)
    setTimeout(() => setTogglingGroup(null), zIndexResetDelay)
  }

  function section(group: 'pinned' | 'unpinned', rows: PinListItem[], extra: string) {
    if (!rows.length) return null
    return (
      <div className={`relative ${togglingGroup === group ? 'z-0' : 'z-10'} ${extra}`}>
        <ul className="roster-list">
          {rows.map((emp) => (
            <EmployeeRow
              key={emp.id}
              emp={emp}
              pinned={emp.pinned}
              onTogglePin={() => toggle(emp)}
              layoutTransition={move}
            />
          ))}
        </ul>
      </div>
    )
  }

  function label(group: 'pinned' | 'unpinned', text: string, show: boolean) {
    return (
      <AnimatePresence initial={false}>
        {show && (
          <motion.p
            layout
            key={`${group}-label`}
            {...labelMotionProps}
            className={`roster-label ${labelClassName}`}
          >
            {text}
          </motion.p>
        )}
      </AnimatePresence>
    )
  }

  return (
    <div className={className}>
      <LayoutGroup>
        {label('pinned', labels.pinned ?? 'پین‌شده', pinned.length > 0)}
        {section('pinned', pinned, pinnedSectionClassName)}
        {label('unpinned', labels.unpinned ?? 'همه همکاران', unpinned.length > 0 && pinned.length > 0)}
        {section('unpinned', unpinned, unpinnedSectionClassName)}
      </LayoutGroup>
    </div>
  )
}
