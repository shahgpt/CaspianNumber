/* قالبِ عدد و تاریخ برای نمایش.

   `faDigits` در `motion.ts` فقط رقم را عوض می‌کند. اینجا جداکننده‌ی هزار و
   تقویم هم لازم است، و هر دو را خودِ مرورگر با locale فارسی می‌دهد — پس
   نه جدولِ ماه‌های شمسی لازم است نه شمارشِ دستیِ سه‌رقمی. */

/** «۱۲۳٬۴۵۶» — با جداکننده‌ی هزارِ فارسی. */
export const faNumber = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString('fa-IR') : '—'

/**
 * تاریخِ شمسی از یک روزِ `YYYY-MM-DD`.
 *
 * وقتِ نیمه‌شبِ محلی صریح چسبانده می‌شود: `new Date('2026-09-21')` را
 * مرورگر UTC می‌خواند و در ایران یک روز عقب نشان می‌دهد.
 */
export function faDay(iso: string, long = false): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('fa-IR', long
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'short' })
}
