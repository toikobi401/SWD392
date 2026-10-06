/**
 * «control» / «coordinator» BookingCoordinator
 *
 * Ch. 8: "A control object provides the overall coordination of the objects that
 * realize a use case... analogous to the conductor of an orchestra." This class
 * orchestrates the objects that realize UC-G07 Book Room and UC-G14 Cancel
 * Booking; it holds no business rules of its own — those live in the
 * «application logic» rule objects it calls.
 *
 * Realizes: UC-G07 Book Room, UC-G14 Cancel Booking, UC-R03 Walk-in Booking.
 * Sequence: §6.3.
 */
import {
  Booking,
  IBooking,
  RoomType,
  Service,
  InventoryHold,
} from '../models/booking.model';
import {
  BookingStatus,
  PaymentStatus,
  PaymentMethod,
  Permission,
  RefundStatus,
} from '../models/enums';
import { RefundRequest, Payment } from '../models/billing.model';
import { AvailabilityCalculator, HOLD_DURATION_MS } from '../rules/availability.calculator';
import { PricingRule, AddOnSelection, TAX_RATE } from '../rules/pricing.rule';
import { CancellationPolicyRule } from '../rules/cancellation-policy.rule';
import { BookingStateMachine } from '../rules/booking-state-machine';
import { PaymentService } from './payment.service';
import { PromotionService } from './promotion.service';
import { NotificationProxy } from '../proxies/notification.proxy';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';

/** One room the guest wants, with who will sleep in it. */
export interface RoomRequest {
  roomTypeId: string;
  adults: number;
  children?: number;
  /** Who stays in this room if not the booker (checked at check-in). */
  occupantName?: string;
  addOnServices?: { serviceId: string; quantity: number }[];
}

export interface BookRoomCommand {
  /** The rooms to book — any mix of types, all for the same dates. */
  rooms?: RoomRequest[];
  /**
   * Single-room shorthand, kept for older clients: one room of `roomTypeId`
   * (or `roomCount` of them, with the party split between them).
   */
  roomTypeId?: string;
  adults?: number;
  children?: number;
  roomCount?: number;
  addOnServiceIds?: { serviceId: string; quantity: number }[];

  checkInDate: Date;
  checkOutDate: Date;
  guest: { fullName: string; email: string; phone: string; specialRequest?: string };
  voucherCode?: string;
  paymentMethod: PaymentMethod;
  /** Present when a logged-in Customer books (UC-G07 alternative flow 1.2). */
  customerId?: string;
}

export interface BookRoomResult {
  reservationCode: string;
  /** One booking per room, in the order they were requested. */
  bookings: IBooking[];
  /** The first room — for callers that book a single room. */
  booking: IBooking;
  total: number;
  paymentUrl?: string;
  /** True while payOS has not confirmed — the bookings stay PENDING. */
  paymentPending?: boolean;
}

/** BR-08 — at most five rooms in one reservation. */
export const MAX_ROOMS_PER_RESERVATION = 5;

/** Methods a guest can use without a cashier present. */
export const ONLINE_PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.CARD,
  PaymentMethod.E_WALLET,
  PaymentMethod.BANK_TRANSFER,
];

