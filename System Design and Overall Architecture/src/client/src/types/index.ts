/**
 * Shared DTO contract — the client mirror of what the server returns.
 *
 * Documents straight from MongoDB carry `_id`; the few shapes the server maps
 * by hand (search results, allocatable rooms) carry `id`. Getting this wrong
 * fails silently in JavaScript, so each type says which one it uses.
 */

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
export type RoomStatus = 'VACANT_CLEAN' | 'VACANT_DIRTY' | 'OCCUPIED' | 'INSPECTED' | 'OUT_OF_ORDER';
export type RoomEvent = 'CLEANED' | 'INSPECTION_PASSED' | 'INSPECTION_FAILED' | 'MARK_OUT_OF_ORDER' | 'REPAIRED';
export type PaymentMethod = 'CARD' | 'CASH' | 'BANK_TRANSFER' | 'E_WALLET' | 'VOUCHER' | 'LOYALTY_POINTS';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REVERSED';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ESCALATED';
export type LeaveType = 'ANNUAL' | 'SICK' | 'UNPAID' | 'MATERNITY';
export type RefundStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'REFUND_FAILED';
export type AccountStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED' | 'DEACTIVATED';

// --- Identity -------------------------------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; fullName: string; email: string; permissions: string[] };
}

/** GET /auth/me */
export interface Profile {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  status: AccountStatus;
  userType: 'Customer' | 'Employee' | 'User';
  roles: string[];
  permissions: string[];
  isStaff: boolean;
  loyalty?: { points: number; tier: string };
  employee?: {
    employeeCode: string;
    department: string;
    position: string;
    leaveBalance: { annual: number; sick: number };
  };
}

// --- Rooms ----------------------------------------------------------------

/** A RoomType document (`_id`). */
export interface RoomType {
  _id: string;
  name: string;
  description: string;
  capacity: number;
  basePrice: number;
  amenities: string[];
  images: string[];
  totalRooms: number;
  seasonalRates?: { from: string; to: string; price: number }[];
}

/** A Room document (`_id`); roomTypeId is populated where noted. */
export interface Room {
  _id: string;
  roomNumber: string;
  floor: number;
  status: RoomStatus;
  version: number;
  notes?: string;
  roomTypeId: RoomType | string;
}

