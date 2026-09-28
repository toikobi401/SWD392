/**
 * Typed endpoint functions — one per use case, named after it.
 *
 * Grouping them this way keeps the §9 traceability readable from the client
 * side too: a page calls `bookingApi.create`, which is UC-G07.
 */
import { api, tokenStore } from './client';
import type {
  AuthTokens,
  AuthUser,
  Booking,
  BookingConfirmation,
  CancellationOutcome,
  CheckInRequest,
  CheckInResult,
  CheckOutResult,
  CreateBookingRequest,
  AllocatableRoom,
  LeaveRequestDto,
  ReconcileResult,
  RefundRequestDto,
  RoomRackResponse,
  RoomTypeSummary,
  SearchCriteria,
  SearchResponse,
} from '../types';

export const authApi = {
  /** UC-G16 Register Account */
  async register(payload: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
    acceptedTerms: boolean;
  }) {
    const { data } = await api.post('/auth/register', payload);
    return data;
  },

  /** UC-G17 Login */
  async login(email: string, password: string): Promise<AuthTokens> {
    const { data } = await api.post<AuthTokens>('/auth/login', { email, password });
    tokenStore.set(data);
    return data;
  },

  /** UC-C04 Logout */
  async logout(): Promise<void> {
    await api.post('/auth/logout').catch(() => undefined);
    tokenStore.clear();
  },

  /** UC-C03 Reset Forgotten Password */
  async forgotPassword(email: string, channel: 'EMAIL' | 'SMS' = 'EMAIL') {
    const { data } = await api.post('/auth/forgot-password', { email, channel });
    return data;
  },

  async resetPassword(email: string, otp: string, newPassword: string) {
    const { data } = await api.post('/auth/reset-password', { email, otp, newPassword });
    return data;
  },

  /** UC-C05 Change Password */
  async changePassword(currentPassword: string, newPassword: string) {
    const { data } = await api.post('/auth/change-password', {
      currentPassword,
      newPassword,
    });
    return data;
  },

  async me(): Promise<AuthUser & { roles: string[] }> {
    const { data } = await api.get('/auth/me');
    return data;
  },
};

export const roomApi = {
  /** UC-G01 Search Available Rooms */
  async search(criteria: SearchCriteria): Promise<SearchResponse> {
    const { data } = await api.get<SearchResponse>('/rooms/search', { params: criteria });
    return data;
  },

  /** UC-G02 View Room / Room Type Details */
  async detail(id: string): Promise<RoomTypeSummary> {
    const { data } = await api.get<RoomTypeSummary>(`/room-types/${id}`);
    return data;
  },
};

export const bookingApi = {
  /** UC-G07 Book Room */
  async create(payload: CreateBookingRequest): Promise<BookingConfirmation> {
    const { data } = await api.post<BookingConfirmation>('/bookings', payload);
    return data;
  },

  /** UC-G13 Check Booking Status — anonymous lookup by code + email */
  async lookup(code: string, email: string): Promise<Booking> {
    const { data } = await api.get<Booking>('/bookings/lookup', { params: { code, email } });
    return data;
  },

  /** UC-C11 View Booking History */
  async mine(): Promise<{ bookings: Booking[]; count: number }> {
    const { data } = await api.get('/me/bookings');
    return data;
  },

  /** UC-C12 / UC-R02 View Booking Details */
  async detail(id: string): Promise<Booking> {
    const { data } = await api.get<Booking>(`/bookings/${id}`);
    return data;
  },

  /** UC-G14 Cancel Booking */
  async cancel(id: string, reason?: string): Promise<CancellationOutcome> {
    const { data } = await api.post<CancellationOutcome>(`/bookings/${id}/cancel`, { reason });
    return data;
  },
};

export const paymentApi = {
  /** UC-G10 alt. flow 1.3 — the server asks payOS for the real status. */
  async reconcile(orderCode: number): Promise<ReconcileResult> {
    const { data } = await api.get<ReconcileResult>(`/payments/payos/${orderCode}/reconcile`);
    return data;
  },
};