export class BookingCoordinator {
  /**
   * UC-G07 Normal Flow 1.0 — books one or more rooms in a single reservation.
   *
   * Every room becomes its own Booking with its own lifecycle (the rooms of a
   * family may arrive at different times, and one can be cancelled without
   * the others), sharing a reservation code, the dates and ONE payOS payment.
   *
   * The ordering matters:
   *   1. every room is held BEFORE any money moves (step 2) — all or nothing:
   *      if the third room cannot be held, the first two are released;
   *   2. the bookings are recorded PENDING before the charge, so each payment
   *      references its room;
   *   3. inventory is committed only when payOS confirms the money
   *      (PaymentService.confirmFromGateway). If payment fails, every room
   *      goes PENDING → CANCELLED and its hold is released (exception 1.0.E3).
   */
  static async bookRoom(command: BookRoomCommand): Promise<BookRoomResult> {
    const { checkInDate, checkOutDate } = command;
    const rooms = this.normalizeRooms(command);

    // BR-08.
    if (rooms.length === 0) throw new AppError('NO_ROOMS', 'Choose at least one room', 400);
    if (rooms.length > MAX_ROOMS_PER_RESERVATION) {
      throw new AppError(
        'TOO_MANY_ROOMS',
        `At most ${MAX_ROOMS_PER_RESERVATION} rooms can be booked together — for a group, please contact the hotel`,
        400,
      );
    }

    // Step 4 of UC-G01 — the same date validation guards the booking entry point.
    this.validateDates(checkInDate, checkOutDate);

    // An online guest cannot pay cash — there is no cashier on the other end
    // (BR-31). "Pay at hotel" is UC-G07 alternative flow 1.1, not a cash charge.
    if (!ONLINE_PAYMENT_METHODS.includes(command.paymentMethod)) {
      throw new AppError(
        'INVALID_PAYMENT_METHOD',
        `Online bookings accept ${ONLINE_PAYMENT_METHODS.join(', ')}`,
        400,
      );
    }

    const typeIds = [...new Set(rooms.map((r) => r.roomTypeId))];
    const types = await RoomType.find({ _id: { $in: typeIds }, isActive: true });
    const typeOf = (id: string) => types.find((t) => String(t._id) === id);

    rooms.forEach((r, i) => {
      const rt = typeOf(r.roomTypeId);
      if (!rt) throw new AppError('ROOM_TYPE_NOT_FOUND', `Room ${i + 1}: room type not found`, 404);
      // BR-13 — each room's occupancy may not exceed its capacity.
      if (r.adults < 1) throw new AppError('ADULT_REQUIRED', `Room ${i + 1} needs at least one adult`, 400);
      if (r.adults + (r.children ?? 0) > rt.capacity) {
        throw new AppError(
          'CAPACITY_EXCEEDED',
          `Room ${i + 1} (${rt.name}) sleeps at most ${rt.capacity}`,
          400,
        );
      }
    });

    // Step 8 — reject an unknown, inactive, expired or used-up voucher before
    // anything is held. Its minimum spend is checked once the rooms are priced.
    const promotion = command.voucherCode
      ? await PromotionService.resolve(command.voucherCode, Infinity)
      : null;

    // Step 2 — hold every room for 15 minutes, all or nothing. Holds are
    // placed one room at a time so each one counts the holds before it.
    const holdIds: string[] = [];
    const releaseAll = () => Promise.all(holdIds.map((h) => AvailabilityCalculator.releaseHold(h)));
    for (const r of rooms) {
      const holdId = await AvailabilityCalculator.hold(r.roomTypeId, checkInDate, checkOutDate, 1);
      if (!holdId) {
        await releaseAll();
        const wanted = rooms.filter((x) => x.roomTypeId === r.roomTypeId).length;
        const left = (await AvailabilityCalculator.forRoomType(r.roomTypeId, checkInDate, checkOutDate)).availableCount;
        // UC-G07 exception 1.0.E1 — availability lost during the flow.
        throw new AppError(
          'NO_AVAILABILITY',
          `Only ${left} ${typeOf(r.roomTypeId)!.name} room${left === 1 ? '' : 's'} left for these dates — you asked for ${wanted}`,
          409,
        );
      }
      holdIds.push(holdId);
    }

    let bookings: IBooking[] = [];
    try {
      // Steps 5–7 — price each room, then spread the voucher across the rooms
      // in proportion to their price (the last room takes the rounding).
      const lines = [];
      for (const r of rooms) {
        const addOns = await this.resolveAddOns(r.addOnServices);
        const price = PricingRule.calculate(typeOf(r.roomTypeId)!, checkInDate, checkOutDate, 1, addOns);
        lines.push({ room: r, addOns, subtotal: price.subtotal });
      }
      const grossTotal = lines.reduce((sum, l) => sum + l.subtotal, 0);
      // BR-56 — minimum spend is the whole reservation's, before tax. A
      // failure here releases the holds (catch below).
      if (promotion) await PromotionService.resolve(promotion.code, grossTotal);
      const discountTotal = promotion ? PricingRule.discountFor(promotion, grossTotal) : 0;
      let discountLeft = discountTotal;
      const priced = lines.map((l, i) => {
        const discount =
          i === lines.length - 1 ? discountLeft : Math.floor((discountTotal * l.subtotal) / grossTotal);
        discountLeft -= discount;
        const tax = Math.round((l.subtotal - discount) * TAX_RATE);
        return { ...l, discount, tax, total: l.subtotal - discount + tax };
      });

      // Step 9 — record every room PENDING before taking money.
      const reservationCode = this.generateBookingCode();
      bookings = await Booking.create(
        priced.map((l, i) => ({
          bookingCode: rooms.length === 1 ? reservationCode : `${reservationCode}-${i + 1}`,
          reservationCode,
          customerId: command.customerId,
          guest: command.guest,
          occupantName: l.room.occupantName,
          roomTypeId: l.room.roomTypeId,
          checkInDate,
          checkOutDate,
          adults: l.room.adults,
          children: l.room.children ?? 0,
          status: BookingStatus.PENDING,
          addOnServices: l.addOns.map((a) => ({ serviceId: a.serviceId, quantity: a.quantity, price: a.unitPrice })),
          promotionId: promotion?._id,
          subtotal: l.subtotal,
          discount: l.discount,
          tax: l.tax,
          totalAmount: l.total,
        })),
      );

      await Promise.all(
        bookings.map((b) =>
          AuditService.record({
            action: 'BOOKING_CREATED',
            entityType: 'Booking',
            entityId: String(b._id),
            actorId: command.customerId,
            after: { bookingCode: b.bookingCode, reservationCode, total: b.totalAmount },
          }),
        ),
      );

      // «include» UC-G10 — ONE payOS link for the whole reservation.
      let payments;
      try {
        payments = await PaymentService.chargeReservation({
          lines: bookings.map((b, i) => ({
            bookingId: String(b._id),
            amount: b.totalAmount,
            label: typeOf(rooms[i].roomTypeId)!.name,
          })),
          method: command.paymentMethod,
          // The bank memo: the reservation code's unique tail, e.g. "HMSAB12C".
          reference: `HMS${reservationCode.slice(-5)}`,
          // The payment link closes a minute BEFORE the holds do, so a guest
          // can never pay for rooms we have already released.
          expiresAt: new Date(Date.now() + HOLD_DURATION_MS - 60_000),
          buyer: { name: command.guest.fullName, email: command.guest.email, phone: command.guest.phone },
        });
      } catch (err) {
        await Promise.all(bookings.map((b) => this.abandon(b)));
        throw err;
      }

      if (payments.some((p) => p.status === PaymentStatus.FAILED)) {
        // UC-G07 exception 1.0.E3 — every room PENDING → CANCELLED (§6.4).
        await Promise.all(bookings.map((b) => this.abandon(b)));
        throw new AppError('PAYMENT_DECLINED', 'Payment could not be started', 402);
      }

      // The payOS path: the guest still has to pay in their banking app. Each
      // hold is linked to its room; the webhook (or the reconcile when the
      // guest returns) confirms the rooms and deletes the holds together —
      // UC-G10 alternative flow 1.1. payOS never approves synchronously.
      await Promise.all(
        holdIds.map((h, i) => InventoryHold.findByIdAndUpdate(h, { bookingId: bookings[i]._id })),
      );

      // Loyalty points are NOT credited here — BR-29 credits them only on a
      // completed stay (CheckOutCoordinator).
      return {
        reservationCode,
        bookings,
        booking: bookings[0],
        total: bookings.reduce((sum, b) => sum + b.totalAmount, 0),
        paymentPending: true,
        paymentUrl: payments[0].checkoutUrl,
      };
    } catch (error) {
      // Always release the holds on any failure so the rooms return to inventory.
      await releaseAll();
      throw error;
    }
  }