/** Search result — mapped by the server, so `id`. */
export interface SearchResultItem {
  roomType: { id: string; name: string; description: string; capacity: number; amenities: string[]; images: string[] };
  availableCount: number;
  nights: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface SearchResponse {
  checkIn: string;
  checkOut: string;
  results: SearchResultItem[];
  count: number;
}

export interface SearchCriteria {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
}

/** GET /front-desk/allocatable — mapped, so `id`. */
export interface AllocatableRoom {
  id: string;
  roomNumber: string;
  floor: number;
  status: RoomStatus;
  /** Sent back with the check-in as the optimistic-lock guard (BR-25). */
  version: number;
}

// --- Bookings ---------------------------------------------------------------

export interface GuestDetails {
  fullName: string;
  email: string;
  phone: string;
  specialRequest?: string;
}

export interface Booking {
  _id: string;
  bookingCode: string;
  customerId?: string;
  guest: GuestDetails;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  status: BookingStatus;
  subtotal: number;
  discount: number;
  tax: number;
  totalAmount: number;
  nonRefundable?: boolean;
  actualCheckInAt?: string;
  actualCheckOutAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdAt: string;
  roomTypeId: RoomType | string;
  roomId?: Room | string | null;
}

export interface CreateBookingRequest {
  roomTypeId: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children?: number;
  roomCount?: number;
  guest: GuestDetails;
  addOnServices?: { serviceId: string; quantity: number }[];
  voucherCode?: string;
  paymentMethod: PaymentMethod;
}

export interface BookingConfirmation {
  bookingCode: string;
  status: BookingStatus;
  total: number;
  checkIn: string;
  checkOut: string;
  paymentUrl?: string;
  paymentPending?: boolean;
}

export interface CancellationOutcome {
  bookingCode: string;
  status: BookingStatus;
  refundable: number;
  requiresApproval: boolean;
  refundStatus: 'NONE' | 'ISSUED' | 'MANUAL_TRANSFER' | 'AWAITING_APPROVAL';
}

// --- Front desk -------------------------------------------------------------

export interface DeskOverview {
  date: string;
  arrivals: Booking[];
  inHouse: Booking[];
  departures: Booking[];
  rooms: Partial<Record<RoomStatus, number>>;
}

export interface CheckInRequest {
  bookingId: string;
  identity: {
    documentType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVING_LICENCE';
    documentNumber: string;
    fullName: string;
    dateOfBirth: string;
    expiryDate: string;
    nationality?: string;
  };
  roomId: string;
  roomVersion: number;
  depositAmount?: number;
}

export interface CheckInResult {
  bookingCode: string;
  status: BookingStatus;
  roomNumber: string;
  folioId: string;
  checkedInAt: string;
}

export interface CheckOutResult {
  bookingCode: string;
  status: BookingStatus;
  invoiceNumber: string;
  total: number;
  checkedOutAt: string;
}

export interface Charge {
  _id: string;
  type: 'ROOM' | 'SERVICE' | 'TAX' | 'DEPOSIT' | 'SURCHARGE' | 'DAMAGE' | 'DISCOUNT';
  description: string;
  amount: number;
  quantity: number;
  postedAt: string;
  isDisputed: boolean;
}

export interface PaymentRecord {
  _id: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  gatewayRef?: string;
  gatewayOrderCode?: number;
  qrCode?: string;
  checkoutUrl?: string;
  paidAt?: string;
  createdAt: string;
  reversalOfId?: string;
}

export interface Folio {
  _id: string;
  bookingId: string;
  status: 'OPEN' | 'CLOSED';
  totalCharges: number;
  totalPayments: number;
  balance: number;
  depositHeld: number;
  closedAt?: string;
}

export interface FolioView {
  folio: Folio;
  charges: Charge[];
  payments: PaymentRecord[];
  booking: Booking | null;
}

export interface DeskPaymentResult {
  paymentId: string;
  status: PaymentStatus;
  amount: number;
  balance: number;
  orderCode?: number;
  qrCode?: string;
  checkoutUrl?: string;
}

// --- payOS --------------------------------------------------------------------

export interface ReconcileResult {
  orderCode: number;
  paymentStatus: PaymentStatus;
  gatewayStatus: string;
  bookingStatus?: BookingStatus;
  bookingCode?: string;
}

// --- People & approvals -------------------------------------------------------

export interface PersonRef {
  _id: string;
  fullName: string;
  email?: string;
  position?: string;
  department?: string;
  leaveBalance?: { annual: number; sick: number };
}

export interface LeaveRequest {
  _id: string;
  employeeId: PersonRef | string;
  type: LeaveType;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  decidedAt?: string;
  decisionNote?: string;
  createdAt: string;
}

export interface RefundRequest {
  _id: string;
  referenceNumber: string;
  bookingId: (Pick<Booking, '_id' | 'bookingCode' | 'guest' | 'checkInDate' | 'checkOutDate' | 'totalAmount'>) | string;
  requestedBy?: PersonRef | string;
  requestedAmount: number;
  approvedAmount?: number;
  reasonCategory: string;
  description: string;
  status: RefundStatus;
  createdAt: string;
}

// --- Administration -------------------------------------------------------------

export interface RoleDoc {
  _id: string;
  name: string;
  description: string;
  permissions: string[];
  isSystemRole: boolean;
}

export interface Account {
  _id: string;
  fullName: string;
  email: string;
  phone?: string;
  status: AccountStatus;
  userType?: 'Customer' | 'Employee';
  roles: RoleDoc[];
  employeeCode?: string;
  department?: string;
  position?: string;
  lastLoginAt?: string;
  createdAt: string;
}

export interface AuditEntry {
  _id: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  ipAddress?: string;
  timestamp: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Works for both populated and bare references. */
export function refId(ref: { _id: string } | string | null | undefined): string | undefined {
  if (!ref) return undefined;
  return typeof ref === 'string' ? ref : ref._id;
}
