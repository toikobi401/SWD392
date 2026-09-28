/**
 * Shared DTO contract — the client mirror of server/src/dto.
 *
 * §7.4.1 draws this as the «shared contract» dependency: the client's `types`
 * package and the server's `dto` package describe the same wire shapes. Keeping
 * them as plain types (no runtime import across the boundary) is what lets the
 * two halves deploy independently.
 */

export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';

export type RoomStatus =
  | 'VACANT_CLEAN'
  | 'VACANT_DIRTY'
  | 'OCCUPIED'
  | 'INSPECTED'
  | 'OUT_OF_ORDER';

export type PaymentMethod =
  | 'CARD'
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'E_WALLET'
  | 'VOUCHER'
  | 'LOYALTY_POINTS';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ESCALATED';
export type RefundStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'REFUND_FAILED';

// --- Auth (UC-G16, UC-G17) -------------------------------------------------

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  permissions: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

// --- Search & booking (UC-G01, UC-G07) -------------------------------------

export interface RoomTypeSummary {
  id: string;
  name: string;
  description: string;
  capacity: number;
  amenities: string[];
  images: string[];
}

export interface SearchResultItem {
  roomType: RoomTypeSummary;
  availableCount: number;
  nights: number;
  /** All amounts are integer minor units, as on the server (§8.1 Integrity). */
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

export interface GuestDetails {
  fullName: string;
  email: string;
  phone: string;
  specialRequest?: string;
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
  /** Gateway outcome not yet known — the booking is PENDING (UC-G10 1.0.E3). */
  paymentPending?: boolean;
}

export interface Booking {
  _id: string;
  bookingCode: string;
  guest: GuestDetails;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  status: BookingStatus;
  totalAmount: number;
  roomTypeId: RoomTypeSummary | string;
}

export interface CancellationOutcome {
  bookingCode: string;
  status: BookingStatus;
  refundable: number;
  requiresApproval: boolean;
  /** payOS has no refund API, so a gateway refund is a MANUAL_TRANSFER. */
  refundStatus: 'NONE' | 'ISSUED' | 'MANUAL_TRANSFER' | 'AWAITING_APPROVAL';
}

// --- payOS (UC-G10) ------------------------------------------------------

export interface ReconcileResult {
  orderCode: number;
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REVERSED';
  /** payOS link status: PENDING, PROCESSING, PAID, UNDERPAID, CANCELLED, EXPIRED, FAILED. */
  gatewayStatus: string;
  bookingStatus?: BookingStatus;
  bookingCode?: string;
}

// --- Front desk (UC-R06, UC-R09, UC-R12) -----------------------------------

export interface AllocatableRoom {
  id: string;
  roomNumber: string;
  floor: number;
  status: RoomStatus;
  /** Round-tripped to the check-in call as the optimistic-lock guard (BR-25). */
  version: number;
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

export interface RoomRackResponse {
  rooms: (AllocatableRoom & { roomTypeId: RoomTypeSummary })[];
  summary: Record<string, number>;
  total: number;
}

// --- Approvals (UC-M06, UC-M14, UC-C17) ------------------------------------

export interface LeaveRequestDto {
  _id: string;
  employeeId: string;
  type: 'ANNUAL' | 'SICK' | 'UNPAID' | 'MATERNITY';
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
}

export interface RefundRequestDto {
  _id: string;
  referenceNumber: string;
  requestedAmount: number;
  approvedAmount?: number;
  reasonCategory: string;
  description: string;
  status: RefundStatus;
}

// --- Errors ----------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