  /** Accepts the multi-room `rooms` list, or the older single-room fields. */
  private static normalizeRooms(command: BookRoomCommand): RoomRequest[] {
    if (command.rooms?.length) {
      return command.rooms.map((r) => ({
        roomTypeId: String(r.roomTypeId),
        adults: Number(r.adults),
        children: Number(r.children ?? 0),
        occupantName: r.occupantName?.trim() || undefined,
        addOnServices: r.addOnServices,
      }));
    }
    if (!command.roomTypeId) return [];

    // Older clients: `roomCount` rooms of one type, the party split evenly.
    const n = Math.max(1, Number(command.roomCount ?? 1));
    const adults = Number(command.adults ?? 1);
    const children = Number(command.children ?? 0);
    return Array.from({ length: n }, (_, i) => ({
      roomTypeId: String(command.roomTypeId),
      adults: Math.floor(adults / n) + (i < adults % n ? 1 : 0),
      children: Math.floor(children / n) + (i < children % n ? 1 : 0),
      addOnServices: i === 0 ? command.addOnServiceIds : undefined,
    }));
  }

  /**
   * UC-G14 Cancel Booking, Normal Flow 1.0.
   *
   * The penalty decision is delegated to CancellationPolicyRule; this
   * coordinator only sequences the state change, the inventory release and the
   * refund.
   */
  static async cancelBooking(
    bookingId: string,
    actor: { id: string; permissions: Permission[] },
    reason?: string,
  ): Promise<{
    booking: IBooking;
    refundable: number;
    requiresApproval: boolean;
    /** How the money comes back — told to the guest plainly, never implied. */
    refundStatus: 'NONE' | 'ISSUED' | 'MANUAL_TRANSFER' | 'AWAITING_APPROVAL';
  }> {
    const actorId = actor.id;
    const booking = await Booking.findById(bookingId);
    if (!booking) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found', 404);

    // Ownership: a Customer may cancel only their own booking; desk staff
    // (BOOKING_MODIFY, UC-R05) may cancel any. Without this check, holding
    // BOOKING_CANCEL would let one guest cancel another's stay by changing
    // the id in the URL.
    const isOwner = booking.customerId !== undefined && String(booking.customerId) === actorId;
    if (!isOwner && !actor.permissions.includes(Permission.BOOKING_MODIFY)) {
      // 404, not 403: do not confirm that someone else's booking id exists.
      throw new AppError('BOOKING_NOT_FOUND', 'Booking not found', 404);
    }

    // Step 2 — the state machine rejects a cancel that the lifecycle forbids.
    if (!BookingStateMachine.can(booking.status, 'CANCEL')) {
      throw new AppError(
        'CANNOT_CANCEL',
        `A booking with status ${booking.status} cannot be cancelled`,
        409,
      );
    }

    // Steps 3–4 — «application logic» evaluates the policy.
    // The rate type is read from the booking — never from the request, or a
    // guest on a non-refundable rate could simply omit it (BR-20).
    const outcome = CancellationPolicyRule.evaluate(
      booking,
      new Date(),
      booking.nonRefundable,
    );
    if (!outcome.allowed) {
      throw new AppError('CANNOT_CANCEL', outcome.reason, 409);
    }

    // Steps 6–7 — the status change releases the inventory implicitly, because
    // AvailabilityCalculator only counts CONFIRMED and CHECKED_IN bookings.
    booking.status = BookingStateMachine.next(booking.status, 'CANCEL');
    booking.cancelledAt = new Date();
    booking.cancellationReason = reason;
    await booking.save();

    // Step 8 — refund, or route to Manager approval when out of policy.
    let refundStatus: 'NONE' | 'ISSUED' | 'MANUAL_TRANSFER' | 'AWAITING_APPROVAL' = 'NONE';
    if (outcome.refundable > 0) {
      const { reversal, manualTransferRequired } = await PaymentService.refund(
        String(booking._id),
        outcome.refundable,
        actorId,
      );
      // payOS cannot refund by API — an operator transfers the money back.
      if (manualTransferRequired) refundStatus = 'MANUAL_TRANSFER';
      else if (reversal) refundStatus = 'ISSUED';
    } else if (outcome.requiresApproval) {
      // UC-G14 alternative flow 1.1 → UC-M14 Approve Refund Request.
      await this.createRefundRequestForApproval(booking, actorId);
      refundStatus = 'AWAITING_APPROVAL';
    }

    // Step 9 — cancellation confirmation email.
    await NotificationProxy.sendCancellationNotice(booking, outcome).catch((err) =>
      console.error('[UC-G14] cancellation notice failed, queued for retry', err),
    );

    await AuditService.record({
      action: 'BOOKING_CANCELLED',
      entityType: 'Booking',
      entityId: String(booking._id),
      actorId,
      after: { penalty: outcome.penalty, refundable: outcome.refundable },
    });

    return {
      booking,
      refundable: outcome.refundable,
      requiresApproval: outcome.requiresApproval,
      refundStatus,
    };
  }

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------

