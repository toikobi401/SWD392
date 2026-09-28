/**
 * Hooks — the client's state layer (§7.4.1).
 *
 * Pages depend on hooks; hooks depend on `api`. A page never calls an endpoint
 * function directly, so caching, loading state and invalidation stay in one
 * layer rather than being re-implemented per screen.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationResult,
} from '@tanstack/react-query';
import {
  approvalApi,
  authApi,
  bookingApi,
  frontDeskApi,
  roomApi,
} from '../api/endpoints';
import { tokenStore } from '../api/client';
import type {
  AuthUser,
  CheckInRequest,
  CreateBookingRequest,
  SearchCriteria,
} from '../types';

// --- Session ---------------------------------------------------------------

/** UC-G17 / UC-C04 — the signed-in identity and its permission set. */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.access) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((me) => setUser(me))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await authApi.login(email, password);
    setUser(tokens.user);
    return tokens;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  /** BR-45 — the UI hides what the token does not permit. The server still
   *  enforces it; this only avoids showing controls that would be refused. */
  const can = useCallback(
    (permission: string) => Boolean(user?.permissions.includes(permission)),
    [user],
  );

  return { user, loading, login, logout, can, isAuthenticated: Boolean(user) };
}

// --- Search & booking ------------------------------------------------------

/** UC-G01 Search Available Rooms */
export function useRoomSearch(criteria: SearchCriteria | null) {
  return useQuery({
    queryKey: ['rooms', 'search', criteria],
    queryFn: () => roomApi.search(criteria!),
    // Only runs once the guest has actually submitted a search.
    enabled: Boolean(criteria?.checkIn && criteria?.checkOut),
    // Availability changes constantly; 60 s matches the server-side cache
    // window described in §8.1 Performance.
    staleTime: 60_000,
  });
}

/** UC-G07 Book Room */
export function useCreateBooking(): UseMutationResult<
  Awaited<ReturnType<typeof bookingApi.create>>,
  Error,
  CreateBookingRequest
> {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateBookingRequest) => bookingApi.create(payload),
    onSuccess: () => {
      // The booking consumed inventory, so every cached search is now stale.
      qc.invalidateQueries({ queryKey: ['rooms', 'search'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

/** UC-C11 View Booking History */
export function useMyBookings() {
  return useQuery({
    queryKey: ['bookings', 'mine'],
    queryFn: () => bookingApi.mine(),
  });
}

/** UC-G14 Cancel Booking */
export function useCancelBooking() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      bookingApi.cancel(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['rooms', 'search'] });
    },
  });
}

// --- Front desk ------------------------------------------------------------

/** UC-R12 View Room Availability — the rack refreshes on its own. */
export function useRoomRack() {
  return useQuery({
    queryKey: ['rooms', 'rack'],
    queryFn: () => frontDeskApi.roomRack(),
    refetchInterval: 30_000,
  });
}

/** UC-R06 step 6 */
export function useAllocatableRooms(roomTypeId: string | null, floor?: number) {
  return useQuery({
    queryKey: ['rooms', 'allocatable', roomTypeId, floor],
    queryFn: () => frontDeskApi.allocatableRooms(roomTypeId!, floor),
    enabled: Boolean(roomTypeId),
    // Never serve a cached room list: a stale `version` guarantees the
    // optimistic lock will reject the check-in (UC-R06 exception 1.0.E6).
    staleTime: 0,
  });
}

/** UC-R06 Check In Guest */
export function useCheckIn() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: CheckInRequest) => frontDeskApi.checkIn(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

/** UC-R09 Check Out Guest */
export function useCheckOut() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      bookingId,
      lateCheckoutSurcharge,
      waiveSurcharge,
    }: {
      bookingId: string;
      lateCheckoutSurcharge?: number;
      waiveSurcharge?: boolean;
    }) => frontDeskApi.checkOut(bookingId, { lateCheckoutSurcharge, waiveSurcharge }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

// --- Approvals -------------------------------------------------------------

/** UC-M06 queue */
export function usePendingLeave(department: string) {
  return useQuery({
    queryKey: ['approvals', 'leave', department],
    queryFn: () => approvalApi.pendingLeave(department),
    enabled: Boolean(department),
  });
}

/** UC-M06 decision */
export function useDecideLeave() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      approve,
      note,
      coverageOverrideJustification,
    }: {
      id: string;
      approve: boolean;
      note?: string;
      coverageOverrideJustification?: string;
    }) => approvalApi.decideLeave(id, approve, { note, coverageOverrideJustification }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals', 'leave'] }),
  });
}

/** UC-M14 queue */
export function usePendingRefunds() {
  return useQuery({
    queryKey: ['approvals', 'refunds'],
    queryFn: () => approvalApi.pendingRefunds(),
  });
}

/** UC-M14 decision */
export function useDecideRefund() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      approve,
      approvedAmount,
      note,
    }: {
      id: string;
      approve: boolean;
      approvedAmount?: number;
      note?: string;
    }) => approvalApi.decideRefund(id, approve, { approvedAmount, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals', 'refunds'] }),
  });
}

// --- Formatting ------------------------------------------------------------

/** Amounts travel as integer minor units; formatting happens only at render. */
export function formatMoney(minorUnits: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(
    minorUnits,
  );
}

export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
