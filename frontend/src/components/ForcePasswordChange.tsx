import { useState } from 'react'
import { AlertCircle, Eye, EyeOff, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { api, setToken } from '../lib/api'
import { forgetSession } from '../lib/auth'
import { cn } from '../lib/utils'
import BrandLockup from './BrandLockup'
import ThemeToggle from './ThemeToggle'

type ForcePasswordChangeProps = {
  username: string
  onChanged: () => void
}

type PasswordFieldProps = {
  id: string
  label: string
  autoComplete: 'current-password' | 'new-password'
  value: string
  show: boolean
  invalid?: boolean
  describedBy?: string
  onChange: (value: string) => void
  onToggle: () => void
  autoFocus?: boolean
}

const fieldBase =
  'peer h-12 w-full rounded-xl border border-input bg-muted ps-11 pe-11 text-left text-[15px] text-foreground transition-[background-color,border-color,box-shadow] duration-200 focus:border-sea-500 focus:bg-paper focus:outline-none focus:ring-4 focus:ring-sea-500/20 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/15'

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  show,
  invalid = false,
  describedBy,
  onChange,
  onToggle,
  autoFocus = false,
}: PasswordFieldProps) {
  return (
    <div className="flex flex-col gap-2" data-invalid={invalid || undefined}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={show ? 'text' : 'password'}
          dir="ltr"
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          autoFocus={autoFocus}
          className={fieldBase}
        />
        <KeyRound
          strokeWidth={1.8}
          aria-hidden="true"
          className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink-400 transition-colors duration-200 peer-focus:text-sea-600"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? `پنهان کردن ${label}` : `نمایش ${label}`}
          aria-pressed={show}
          className="absolute end-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink-400 transition-colors duration-200 hover:bg-sand-100 hover:text-ink-700"
        >
          {show ? (
            <EyeOff strokeWidth={1.8} aria-hidden="true" className="size-[18px]" />
          ) : (
            <Eye strokeWidth={1.8} aria-hidden="true" className="size-[18px]" />
          )}
        </button>
      </div>
    </div>
  )
}

export default function ForcePasswordChange({
  username,
  onChanged,
}: ForcePasswordChangeProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const tooShort = newPassword.length > 0 && newPassword.length < 10
  const mismatch = confirmation.length > 0 && confirmation !== newPassword
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 10 &&
    confirmation === newPassword &&
    !loading

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setError('')
    setLoading(true)
    try {
      const result = await api<{ access_token: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      })
      setToken(result.access_token)
      onChanged()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'تغییر رمز انجام نشد. دوباره تلاش کنید.',
      )
      setLoading(false)
    }
  }

  function logout() {
    forgetSession()
    window.location.href = '/login'
  }

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-5 py-10">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(var(--tint)),transparent_58%)] opacity-80"
      />
      <div className="absolute end-5 top-5 sm:end-7 sm:top-7">
        <ThemeToggle />
      </div>

      <main
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-change-title"
        aria-describedby="password-change-description"
        className="relative w-full max-w-[460px] rounded-[28px] border border-border bg-paper p-6 shadow-panel sm:p-8"
      >
        <BrandLockup variant="compact" className="mb-7" />

        <div className="flex flex-col gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground">
            <ShieldCheck strokeWidth={1.8} aria-hidden="true" className="size-6" />
          </div>
          <div className="flex flex-col gap-2">
            <h1
              id="password-change-title"
              className="text-[24px] font-bold leading-9 tracking-[-0.025em] text-foreground"
            >
              رمز موقت را تغییر دهید
            </h1>
            <p id="password-change-description" className="text-[13px] leading-6 text-muted-foreground">
              برای امنیت حساب <bdi dir="ltr" className="font-medium text-foreground">{username}</bdi>،
              پیش از ورود به دفترچه یک رمز شخصی انتخاب کنید.
            </p>
          </div>
        </div>

        <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-4">
          <PasswordField
            id="current-password"
            label="رمز موقت فعلی"
            autoComplete="current-password"
            value={currentPassword}
            show={showPasswords}
            onChange={setCurrentPassword}
            onToggle={() => setShowPasswords((shown) => !shown)}
            autoFocus
          />

          <PasswordField
            id="new-password"
            label="رمز جدید"
            autoComplete="new-password"
            value={newPassword}
            show={showPasswords}
            invalid={tooShort}
            describedBy="new-password-hint"
            onChange={setNewPassword}
            onToggle={() => setShowPasswords((shown) => !shown)}
          />
          <p
            id="new-password-hint"
            className={cn(
              '-mt-2 text-[12px] leading-5 text-muted-foreground',
              tooShort && 'text-destructive',
            )}
          >
            رمز جدید باید حداقل ۱۰ کاراکتر باشد.
          </p>

          <PasswordField
            id="confirm-password"
            label="تکرار رمز جدید"
            autoComplete="new-password"
            value={confirmation}
            show={showPasswords}
            invalid={mismatch}
            describedBy={mismatch ? 'password-mismatch' : undefined}
            onChange={setConfirmation}
            onToggle={() => setShowPasswords((shown) => !shown)}
          />
          {mismatch ? (
            <p id="password-mismatch" className="-mt-2 text-[12px] text-destructive">
              تکرار رمز با رمز جدید یکسان نیست.
            </p>
          ) : null}

          {error ? (
            <div
              id="password-change-error"
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-[13px] leading-6 text-destructive"
            >
              <AlertCircle strokeWidth={1.9} aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-deep-900 text-[15px] font-bold text-paper transition-[background-color,transform] duration-200 hover:bg-deep-800 active:scale-[.985] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-sea-500 dark:text-deep-950 dark:hover:bg-sea-400"
          >
            {loading ? (
              <svg viewBox="0 0 24 24" fill="none" className="search-spinner size-5" aria-hidden="true">
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeOpacity="0.3"
                  strokeWidth="2.6"
                />
                <path
                  d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <ShieldCheck strokeWidth={2} aria-hidden="true" className="size-[18px]" />
            )}
            {loading ? 'در حال ذخیره…' : 'ذخیره رمز و ورود'}
          </button>

          <button
            type="button"
            onClick={logout}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl text-[13px] font-medium text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
          >
            <LogOut strokeWidth={1.8} aria-hidden="true" className="size-4" />
            خروج از حساب
          </button>
        </form>
      </main>
    </div>
  )
}
