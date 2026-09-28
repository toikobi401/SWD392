/**
 * Typed endpoint functions — one per server route, grouped by who uses them.
 * Pages never call axios directly; they go through these (and the hooks).
 */
import { api, tokenStore } from './client';
import type {
  Account,
  AllocatableRoom,
  AuditEntry,
  AuthTokens,
  Booking,
  BookingConfirmation,
  CancellationOutcome,
  CheckInRequest,
  CheckInResult,
  CheckOutResult,
  CreateBookingRequest,
  DeskOverview,
  DeskPaymentResult,
  FolioView,
  LeaveRequest,
  LeaveType,
  PaymentMethod,
  Profile,
  ReconcileResult,
  RefundRequest,
  RoleDoc,
  Room,
  RoomEvent,
  RoomType,
  SearchCriteria,
  SearchResponse,
} from '../types';

export const authApi = {
  async register(payload: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
    acceptedTerms: boolean;
  }): Promise<{ message: string }> {
    return (await api.post('/auth/register', payload)).data;
  },
  async verify(token: string): Promise<{ message: string }> {
    return (await api.get('/auth/verify', { params: { token } })).data;
  },
  async login(email: string, password: string): Promise<AuthTokens> {
    const { data } = await api.post<AuthTokens>('/auth/login', { email, password });
    tokenStore.set(data);
    return data;
  },
  async logout(): Promise<void> {
    await api.post('/auth/logout').catch(() => undefined);
    tokenStore.clear();
  },
  async forgotPassword(email: string, channel: 'EMAIL' | 'SMS' = 'EMAIL'): Promise<{ message: string }> {
    return (await api.post('/auth/forgot-password', { email, channel })).data;
  },
  async resetPassword(email: string, otp: string, newPassword: string): Promise<{ message: string }> {
    return (await api.post('/auth/reset-password', { email, otp, newPassword })).data;
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return (await api.post('/auth/change-password', { currentPassword, newPassword })).data;
  },
  async me(): Promise<Profile> {
    return (await api.get<Profile>('/auth/me')).data;
  },
};

export const roomApi = {
  async search(criteria: SearchCriteria): Promise<SearchResponse> {
    return (await api.get<SearchResponse>('/rooms/search', { params: criteria })).data;
  },
  async types(): Promise<RoomType[]> {
    return (await api.get<{ roomTypes: RoomType[] }>('/room-types')).data.roomTypes;
  },
  async type(id: string): Promise<RoomType> {
    return (await api.get<RoomType>(`/room-types/${id}`)).data;
  },
};

export const bookingApi = {
  async create(payload: CreateBookingRequest): Promise<BookingConfirmation> {
    return (await api.post<BookingConfirmation>('/bookings', payload)).data;
  },
  async lookup(code: string, email: string): Promise<Booking> {
    return (await api.get<Booking>('/bookings/lookup', { params: { code, email } })).data;
  },
  async mine(): Promise<Booking[]> {
    return (await api.get<{ bookings: Booking[] }>('/me/bookings')).data.bookings;
  },
  async detail(id: string): Promise<Booking> {
    return (await api.get<Booking>(`/bookings/${id}`)).data;
  },
  async cancel(id: string, reason?: string): Promise<CancellationOutcome> {
    return (await api.post<CancellationOutcome>(`/bookings/${id}/cancel`, { reason })).data;
  },
  async requestRefund(payload: { bookingId: string; amount: number; reasonCategory: string; description?: string }) {
    return (await api.post<{ referenceNumber: string; status: string }>('/refund-requests', payload)).data;
  },
};

export const paymentApi = {
  async reconcile(orderCode: number): Promise<ReconcileResult> {
    return (await api.get<ReconcileResult>(`/payments/payos/${orderCode}/reconcile`)).data;
  },
  async registerWebhook(webhookUrl: string): Promise<{ message: string }> {
    return (await api.post('/payments/payos/confirm-webhook', { webhookUrl })).data;
  },
};

