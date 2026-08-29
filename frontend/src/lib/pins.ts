/* پین‌ها روی همین مرورگر می‌مانند، به‌نامِ همان کسی که وارد شده — تا
   روی یک دستگاهِ مشترک، فهرستِ نفرِ قبلی به نفرِ بعدی نچسبد. */

function key(): string {
  return `cn_pins:${localStorage.getItem('cn_username') ?? '-'}`
}

export function readPins(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(key()) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((n) => typeof n === 'number') : [])
  } catch {
    return new Set()
  }
}

export function writePins(ids: Set<number>): void {
  try {
    localStorage.setItem(key(), JSON.stringify([...ids]))
  } catch {
    // حالتِ خصوصیِ سافاری سهمیه نمی‌دهد — پین‌ها همین نشست می‌مانند
  }
}
