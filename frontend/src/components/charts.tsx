import { useLayoutEffect, useRef, useState } from 'react'
import { faDay, faNumber } from '../lib/format'

/* نمودارهای «نمای کلی» — SVG خام، بدون کتابخانه.

   چرا خام: این دنیا یک اکسنت دارد و بس (آبیِ نشان)، و هر کتابخانه‌ی نمودار
   اول یک پالتِ رنگیِ خودش را می‌آورد. چیزی که اینجا لازم است چند شکلِ ساده
   با همان توکن‌های صفحه است، نه یک موتورِ عمومی.

   قاعده‌های ثابتِ همه‌ی نمودارهای این فایل:
   • یک رنگ برای داده — اکسنت. تأکید با پررنگی/کدری است، نه با رنگِ تازه.
     هیچ‌جا مقدارِ بزرگ‌تر رنگِ تیره‌تر نمی‌گیرد: طولِ میله همین را می‌گوید.
   • متن هرگز رنگِ داده نمی‌پوشد؛ برچسب و محور از نردبانِ مرکب می‌آیند.
   • خطِ راهنما مویی و یک‌دست است، نه خط‌چین.
   • محورِ زمان در صفحه‌ی راست‌به‌چپ آینه است: قدیمی‌ترین سمتِ راست،
     تازه‌ترین سمتِ چپ — همان‌طور که این صفحه خوانده می‌شود.
*/

/** پهنای واقعیِ ظرف — نمودار با صفحه بزرگ و کوچک می‌شود بی‌آنکه کشیده شود. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/* `<svg width={n}>` یک عنصرِ جایگزین‌شونده است و همان عدد، کمینه‌ی عرضِ
   ذاتی‌اش می‌شود. داخلِ یک grid این یک حلقه می‌سازد: SVG با عرضِ دسکتاپ
   رسم می‌شود، خانه‌ی grid را باز نگه می‌دارد، اندازه‌گیری دوباره همان عددِ
   بزرگ را می‌دهد و نمودار روی موبایل از کارت بیرون می‌زند. `max-w-full`
   سهمِ ذاتی را سقف می‌زند و حلقه را باز می‌کند؛ `min-w-0` روی خانه‌های
   grid در صفحه هم همین کار را از آن سو می‌کند. */
const SVG_BOX = 'block max-w-full'

/* ---------------- ابزارِ مشترک ---------------- */

/** نردبانِ محور: سقفِ گرد، و پله‌هایی که عددِ خوانا بدهند. */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
}

type TipState = { x: number; y: number; index: number } | null

/** حبابِ مقدار — بیرون از SVG می‌نشیند تا متنش از قلمِ صفحه ارث ببرد. */
function Tooltip({
  tip, width, title, lines,
}: {
  tip: NonNullable<TipState>
  width: number
  title: string
  lines: { label: string; value: string }[]
}) {
  // حباب از لبه‌ی کادر بیرون نمی‌زند: جایش داخل نگه داشته می‌شود.
  const half = 78
  const left = Math.max(half, Math.min(tip.x, width - half))
  return (
    <div
      role="status"
      aria-live="off"
      style={{ left, top: Math.max(8, tip.y - 14) }}
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border border-sand-200 bg-paper/95 px-3 py-2 text-right shadow-panel backdrop-blur"
    >
      <p className="text-[11.5px] text-ink-400">{title}</p>
      {lines.map((line) => (
        <p key={line.label} className="mt-0.5 text-[13px] text-ink-700">
          <span className="tnum font-bold text-ink-900">{line.value}</span>{' '}
          <span className="text-ink-500">{line.label}</span>
        </p>
      ))}
    </div>
  )
}

/* ---------------- نمودارِ روند ---------------- */

export type TrendPoint = { date: string; value: number }

/**
 * یک سری، یک رنگ: خطِ دو‌پیکسلی با موجِ کم‌رنگِ زیرش. چون فقط یک سری
 * هست، راهنمای رنگ لازم نیست — عنوانِ کارت می‌گوید چه چیزی رسم شده.
 */
