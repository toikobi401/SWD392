/**
 * Formatting and the plain-language names shown for system states.
 * Amounts travel as integer VND; they are formatted only here, at render.
 */

const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
export const money = (n: number | undefined | null) => vnd.format(n ?? 0);

/**
 * Stay dates are UTC midnights of a calendar date ("2026-09-29T00:00:00Z"), so
 * they are rendered in UTC — rendering in local time would shift them a day
 * for anyone west of Greenwich.
 */
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const whenFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
});

export const stayDate = (iso?: string) => (iso ? dayFmt.format(new Date(iso)) : '—');
export const stayDateShort = (iso?: string) => (iso ? dayShort.format(new Date(iso)) : '—');
/** Real instants (check-in time, audit entries) in hotel time. */
export const when = (iso?: string) => (iso ? whenFmt.format(new Date(iso)) : '—');

export const nights = (checkIn: string, checkOut: string) =>
  Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);

export const stayRange = (checkIn: string, checkOut: string) => {
  const n = nights(checkIn, checkOut);
  return `${stayDateShort(checkIn)} – ${stayDate(checkOut)}, ${n} night${n === 1 ? '' : 's'}`;
};

/** Hotel "today" as YYYY-MM-DD in Asia/Ho_Chi_Minh — what the date inputs use. */
export function hotelTodayISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
}

export const BOOKING_STATUS: Record<string, string> = {
  PENDING: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'In house',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

export const ROOM_STATUS: Record<string, string> = {
  VACANT_CLEAN: 'Clean',
  VACANT_DIRTY: 'Needs cleaning',
  OCCUPIED: 'Occupied',
  INSPECTED: 'Cleaned, to inspect',
  OUT_OF_ORDER: 'Out of order',
};

/** Short labels for the key fobs, where space is tight. */
export const ROOM_STATUS_SHORT: Record<string, string> = {
  VACANT_CLEAN: 'Clean',
  VACANT_DIRTY: 'Dirty',
  OCCUPIED: 'Guest',
  INSPECTED: 'Inspect',
  OUT_OF_ORDER: 'Repair',
};

export const LEAVE_STATUS: Record<string, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Withdrawn',
  ESCALATED: 'Escalated',
};

export const LEAVE_TYPE: Record<string, string> = {
  ANNUAL: 'Annual leave',
  SICK: 'Sick leave',
  UNPAID: 'Unpaid leave',
  MATERNITY: 'Maternity leave',
};

export const REFUND_STATUS: Record<string, string> = {
  PENDING: 'Waiting for review',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  COMPLETED: 'Refunded',
  REFUND_FAILED: 'Approved — transfer by hand',
};

export const PAYMENT_STATUS: Record<string, string> = {
  PENDING: 'Waiting',
  PAID: 'Paid',
  FAILED: 'Failed',
  REVERSED: 'Refunded',
};

export const PAYMENT_METHOD: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'payOS transfer',
  E_WALLET: 'E-wallet',
  VOUCHER: 'Voucher',
  LOYALTY_POINTS: 'Points',
};

export const ACCOUNT_STATUS: Record<string, string> = {
  PENDING_VERIFICATION: 'Email not verified',
  ACTIVE: 'Active',
  LOCKED: 'Locked',
  DEACTIVATED: 'Deactivated',
};

export const ROLE_NAME: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  RECEPTIONIST: 'Receptionist',
  EMPLOYEE: 'Employee',
  CUSTOMER: 'Customer',
  GUEST: 'Guest',
};

/** Plain names for permissions, as the roles screen shows them. */
export const PERMISSION: Record<string, string> = {
  BOOKING_READ: 'View any booking',
  BOOKING_CREATE: 'Create bookings',
  BOOKING_MODIFY: 'Change any booking',
  BOOKING_CANCEL: 'Cancel bookings',
  CHECK_IN: 'Check guests in',
  CHECK_OUT: 'Check guests out',
  ROOM_STATUS_UPDATE: 'Update room status',
  PROCESS_PAYMENT: 'Take payments',
  PROCESS_REFUND: 'Issue refunds',
  APPROVE_LEAVE: 'Approve leave',
  APPROVE_REFUND: 'Approve refunds',
  APPROVE_PAYROLL: 'Approve payroll',
  MANAGE_INVENTORY: 'Manage rooms',
  MANAGE_PRICING: 'Manage prices',
  VIEW_REPORTS: 'View reports',
  MANAGE_ACCOUNTS: 'Manage accounts',
  MANAGE_ROLES: 'Manage roles',
  MANAGE_SETTINGS: 'Manage settings',
  VIEW_AUDIT_LOG: 'View audit log',
  MANAGE_BACKUP: 'Manage backups',
};

export const PERMISSION_GROUPS: { title: string; items: string[] }[] = [
  { title: 'Bookings', items: ['BOOKING_READ', 'BOOKING_CREATE', 'BOOKING_MODIFY', 'BOOKING_CANCEL'] },
  { title: 'Front desk', items: ['CHECK_IN', 'CHECK_OUT', 'ROOM_STATUS_UPDATE', 'PROCESS_PAYMENT', 'PROCESS_REFUND'] },
  { title: 'Management', items: ['APPROVE_LEAVE', 'APPROVE_REFUND', 'APPROVE_PAYROLL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_REPORTS'] },
  { title: 'Administration', items: ['MANAGE_ACCOUNTS', 'MANAGE_ROLES', 'MANAGE_SETTINGS', 'VIEW_AUDIT_LOG', 'MANAGE_BACKUP'] },
];

/** Turns an audit action like GUEST_CHECKED_IN into "Guest checked in". */
export const humanize = (code: string) =>
  code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

/** A fresh idempotency key for a payment attempt (BR-15). */
export const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
