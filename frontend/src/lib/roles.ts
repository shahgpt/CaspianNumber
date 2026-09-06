/* نام‌های فارسیِ نقش و مجوز — یک منبع، چون همین رشته‌ها هم در فرمِ ساخت
   حساب می‌آیند، هم در جدولِ کاربران، هم در چیپِ سربرگ و هم در دفترِ
   تغییرات. هرجا ثابتِ خامِ سرور به چشم کاربر برسد، غلط است. */

export type Role = 'UNIT_USER' | 'UNIT_MANAGER' | 'HEAD_OFFICE_ACCESS_ADMIN' | 'GLOBAL_ADMIN'

export const ROLE_LABELS: Record<Role, string> = {
  UNIT_USER: 'کاربر واحد',
  UNIT_MANAGER: 'مسئول واحد',
  HEAD_OFFICE_ACCESS_ADMIN: 'مدیر دسترسی دفتر مرکزی',
  GLOBAL_ADMIN: 'مدیر کل سامانه',
}

export const ROLE_NOTES: Record<Role, string> = {
  UNIT_USER: 'دفترچهٔ واحد خودش را می‌بیند؛ پنل مدیریت ندارد.',
  UNIT_MANAGER: 'در واحد خودش حساب می‌سازد و داده وارد می‌کند.',
  HEAD_OFFICE_ACCESS_ADMIN: 'مسئول دفتر مرکزی؛ به دادهٔ کارخانه‌ها دسترسی ندارد.',
  GLOBAL_ADMIN: 'دادهٔ همهٔ واحدها را می‌بیند و بین آن‌ها جابه‌جا می‌شود.',
}

export const ROLE_ORDER: Role[] = [
  'UNIT_USER',
  'UNIT_MANAGER',
  'HEAD_OFFICE_ACCESS_ADMIN',
  'GLOBAL_ADMIN',
]

/* این دو نقش فقط در دفتر مرکزی معنا دارند و فقط حساب مدیر سامانه می‌دهدشان.
   سرور هر دو شرط را جدا بررسی می‌کند؛ فرم هم نباید گزینه‌ای بسازد که رد شود. */
export const ELEVATED_ROLES: readonly Role[] = ['HEAD_OFFICE_ACCESS_ADMIN', 'GLOBAL_ADMIN']

export const isElevated = (role: Role): boolean => ELEVATED_ROLES.includes(role)

export const roleLabel = (role: string | null | undefined): string =>
  role ? ROLE_LABELS[role as Role] ?? role : '—'

export const PERMISSION_LABELS = {
  can_delete_data: 'حذف داده',
} as const

/** مدیر کل بدونِ این مجوز هم حذف می‌کند؛ تیکِ خاموش برایش دروغ است. */
export const deleteIsImplicit = (role: Role): boolean => role === 'GLOBAL_ADMIN'

/** سرور ترکیب‌های ناسازگار را رد می‌کند؛ فرم نباید اصلاً بسازدشان. */
export function normalizeAccess<T extends { role: Role; can_delete_data: boolean }>(draft: T): T {
  return {
    ...draft,
    can_delete_data: deleteIsImplicit(draft.role) ? true : draft.can_delete_data,
  }
}

/** نقش‌هایی که در این واحد و از این حساب واقعاً قابل انتخاب‌اند. */
export function assignableRoles(opts: {
  targetIsHeadOffice: boolean
  actorIsRoot: boolean
  keep?: Role
}): Role[] {
  return ROLE_ORDER.filter(
    (r) =>
      r === opts.keep ||
      !isElevated(r) ||
      (opts.targetIsHeadOffice && opts.actorIsRoot),
  )
}

export const ORGANIZATION_KINDS = {
  HEAD_OFFICE: 'دفتر مرکزی',
  FACTORY: 'کارخانه',
} as const

export const organizationKindLabel = (kind: string): string =>
  ORGANIZATION_KINDS[kind as keyof typeof ORGANIZATION_KINDS] ?? kind