export function TrendChart({
  points, label, height = 220,
}: {
  points: TrendPoint[]
  label: string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)

  /* «۱۶ شهریور» حدودِ این‌قدر جا می‌خواهد. هم فاصله‌ی برچسب‌ها از همین
     می‌آید، هم حاشیه‌ی چپ: نقطه‌ی آخر روی لبه‌ی چپ می‌نشیند و برچسبِ
     وسط‌چینش باید همان‌جا کامل جا شود. جابه‌جاکردنِ برچسبِ لبه به‌جای
     این، دو برچسبِ آخر را روی هم می‌انداخت. */
  const LABEL_WIDTH = 68
  const pad = { top: 16, right: 44, bottom: 26, left: LABEL_WIDTH / 2 }
  const plotW = Math.max(0, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const max = Math.max(1, ...points.map((p) => p.value))
  const scale = ticks(max)
  const top = scale[scale.length - 1]

  // آینه: نقطه‌ی صفر (قدیمی‌ترین) سمتِ راست می‌نشیند.
  const xAt = (i: number) =>
    pad.left + plotW - (points.length < 2 ? plotW / 2 : (i / (points.length - 1)) * plotW)
  const yAt = (v: number) => pad.top + plotH - (v / top) * plotH

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i)},${yAt(p.value)}`).join(' ')
  const area = points.length
    ? `${line} L${xAt(points.length - 1)},${pad.top + plotH} L${xAt(0)},${pad.top + plotH} Z`
    : ''

  // برچسبِ محورِ افقی فقط چند جا: شمارش از پهنای واقعی می‌آید،
  // نه از تعدادِ نقطه‌ها — وگرنه روی صفحه‌ی باریک روی هم می‌افتند.
  const room = Math.max(2, Math.floor(plotW / LABEL_WIDTH))
  const every = Math.max(1, Math.ceil(points.length / room))
  const peak = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0)

  function track(e: React.PointerEvent<SVGSVGElement>) {
    if (!points.length || plotW <= 0) return
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left
    const ratio = (pad.left + plotW - x) / plotW
    const index = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))))
    setTip({ x: xAt(index), y: yAt(points[index].value), index })
  }

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label} در بازه‌ی انتخاب‌شده`}
          onPointerMove={track}
          onPointerLeave={() => setTip(null)}
          className={`${SVG_BOX} touch-none`}
        >
          {/* خطوط راهنما — مویی، یک‌دست، پس‌نشسته */}
          {scale.map((v) => (
            <g key={v}>
              <line
                x1={pad.left} x2={pad.left + plotW} y1={yAt(v)} y2={yAt(v)}
                className="stroke-sand-200" strokeWidth="1" shapeRendering="crispEdges"
              />
              <text
                x={pad.left + plotW + 8} y={yAt(v) + 4}
                className="fill-ink-400 tnum text-[10px]"
              >
                {faNumber(v)}
              </text>
            </g>
          ))}

          {points.length > 0 && (
            <>
              <path d={area} className="fill-sea-500/10" />
              <path
                d={line}
                fill="none"
                className="stroke-sea-500"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* تنها نقطه‌ای که برچسبِ مستقیم می‌گیرد: بیشینه. */}
              {max > 0 && (
                <>
                  <circle
                    cx={xAt(peak)} cy={yAt(points[peak].value)} r="4"
                    className="fill-sea-500 stroke-paper" strokeWidth="2"
                  />
                  <text
                    x={xAt(peak)} y={yAt(points[peak].value) - 10}
                    textAnchor="middle"
                    className="fill-ink-900 tnum text-[11px] font-bold"
                  >
                    {faNumber(points[peak].value)}
                  </text>
                </>
              )}
            </>
          )}

          {points.map((p, i) => {
            const last = points.length - 1
            // برچسبِ آخر فقط وقتی می‌آید که روی برچسبِ قبلی نیفتد.
            if (i % every !== 0 && !(i === last && last % every > every / 2)) return null
            return (
              <text
                key={p.date} x={xAt(i)} y={height - 8}
                textAnchor="middle" className="fill-ink-400 text-[10px]"
              >
                {faDay(p.date)}
              </text>
            )
          })}

          {tip && (
            <>
              <line
                x1={xAt(tip.index)} x2={xAt(tip.index)} y1={pad.top} y2={pad.top + plotH}
                className="stroke-ink-300" strokeWidth="1"
              />
              <circle
                cx={xAt(tip.index)} cy={yAt(points[tip.index].value)} r="4.5"
                className="fill-sea-500 stroke-paper" strokeWidth="2"
              />
            </>
          )}
        </svg>
      )}

      {tip && points[tip.index] && (
        <Tooltip
          tip={tip}
          width={width}
          title={faDay(points[tip.index].date, true)}
          lines={[{ label, value: faNumber(points[tip.index].value) }]}
        />
      )}
    </div>
  )
}