export const deskApi = {
  async overview(): Promise<DeskOverview> {
    return (await api.get<DeskOverview>('/front-desk/overview')).data;
  },
  async search(q: string): Promise<Booking[]> {
    return (await api.get<{ bookings: Booking[] }>('/front-desk/bookings', { params: { q } })).data.bookings;
  },
  async folioIdFor(bookingId: string): Promise<string | null> {
    return (await api.get<{ folioId: string | null }>(`/front-desk/bookings/${bookingId}/folio`)).data.folioId;
  },
  async allocatable(roomTypeId: string, floor?: number): Promise<AllocatableRoom[]> {
    return (await api.get<{ rooms: AllocatableRoom[] }>('/front-desk/allocatable', { params: { roomTypeId, floor } })).data.rooms;
  },
  async checkIn(payload: CheckInRequest): Promise<CheckInResult> {
    return (await api.post<CheckInResult>('/front-desk/check-in', payload)).data;
  },
  async checkOut(bookingId: string, options: { lateCheckoutSurcharge?: number; waiveSurcharge?: boolean } = {}): Promise<CheckOutResult> {
    return (await api.post<CheckOutResult>('/front-desk/check-out', { bookingId, ...options })).data;
  },
  async rack(): Promise<{ rooms: Room[]; summary: Record<string, number>; total: number }> {
    return (await api.get('/rooms/availability')).data;
  },
  async setRoomStatus(roomId: string, event: RoomEvent, notes?: string): Promise<{ status: string }> {
    return (await api.patch(`/rooms/${roomId}/status`, { event, notes })).data;
  },
  async folio(folioId: string): Promise<FolioView> {
    return (await api.get<FolioView>(`/folios/${folioId}`)).data;
  },
  async postCharge(folioId: string, charge: { type: string; description: string; amount: number; quantity: number }) {
    return (await api.post(`/folios/${folioId}/charges`, charge)).data;
  },
  async takePayment(folioId: string, amount: number, method: PaymentMethod, idempotencyKey: string): Promise<DeskPaymentResult> {
    return (await api.post<DeskPaymentResult>(`/folios/${folioId}/payments`, { amount, method, idempotencyKey })).data;
  },
};

export const leaveApi = {
  async mine(): Promise<{ requests: LeaveRequest[]; balance: { annual: number; sick: number } | null }> {
    return (await api.get('/me/leave-requests')).data;
  },
  async submit(payload: { type: LeaveType; fromDate: string; toDate: string; reason: string }): Promise<LeaveRequest> {
    return (await api.post<LeaveRequest>('/leave-requests', payload)).data;
  },
  async cancel(id: string) {
    return (await api.post(`/leave-requests/${id}/cancel`)).data;
  },
  async pending(department: string): Promise<LeaveRequest[]> {
    return (await api.get<{ requests: LeaveRequest[] }>('/leave-requests/pending', { params: { department } })).data.requests;
  },
  async decide(id: string, approve: boolean, options: { note?: string; coverageOverrideJustification?: string } = {}) {
    return (await api.patch(`/leave-requests/${id}/decision`, { approve, ...options })).data;
  },
};

export const refundApi = {
  async pending(): Promise<RefundRequest[]> {
    return (await api.get<{ requests: RefundRequest[] }>('/refund-requests/pending')).data.requests;
  },
  async decide(id: string, approve: boolean, options: { approvedAmount?: number; note?: string } = {}) {
    return (await api.patch(`/refund-requests/${id}/decision`, { approve, ...options })).data;
  },
};

export const adminApi = {
  async accounts(params: { q?: string; status?: string; page?: number; pageSize?: number }): Promise<{ users: Account[]; total: number; page: number; pageSize: number }> {
    return (await api.get('/accounts', { params })).data;
  },
  async createEmployee(payload: {
    fullName: string;
    email: string;
    phone?: string;
    employeeCode: string;
    department: string;
    position: string;
    hireDate: string;
    baseSalary: number;
    roleId?: string;
  }): Promise<{ id: string; employeeCode: string; email: string; temporaryPassword: string }> {
    return (await api.post('/accounts', payload)).data;
  },
  async setStatus(id: string, status: string, reason?: string) {
    return (await api.patch(`/accounts/${id}/status`, { status, reason })).data;
  },
  async assignRole(id: string, roleId: string, reason?: string) {
    return (await api.post(`/accounts/${id}/roles`, { roleId, reason })).data;
  },
  async revokeRole(id: string, roleId: string) {
    return (await api.delete(`/accounts/${id}/roles/${roleId}`)).data;
  },
  async roles(): Promise<RoleDoc[]> {
    return (await api.get<{ roles: RoleDoc[] }>('/roles')).data.roles;
  },
  async setPermissions(roleId: string, permissions: string[]): Promise<RoleDoc> {
    return (await api.put<RoleDoc>(`/roles/${roleId}/permissions`, { permissions })).data;
  },
  async audit(params: { action?: string; entityType?: string; actorId?: string; from?: string; to?: string; page?: number; pageSize?: number }): Promise<{ rows: AuditEntry[]; total: number }> {
    return (await api.get('/audit-logs', { params })).data;
  },
  async loginHistory(userId: string): Promise<AuditEntry[]> {
    return (await api.get<{ entries: AuditEntry[] }>(`/audit-logs/login-history/${userId}`)).data.entries;
  },
  /** The export needs the auth header, so it is fetched as a blob, not linked. */
  async exportAudit(params: { from?: string; to?: string }): Promise<Blob> {
    return (await api.get('/audit-logs/export', { params, responseType: 'blob' })).data;
  },
};
