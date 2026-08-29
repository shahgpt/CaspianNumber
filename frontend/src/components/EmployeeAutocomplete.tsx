import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '../lib/api'
import type { Employee } from '../lib/api'
import { faDigits } from '../lib/motion'
import MicButton from './MicButton'
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteStatus,
} from './ui/autocomplete'

/* قرارداد Impeccable — دنیای «نقشه‌ی عمق‌سنجی»
   پیشنهادها همان نشانه‌های عمق‌اند که پیش از رها کردنِ کلید بالا می‌آیند:
   نام، سمت و واحد، و خودِ عدد روی لبه‌ی پایان. هیچ آواتاری نیست — دفترچه
   جایی برای صورت ندارد، عدد محصولِ آن است.
   دراپ‌داون همان کاغذِ شیتِ تماس است: paper، سایه‌ی پنل، خطِ مویی شنی. */

const DEBOUNCE_MS = 250
const SUGGEST_LIMIT = 8

interface Props {
  /** متنِ فیلد — بیرون نگه داشته می‌شود تا دکمه‌ی گفتار هم بتواند بنویسد */
  value: string
  onValueChange: (text: string) => void
  /** اجرای جستجوی واقعیِ فهرست */
  onSearch: (text: string) => void
  /** اسپینرِ جستجوی فهرستِ اصلی — کنارِ میکروفون می‌نشیند */
  busy?: boolean
}

export default function EmployeeAutocomplete({ value, onValueChange, onSearch, busy }: Props) {
  /* تایپ که ایستاد، آن‌وقت از سرور می‌پرسیم — نه سرِ هر حرف */
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(value.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value])

  const {
    data: hits,
    isFetching,
    isError,
  } = useQuery({
    queryKey: ['suggest', term],
    queryFn: () =>
      api<Employee[]>(`/api/employees?q=${encodeURIComponent(term)}&limit=${SUGGEST_LIMIT}`),
    enabled: term.length > 0,
  })

  const typed = value.trim() !== ''
  const results = term ? (hits ?? []) : []
  /* منتظر — یا هنوز دبانس نگذشته، یا پاسخ نیامده */
  const waiting = typed && (term !== value.trim() || isFetching)

  let status: string | null = null
  if (isError) status = 'جستجو انجام نشد. دوباره تلاش کنید.'
  else if (waiting && results.length === 0) status = 'در حال گشتن…'
  else if (!waiting && term && results.length === 0) status = 'کسی با این نشانه پیدا نشد.'

  function pick(id: string | null) {
    const emp = results.find((e) => String(e.id) === id)
    if (emp) onSearch(emp.full_name)
  }

  return (
    <Autocomplete inputValue={value} onInputValueChange={onValueChange} onValueChange={pick}>
      <div className="relative">
        <Search
          strokeWidth={1.8}
          aria-hidden="true"
          className="pointer-events-none absolute start-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-ink-400"
        />
        <AutocompleteInput
          size="none"
          placeholder="نام، واحد یا مسئولیت…"
          aria-label="جستجوی پرسنل"
          autoComplete="off"
          className="h-[52px] rounded-xl border-sand-200 bg-sand-50 ps-12 pe-[4.5rem] text-[15px] text-ink-900 placeholder:text-ink-400 transition-[background-color,border-color,box-shadow] duration-200 focus:border-sea-500 focus:bg-paper focus:outline-none focus:ring-4 focus:ring-sea-500/20 focus-visible:border-sea-500 focus-visible:ring-4 focus-visible:ring-sea-500/20 dark:bg-sand-50"
        />

        {/* اسپینر و میکروفون یک لبه را می‌گیرند؛ جای میکروفون ثابت
            می‌ماند تا با آمدنِ اسپینر نپرد */}
        <div className="field-tools">
          {busy && (
            <span className="text-ink-400">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="search-spinner h-[18px] w-[18px]"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">در حال جستجو…</span>
            </span>
          )}
          {/* گفتنِ نام آسان‌تر از نوشتنِ آن است — به‌ویژه روی موبایل.
              جمله که تمام شد، خودش جستجو می‌کند. */}
          <MicButton value={value} onChange={onValueChange} onFinal={(t) => onSearch(t)} />
        </div>
      </div>

      {typed && (status || results.length > 0) && (
        <AutocompleteContent
          sideOffset={8}
          className="suggest-popup rounded-xl bg-paper py-1.5 shadow-panel ring-1 ring-sand-200 duration-200 ease-out-expo"
        >
          {status && (
            <AutocompleteStatus role="status" aria-live="polite" className="px-3 py-2 text-[13px] text-ink-400">
              {status}
            </AutocompleteStatus>
          )}

          {/* کلید روی خودِ فهرست: نتیجه‌ها که جابه‌جا می‌شوند، گزینه‌ها
              دوباره به همان ترتیبِ دیده‌شده ثبت می‌شوند — وگرنه کلیدِ
              جهت‌دار ترتیبی را می‌رود که روی صفحه نیست. */}
          <AutocompleteList
            key={results.map((e) => e.id).join(',')}
            className="px-1.5 py-1"
          >
            {results.map((emp) => {
              const unit = emp.department || emp.company || ''
              const meta = [emp.job_title, unit].filter(Boolean).join(' · ')
              const number = emp.extension?.trim() || emp.direct?.trim() || ''
              return (
                <AutocompleteItem
                  key={emp.id}
                  value={String(emp.id)}
                  label={emp.full_name}
                  className="gap-3 rounded-lg px-3 py-2.5 text-[14px] data-[highlighted]:before:rounded-lg"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-ink-900">{emp.full_name}</span>
                    {meta && (
                      <span className="mt-0.5 block truncate text-[12px] text-ink-500">{meta}</span>
                    )}
                  </span>
                  {number && (
                    <span className="tnum shrink-0 text-[13.5px] font-bold text-tide" dir="ltr">
                      {faDigits(number)}
                    </span>
                  )}
                </AutocompleteItem>
              )
            })}
          </AutocompleteList>
        </AutocompleteContent>
      )}
    </Autocomplete>
  )
}
