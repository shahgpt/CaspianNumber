/* مرتب‌سازی و جستجوی سمتِ کاربر برای جدول‌های پنل مدیریت.

   جدول‌های این پنل همه‌ی ردیف‌هایشان را یک‌جا می‌گیرند — سرور صفحه‌بندی‌شان
   نمی‌کند — پس صافی و ترتیب همین‌جا در حافظه انجام می‌شود و هیچ رفت‌وبرگشتی
   لازم ندارد. سه چیز را این فایل درست نگه می‌دارد:

   ۱. «محمّد» و «محمد»، «ي» و «ی»، «۲۱۸» و «218» باید یکدیگر را پیدا کنند.
   ۲. ترتیبِ الفبایی فارسی است، نه ترتیبِ کدِ یونیکد: `localeCompare('fa')`.
   ۳. ستونِ عددی مثل داخلی، عددی مرتب می‌شود — وگرنه «۱۰۰» قبل از «۹» می‌آید.
*/

export type SortDir = 'asc' | 'desc'

export type Sort<K extends string> = {
  key: K
  dir: SortDir
}

const ARABIC_TO_PERSIAN: Record<string, string> = {
  'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ی',
}

/** یک شکلِ واحد برای مقایسه: رقمِ لاتین، حرفِ فارسی، بدون اعراب و نیم‌فاصله. */
export function normalize(value: unknown): string {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[يكةأإآؤئ]/g, (c) => ARABIC_TO_PERSIAN[c] ?? c)
    // اعراب و کشیده و نیم‌فاصله: در تایپ هست، در ذهنِ جستجوکننده نیست
    .replace(/[ً-ْـ‌‏‎]/g, '')
    .toLowerCase()
    .trim()
}

/** آیا این ردیف با عبارتِ جستجو می‌خواند؟ همه‌ی واژه‌ها باید جایی پیدا شوند. */
export function matches(haystack: string[], query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const hay = haystack.map(normalize).join(' ')
  return terms.every((term) => hay.includes(term))
}

/** رشته‌ای که فقط رقم است، عدد است — و عددها عددی مقایسه می‌شوند. */
function numeric(value: string): number | null {
  const digits = normalize(value).replace(/[\s-]/g, '')
  return digits !== '' && /^\d+$/.test(digits) ? Number(digits) : null
}

export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Number(Boolean(b)) - Number(Boolean(a))
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b

  const left = String(a ?? '')
  const right = String(b ?? '')
  // ردیفِ بی‌مقدار ته فهرست می‌ماند، در هر دو جهت — جای خالی خبر نیست.
  if (!left.trim() && !right.trim()) return 0
  if (!left.trim()) return 1
  if (!right.trim()) return -1

  const [ln, rn] = [numeric(left), numeric(right)]
  if (ln !== null && rn !== null) return ln - rn

  return normalize(left).localeCompare(normalize(right), 'fa', { numeric: true })
}

/**
 * کپیِ مرتب‌شده. ردیفِ خالی همیشه ته فهرست می‌ماند، پس `desc` وارونه‌ی
 * ساده‌ی `asc` نیست و مقایسه‌ی بی‌مقدارها از وارونه‌سازی مستثناست.
 */
export function sortRows<T>(
  rows: readonly T[],
  valueOf: (row: T) => unknown,
  dir: SortDir,
): T[] {
  const flip = dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const [va, vb] = [valueOf(a), valueOf(b)]
    const emptyA = va === null || va === undefined || String(va).trim() === ''
    const emptyB = vb === null || vb === undefined || String(vb).trim() === ''
    if (emptyA !== emptyB) return emptyA ? 1 : -1
    return compareValues(va, vb) * flip
  })
}

/** کلیک روی همان ستون جهت را برمی‌گرداند؛ ستونِ تازه از «صعودی» شروع می‌کند. */
export function nextSort<K extends string>(current: Sort<K>, key: K): Sort<K> {
  return current.key === key
    ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' }
}
