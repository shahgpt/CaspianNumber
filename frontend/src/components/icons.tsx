/**
 * آیکون‌های خطی هم‌خانواده (stroke 1.8، گرد) — همه از یک گرید ۲۴px.
 * هیچ ایموجی‌ای در UI استفاده نمی‌شود.
 */
type P = { className?: string }
const base = 'shrink-0'

function Svg({ className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${base} ${className ?? 'w-5 h-5'}`}
    >
      {children}
    </svg>
  )
}

export const PhoneIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 4.8c-.9.9-1.2 2.2-.8 3.4a26 26 0 0 0 12.1 12.1c1.2.4 2.5.1 3.4-.8l1-1c.7-.7.6-1.9-.2-2.5l-2.9-2.1a1.7 1.7 0 0 0-2 .05l-1 .8a19 19 0 0 1-4.9-4.9l.8-1c.5-.6.55-1.45.05-2L8.05 4.5c-.6-.8-1.8-.9-2.5-.2l-1.05.5Z" />
  </Svg>
)

export const ChatIcon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" />
    <path d="M8.5 10.5h7M8.5 13.5h4" />
  </Svg>
)

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.4-3.4" />
  </Svg>
)

export const UserPlusIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9.5" cy="8" r="3.5" />
    <path d="M3.5 20c.6-3.4 3-5.2 6-5.2 1 0 2 .2 2.8.65M17 14v6M14 17h6" />
  </Svg>
)

export const UploadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 15V4m0 0L8 8m4-4 4 4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
)

/** جرقه — نشانه‌ی متنی که ماشین نوشته، نه آدم. */
export const SparkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M13 3.5 14.6 8 19 9.6 14.6 11.2 13 15.7 11.4 11.2 7 9.6 11.4 8 13 3.5Z" />
    <path d="M6.5 15.5 7.2 17.3 9 18l-1.8.7-.7 1.8-.7-1.8L4 18l1.8-.7.7-1.8Z" />
  </Svg>
)

export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const SendIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 12H4m0 0 6-6m-6 6 6 6" />
  </Svg>
)

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 13 4 4L19 7" />
  </Svg>
)

export const PersonIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20c.7-3.8 3.4-5.8 7-5.8s6.3 2 7 5.8" />
  </Svg>
)

export const LogoutIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10" />
  </Svg>
)

export const BookIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13.5H6.5A1.5 1.5 0 0 0 5 19V5.5Z" />
    <path d="M5 19a1.5 1.5 0 0 0 1.5 1.5H19" />
    <path d="M9 8.5h6M9 12h4" />
  </Svg>
)

export const ShieldIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 5 6v6c0 4.4 3 7.6 7 8.5 4-.9 7-4.1 7-8.5V6l-7-2.5Z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </Svg>
)
