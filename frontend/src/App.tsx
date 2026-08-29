import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Login from './pages/Login'
import Directory from './pages/Directory'
import Admin from './pages/Admin'
import { getToken } from './lib/api'
import { fetchSession } from './lib/auth'

/* دفترچه پشتِ ورود است: هر کارمند حسابِ خودش را دارد و بدون آن هیچ
   شماره‌ای دیده نمی‌شود. `/login` دروازه‌ی همه است، نه فقط مدیر. */

type Verdict = 'checking' | 'allowed' | 'denied'

/**
 * گاردِ مسیرها. عمداً به localStorage تکیه نمی‌کند — آن را هر کسی با یک
 * خط در کنسول عوض می‌کند. تنها مرجع، پاسخِ /api/auth/me است که روی
 * توکنِ امضاشده تصمیم می‌گیرد. (سرور هم مستقلاً هر مسیرِ /api را می‌بندد؛
 * این گارد فقط جلوی دیده‌شدنِ پوسته را می‌گیرد.)
 *
 * `admin` یعنی نشستِ معتبر کافی نیست و باید `is_admin` هم داشته باشد.
 */
function Require({ admin = false, children }: { admin?: boolean; children: React.ReactNode }) {
  const location = useLocation()
  // بدون توکن اصلاً لازم نیست از سرور بپرسیم — همان‌جا رد است
  const [status, setStatus] = useState<Verdict>(getToken() ? 'checking' : 'denied')

  useEffect(() => {
    if (status !== 'checking') return
    let alive = true
    fetchSession().then((s) => {
      if (!alive) return
      setStatus(s && (!admin || s.is_admin) ? 'allowed' : 'denied')
    })
    return () => {
      alive = false
    }
  }, [status, admin])

  if (status === 'checking') return <GateSplash />
  if (status === 'denied') {
    // کاربرِ عادی که در پنل را زده، توکنِ درستی دارد — بیرون انداختنش به
    // صفحه‌ی ورود گیجش می‌کند. او را به دفترچه برمی‌گردانیم.
    const to = admin && getToken() ? '/' : '/login'
    return <Navigate to={to} replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

/** فاصله‌ی کوتاهِ بینِ پرسش و پاسخِ سرور — نه صفحه‌ی سفید، نه اسپینرِ
    پرسروصدا. لحظه‌ی انتظار جای درستِ نشان است: تنها چیزی که هست، برند. */
function GateSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[rgb(var(--canvas))]">
      <div className="flex flex-col items-center gap-5" role="status">
        <img
          src="/brand-mark.png"
          alt=""
          aria-hidden="true"
          width={384}
          height={384}
          fetchPriority="high"
          className="brand-mark brand-breathe h-auto w-[58px]"
        />
        <p className="text-[13px] text-ink-500">در حال بررسی دسترسی…</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Require>
            <Directory />
          </Require>
        }
      />
      <Route
        path="/admin"
        element={
          <Require admin>
            <Admin />
          </Require>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
