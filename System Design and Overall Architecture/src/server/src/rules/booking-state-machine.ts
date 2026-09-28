/**
 * «control» / «state dependent control» BookingStateMachine & RoomStateMachine
 *
 * Ch. 8: a state-dependent control object's output depends not only on the
 * input event but on its current state. Ch. 20 Modifiability: each finite state
 * machine is encapsulated in its own class, so a lifecycle change is local.
 *
 * Implements: §6.4 Booking lifecycle and §6.5 Room lifecycle.
 */
import { BookingStatus, RoomStatus } from '../models/enums';

export class IllegalStateTransitionError extends Error {
  constructor(from: string, to: string, machine: string) {
    super(`${machine}: illegal transition ${from} → ${to}`);
    this.name = 'IllegalStateTransitionError';
  }
}

// --------------------------------------------------------------------------
// Booking lifecycle — §6.4
// --------------------------------------------------------------------------

export type BookingEvent =
  | 'PAYMENT_CAPTURED'
  | 'HOLD_EXPIRED'
  | 'PAYMENT_FAILED'
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'CANCEL'
  | 'MARK_NO_SHOW';

const BOOKING_TRANSITIONS: Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>> = {
  [BookingStatus.PENDING]: {
    PAYMENT_CAPTURED: BookingStatus.CONFIRMED,
    HOLD_EXPIRED: BookingStatus.CANCELLED,
    PAYMENT_FAILED: BookingStatus.CANCELLED,
  },
  [BookingStatus.CONFIRMED]: {
    CHECK_IN: BookingStatus.CHECKED_IN,
    CANCEL: BookingStatus.CANCELLED,
    MARK_NO_SHOW: BookingStatus.NO_SHOW,
  },
  [BookingStatus.CHECKED_IN]: {
    CHECK_OUT: BookingStatus.CHECKED_OUT,
  },
  // Terminal states — §5.3 invariant: CANCELLED is only reachable before CHECKED_IN.
  [BookingStatus.CHECKED_OUT]: {},
  [BookingStatus.CANCELLED]: {},
  [BookingStatus.NO_SHOW]: {},
};

export class BookingStateMachine {
  static can(current: BookingStatus, event: BookingEvent): boolean {
    return BOOKING_TRANSITIONS[current]?.[event] !== undefined;
  }

  /** @throws IllegalStateTransitionError when the event is not legal in `current`. */
  static next(current: BookingStatus, event: BookingEvent): BookingStatus {
    const target = BOOKING_TRANSITIONS[current]?.[event];
    if (!target) throw new IllegalStateTransitionError(current, event, 'Booking');
    return target;
  }

  static isTerminal(status: BookingStatus): boolean {
    return Object.keys(BOOKING_TRANSITIONS[status]).length === 0;
  }
}

// --------------------------------------------------------------------------
// Room lifecycle — §6.5
// --------------------------------------------------------------------------

export type RoomEvent =
  | 'ASSIGN'
  | 'CHECK_OUT'
  | 'CLEANED'
  | 'INSPECTION_PASSED'
  | 'INSPECTION_FAILED'
  | 'MARK_OUT_OF_ORDER'
  | 'REPAIRED';

const ROOM_TRANSITIONS: Record<RoomStatus, Partial<Record<RoomEvent, RoomStatus>>> = {
  [RoomStatus.VACANT_CLEAN]: {
    ASSIGN: RoomStatus.OCCUPIED,
    MARK_OUT_OF_ORDER: RoomStatus.OUT_OF_ORDER,
  },
  [RoomStatus.OCCUPIED]: {
    CHECK_OUT: RoomStatus.VACANT_DIRTY,
  },
  [RoomStatus.VACANT_DIRTY]: {
    CLEANED: RoomStatus.INSPECTED,
    MARK_OUT_OF_ORDER: RoomStatus.OUT_OF_ORDER,
  },
  [RoomStatus.INSPECTED]: {
    INSPECTION_PASSED: RoomStatus.VACANT_CLEAN,
    INSPECTION_FAILED: RoomStatus.VACANT_DIRTY,
  },
  [RoomStatus.OUT_OF_ORDER]: {
    REPAIRED: RoomStatus.VACANT_DIRTY,
  },
};

export class RoomStateMachine {
  static can(current: RoomStatus, event: RoomEvent): boolean {
    return ROOM_TRANSITIONS[current]?.[event] !== undefined;
  }

  static next(current: RoomStatus, event: RoomEvent): RoomStatus {
    const target = ROOM_TRANSITIONS[current]?.[event];
    if (!target) throw new IllegalStateTransitionError(current, event, 'Room');
    return target;
  }
}
