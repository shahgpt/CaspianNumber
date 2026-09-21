import { SearchIcon, CloseIcon } from '../icons'
import type { Sort, SortDir } from '../../lib/table'

/* ابزارِ مشترکِ جدول‌های پنل: سرستونِ مرتب‌شونده و کادرِ جستجو.
   هر جدول این‌ها را جدا می‌ساخت و هر بار کمی فرق داشت — نشانگرِ ترتیب یک
   جا بود و جای دیگر نبود، صفحه‌خوان در یکی می‌فهمید ترتیب روی کدام ستون
   است و در دیگری نه. یک پیاده‌سازی، یک رفتار. */

type HeadProps<K extends string> = {
  label: string
  sortKey: K
  sort: Sort<K>
  onSort: (key: K) => void
  className?: string
  /** ستونی که محتوایش لاتین است (شماره، نام کاربری) */
  ltr?: boolean
}

const ARROW: Record<SortDir, string> = { asc: 'M4 8.5 7 5l3 3.5', desc: 'M4 5.5 7 9l3-3.5' }

export function SortableHead<K extends string>({
  label, sortKey, sort, onSort, className = '', ltr = false,
}: HeadProps<K>) {
  const active = sort.key === sortKey
  return (
    <th
      scope="col"
      // صفحه‌خوان باید ترتیب را از خودِ ستون بشنود، نه از یک آیکونِ تزئینی.
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-3 text-right font-medium ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group inline-flex items-center gap-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sea-500/40 ${
          active ? 'text-tide' : 'hover:text-ink-900'
        }`}
      >
        <span className={ltr ? 'inline-block' : undefined}>{label}</span>
        <svg
          viewBox="0 0 14 14"
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 transition-opacity duration-200 ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-45'
          }`}
        >
          <path
            d={ARROW[active ? sort.dir : 'asc']}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </th>
  )
}

type SearchProps = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  /** شمارِ ردیف‌های یافته — کنار کادر، برای وقتی که صافی چیزی را کنار گذاشته */
  count?: string
  className?: string
}

export function TableSearch({
  value, onChange, placeholder, label, count, className = '',
}: SearchProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <label className="relative block">
        <span className="sr-only">{label}</span>
        <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full min-w-[12rem] rounded-xl border border-sand-300 bg-sand-50/60 py-2 pe-9 ps-9 text-sm text-ink-900 transition-colors placeholder:text-ink-300 focus:border-sea-500 focus:bg-paper focus:outline-none focus:ring-2 focus:ring-sea-500/20 sm:w-64 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="پاک کردن جستجو"
            className="absolute left-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-ink-400 transition-colors hover:bg-sand-100 hover:text-ink-700"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </label>
      {count && <span className="tnum shrink-0 text-xs text-ink-400">{count}</span>}
    </div>
  )
}