export const frontDeskApi = {
  /** UC-R01 Search / Look Up Booking */
  async searchBooking(q: string): Promise<{ bookings: Booking[]; count: number }> {
    const { data } = await api.get('/front-desk/bookings', { params: { q } });
    return data;
  },

  /** UC-R06 step 6 — the rooms a receptionist may allocate */
  async allocatableRooms(
    roomTypeId: string,
    floor?: number,
  ): Promise<{ rooms: AllocatableRoom[] }> {
    const { data } = await api.get('/front-desk/allocatable', {
      params: { roomTypeId, floor },
    });
    return data;
  },

  /** UC-R06 Check In Guest */
  async checkIn(payload: CheckInRequest): Promise<CheckInResult> {
    const { data } = await api.post<CheckInResult>('/front-desk/check-in', payload);
    return data;
  },

  /** UC-R09 Check Out Guest */
  async checkOut(
    bookingId: string,
    options?: { lateCheckoutSurcharge?: number; waiveSurcharge?: boolean },
  ): Promise<CheckOutResult> {
    const { data } = await api.post<CheckOutResult>('/front-desk/check-out', {
      bookingId,
      ...options,
    });
    return data;
  },

  /** UC-R12 View Room Availability */
  async roomRack(): Promise<RoomRackResponse> {
    const { data } = await api.get<RoomRackResponse>('/rooms/availability');
    return data;
  },

  /** UC-R13 Update Room Status */
  async updateRoomStatus(roomId: string, event: string, notes?: string) {
    const { data } = await api.patch(`/rooms/${roomId}/status`, { event, notes });
    return data;
  },

  /** UC-R15 Process Payment */
  async takePayment(folioId: string, amount: number, method: string, idempotencyKey: string) {
    const { data } = await api.post(`/folios/${folioId}/payments`, {
      amount,
      method,
      idempotencyKey,
    });
    return data;
  },
};

export const approvalApi = {
  /** UC-M06 queue */
  async pendingLeave(department: string): Promise<{ requests: LeaveRequestDto[] }> {
    const { data } = await api.get('/leave-requests/pending', { params: { department } });
    return data;
  },

  /** UC-M06 Approve / Reject Leave Request */
  async decideLeave(
    id: string,
    approve: boolean,
    options?: { note?: string; coverageOverrideJustification?: string; partialToDate?: string },
  ) {
    const { data } = await api.patch(`/leave-requests/${id}/decision`, {
      approve,
      ...options,
    });
    return data;
  },

  /** UC-M14 queue */
  async pendingRefunds(): Promise<{ requests: RefundRequestDto[] }> {
    const { data } = await api.get('/refund-requests/pending');
    return data;
  },

  /** UC-M14 Approve Refund Request */
  async decideRefund(
    id: string,
    approve: boolean,
    options?: { approvedAmount?: number; note?: string },
  ) {
    const { data } = await api.patch(`/refund-requests/${id}/decision`, {
      approve,
      ...options,
    });
    return data;
  },

  /** UC-C17 Request Refund */
  async requestRefund(payload: {
    bookingId: string;
    amount: number;
    reasonCategory: string;
    description?: string;
  }) {
    const { data } = await api.post('/refund-requests', payload);
    return data;
  },
};

export const leaveApi = {
  /** UC-E15 Submit Leave Request */
  async submit(payload: {
    type: string;
    fromDate: string;
    toDate: string;
    reason: string;
  }): Promise<LeaveRequestDto> {
    const { data } = await api.post<LeaveRequestDto>('/leave-requests', payload);
    return data;
  },

  /** UC-E16 Cancel Leave Request */
  async cancel(id: string) {
    const { data } = await api.post(`/leave-requests/${id}/cancel`);
    return data;
  },
};