/* ---------------- نمودارِ ستونی ---------------- */

export type Column = { key: string; label: string; value: number }

/**
 * ستون‌ها همه یک رنگ‌اند و فقط بیشینه پررنگ می‌شود — «تأکید»، نه نردبانِ
 * رنگ. رنگی‌کردنِ هر ستون به‌اندازه‌ی مقدارش، همان چیزی را دوباره می‌گوید
 * که ارتفاعش گفته است.
 */
export function ColumnChart({
  columns, label, height = 168, labelEvery = 1,
}: {
  columns: Column[]
  label: string
  height?: number
  labelEvery?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)

  const pad = { top: 18, right: 8, bottom: 22, left: 8 }
  const plotW = Math.max(0, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const max = Math.max(1, ...columns.map((c) => c.value))
  const peak = columns.reduce((best, c, i) => (c.value > columns[best].value ? i : best), 0)
  const quiet = columns.every((c) => c.value === 0)

  const band = columns.length ? plotW / columns.length : 0
  // میله هرگز کلِ خانه را پر نمی‌کند و از ۲۴ پیکسل پهن‌تر نمی‌شود؛
  // فاصله‌ی بینشان را همان کاغذ می‌سازد، نه یک خطِ دورِ میله.
  const barW = Math.max(3, Math.min(24, band - 4))
  // آینه: خانه‌ی اول سمتِ راست.
  const xAt = (i: number) => pad.left + plotW - (i + 1) * band + (band - barW) / 2

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className={SVG_BOX}>
          <line
            x1={pad.left} x2={pad.left + plotW} y1={pad.top + plotH} y2={pad.top + plotH}
            className="stroke-sand-200" strokeWidth="1" shapeRendering="crispEdges"
          />
          {columns.map((c, i) => {
            const h = quiet ? 0 : Math.max(c.value > 0 ? 2 : 0, (c.value / max) * plotH)
            const isPeak = !quiet && i === peak && c.value > 0
            return (
              <g key={c.key}>
                {/* سطحِ لمس از خودِ میله بزرگ‌تر است: میله‌ی سه‌پیکسلی را
                    با انگشت نمی‌شود گرفت. */}
                <rect
                  x={pad.left + plotW - (i + 1) * band} y={pad.top}
                  width={band} height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setTip({ x: xAt(i) + barW / 2, y: pad.top + plotH - h, index: i })}
                  onPointerLeave={() => setTip(null)}
                />
                {h > 0 && (
                  <rect
                    x={xAt(i)} y={pad.top + plotH - h}
                    width={barW} height={h}
                    // سرِ میله گرد، پایش روی خطِ مبنا صاف
                    rx={Math.min(4, barW / 2)}
                    className={isPeak ? 'fill-sea-500' : 'fill-sea-500/35'}
                  />
                )}
                {isPeak && (
                  <text
                    x={xAt(i) + barW / 2} y={pad.top + plotH - h - 6}
                    textAnchor="middle" className="fill-ink-900 tnum text-[10.5px] font-bold"
                  >
                    {faNumber(c.value)}
                  </text>
                )}
                {i % labelEvery === 0 && (
                  <text
                    x={xAt(i) + barW / 2} y={height - 7}
                    textAnchor="middle" className="fill-ink-400 tnum text-[10px]"
                  >
                    {c.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {tip && columns[tip.index] && (
        <Tooltip
          tip={tip}
          width={width}
          title={columns[tip.index].label}
          lines={[{ label, value: faNumber(columns[tip.index].value) }]}
        />
      )}
    </div>
  )
}

/* ---------------- میله‌های سهم ---------------- */

export type ShareRow = { key: string | number; label: string; value: number; hint?: string }

/**
 * فهرستِ رتبه‌بندی‌شده با میله‌ی نسبت. عدد همیشه نوشته می‌شود، پس میله
 * تنها حاملِ معنا نیست — و همین است که اجازه می‌دهد مسیرِ میله کم‌رنگ باشد.
 */
export function ShareBars({ rows, unit }: { rows: ShareRow[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ol className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700">
              {row.label}
              {row.hint && <span className="text-ink-400"> · {row.hint}</span>}
            </span>
            <span className="tnum shrink-0 text-[13px] font-bold text-ink-900">
              {faNumber(row.value)}
              <span className="ms-1 text-[11px] font-normal text-ink-400">{unit}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sand-100">
            <div
              className="h-full rounded-full bg-sea-500"
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ---------------- کاشیِ عدد ---------------- */

/** خطِ کوچکِ روندِ همین معیار، پشتِ عدد. تزئین نیست: شکلِ بازه را می‌گوید. */
export function Sparkline({ values, width = 76, height = 26 }: {
  values: number[]
  width?: number
  height?: number
}) {
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const xAt = (i: number) => width - (i / (values.length - 1)) * width
  const yAt = (v: number) => height - 2 - (v / max) * (height - 4)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i)},${yAt(v)}`).join(' ')
  return (
    <svg width={width} height={height} aria-hidden="true" className="block shrink-0 overflow-visible">
      <path d={`${d} L${xAt(values.length - 1)},${height} L${xAt(0)},${height} Z`} className="fill-sea-500/10" />
      <path d={d} fill="none" className="stroke-sea-500" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xAt(values.length - 1)} cy={yAt(values[values.length - 1])} r="2.5" className="fill-sea-500" />
    </svg>
  )
}

export function StatTile({
  label, value, delta, values, hint,
}: {
  label: string
  value: number
  /** درصدِ تغییر نسبت به بازه‌ی پیش از این؛ `null` یعنی مبنایی نبوده */
  delta: number | null
  values?: number[]
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-sand-200 bg-paper p-4 sm:p-5">
      <p className="text-[12.5px] text-ink-500">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        {/* عددِ بزرگ با رقم‌های متناسب، نه جدولی: در این اندازه
            رقم‌های هم‌عرض عدد را شل نشان می‌دهند. */}
        <p className="text-[27px] font-bold leading-none text-ink-900">{faNumber(value)}</p>
        {values && values.length > 1 && <Sparkline values={values} />}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        {delta !== null && <DeltaChip delta={delta} />}
        {hint && <span className="text-ink-400">{hint}</span>}
      </div>
    </div>
  )
}

/** جهتِ تغییر با نشانه و متن گفته می‌شود، نه فقط با رنگ. */
function DeltaChip({ delta }: { delta: number }) {
  const flat = Math.abs(delta) < 1
  const tone = flat
    ? 'text-ink-400'
    : delta > 0
      ? 'text-sea-600 dark:text-sea-400'
      : 'text-ink-500'
  const sign = flat ? '' : delta > 0 ? '▲' : '▼'
  return (
    <span className={`tnum inline-flex items-center gap-1 ${tone}`}>
      <span aria-hidden="true">{sign}</span>
      {flat ? 'بی‌تغییر' : `${faNumber(Math.abs(Math.round(delta)))}٪`}
      <span className="text-ink-400">نسبت به بازهٔ قبل</span>
    </span>
  )
}