  /** BR-07 / UC-G01 exceptions 1.0.E1–1.0.E3. */
  private static validateDates(checkIn: Date, checkOut: Date): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkIn < today) {
      throw new AppError('INVALID_DATE', 'Check-in date cannot be in the past', 400);
    }
    if (checkOut <= checkIn) {
      throw new AppError('INVALID_DATE', 'Check-out must be after check-in', 400);
    }
    const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
    if (nights > 30) {
      throw new AppError(
        'STAY_TOO_LONG',
        'For stays longer than 30 nights please contact us',
        400,
      );
    }
  }

  /** BR-11 — booking code format HMS-YYYYMMDD-XXXXX. */
  private static generateBookingCode(): string {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const random = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `HMS-${stamp}-${random}`;
  }

  private static async resolveAddOns(
    selections?: { serviceId: string; quantity: number }[],
  ): Promise<AddOnSelection[]> {
    if (!selections?.length) return [];

    const services = await Service.find({
      _id: { $in: selections.map((s) => s.serviceId) },
      isActive: true,
    });

    return selections.map((sel) => {
      const service = services.find((s) => String(s._id) === sel.serviceId);
      if (!service) {
        throw new AppError('SERVICE_NOT_FOUND', `Service ${sel.serviceId} is unavailable`, 400);
      }
      return { serviceId: sel.serviceId, quantity: sel.quantity, unitPrice: service.price };
    });
  }

  /** UC-G07 exception 1.0.E3 — a booking whose payment failed: PENDING → CANCELLED. */
  private static async abandon(booking: IBooking): Promise<void> {
    booking.status = BookingStateMachine.next(booking.status, 'PAYMENT_FAILED');
    booking.cancelledAt = new Date();
    booking.cancellationReason = 'Payment not completed';
    await booking.save();
  }

  private static async createRefundRequestForApproval(
    booking: IBooking,
    actorId?: string,
  ): Promise<void> {
    const payment = await Payment.findOne({
      bookingId: booking._id,
      status: PaymentStatus.PAID,
    }).sort({ paidAt: -1 });

    // Nothing was captured (e.g. pay-at-hotel) — there is nothing to refund.
    if (!payment) return;

    await RefundRequest.create({
      referenceNumber: `RF-${Date.now().toString(36).toUpperCase()}`,
      bookingId: booking._id,
      paymentId: payment._id,
      requestedBy: actorId ?? booking.customerId,
      requestedAmount: booking.totalAmount,
      reasonCategory: 'OUT_OF_POLICY_CANCELLATION',
      description: 'Cancellation inside the penalty window — manager decision required',
      status: RefundStatus.PENDING,
    });
  }
}
