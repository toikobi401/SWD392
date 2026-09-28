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
  Promotion,
  Service,
  InventoryHold,
} from '../models/booking.model';
import { BookingStatus, PaymentStatus, PaymentMethod, RefundStatus } from '../models/enums';
import { RefundRequest, Payment } from '../models/billing.model';
import { AvailabilityCalculator, HOLD_DURATION_MS } from '../rules/availability.calculator';
import { PricingRule, AddOnSelection } from '../rules/pricing.rule';
import { CancellationPolicyRule } from '../rules/cancellation-policy.rule';
import { BookingStateMachine } from '../rules/booking-state-machine';
import { PaymentService } from './payment.service';
import { NotificationProxy } from '../proxies/notification.proxy';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';

export interface BookRoomCommand {
  roomTypeId: string;
  checkInDate: Date;
  checkOutDate: Date;
  adults: number;
  children?: number;
  roomCount?: number;
  guest: { fullName: string; email: string; phone: string; specialRequest?: string };
  addOnServiceIds?: { serviceId: string; quantity: number }[];
  voucherCode?: string;
  paymentMethod: PaymentMethod;
  /** Present when a logged-in Customer books (UC-G07 alternative flow 1.2). */
  customerId?: string;
}

export interface BookRoomResult {
  booking: IBooking;
  paymentUrl?: string;
  /** True when the gateway has not yet confirmed — the booking stays PENDING. */
  paymentPending?: boolean;
}

/** Methods a guest can use without a cashier present. */
export const ONLINE_PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.CARD,
  PaymentMethod.E_WALLET,
  PaymentMethod.BANK_TRANSFER,
];

export class BookingCoordinator {
  /**
   * UC-G07 Normal Flow 1.0.
   *
   * The ordering matters: inventory is held BEFORE payment so that a guest who
   * is paying cannot lose the room (step 2); the booking is recorded PENDING
   * before the charge so the payment always references it; and the inventory
   * is only committed AFTER the money is captured (step 11). If payment fails
   * the booking goes PENDING → CANCELLED and the hold is released — UC-G07
   * exception 1.0.E3.
   */
  static async bookRoom(command: BookRoomCommand): Promise<BookRoomResult> {
    const {
      roomTypeId,
      checkInDate,
      checkOutDate,
      adults,
      children = 0,
      roomCount = 1,
    } = command;

    // Step 4 of UC-G01 — the same date validation guards the booking entry point.
    this.validateDates(checkInDate, checkOutDate);

    const roomType = await RoomType.findById(roomTypeId);
    if (!roomType || !roomType.isActive) {
      throw new AppError('ROOM_TYPE_NOT_FOUND', 'Room type not found', 404);
    }

    // An online guest cannot pay cash — there is no cashier on the other end
    // (BR-31). "Pay at hotel" is UC-G07 alternative flow 1.1, not a cash charge.
    if (!ONLINE_PAYMENT_METHODS.includes(command.paymentMethod)) {
      throw new AppError(
        'INVALID_PAYMENT_METHOD',
        `Online bookings accept ${ONLINE_PAYMENT_METHODS.join(', ')}`,
        400,
      );
    }

    // BR-13 — occupancy may not exceed the room type capacity.
    if (adults + children > roomType.capacity * roomCount) {
      throw new AppError(
        'CAPACITY_EXCEEDED',
        `This room type accommodates at most ${roomType.capacity} guests per room`,
        400,
      );
    }

    // Step 2 — re-verify availability and hold the inventory for 15 minutes.
    const holdId = await AvailabilityCalculator.hold(
      roomTypeId,
      checkInDate,
      checkOutDate,
      roomCount,
    );
    if (!holdId) {
      // UC-G07 exception 1.0.E1 — availability lost during the flow.
      throw new AppError(
        'NO_AVAILABILITY',
        'This room is no longer available for the selected dates',
        409,
      );
    }

    try {
      // Steps 5–6 — resolve add-on services at their current price.
      const addOns = await this.resolveAddOns(command.addOnServiceIds);

      // Step 8 — validate the voucher before it is priced in.
      const promotion = await this.resolveVoucher(command.voucherCode);

      // Step 7 — «application logic» PricingRule computes the breakdown.
      const price = PricingRule.calculate(
        roomType,
        checkInDate,
        checkOutDate,
        roomCount,
        addOns,
        promotion,
      );

      // Step 9 — record the booking as PENDING *before* taking money, so every
      // payment has a booking to reconcile against. If the gateway times out,
      // the webhook later finds this booking and confirms it (UC-G10 alt. 1.3).
      const booking = await Booking.create({
        bookingCode: this.generateBookingCode(),
        customerId: command.customerId,
        guest: command.guest,
        roomTypeId,
        checkInDate,
        checkOutDate,
        adults,
        children,
        status: BookingStatus.PENDING,
        addOnServices: addOns.map((a) => ({
          serviceId: a.serviceId,
          quantity: a.quantity,
          price: a.unitPrice,
        })),
        promotionId: promotion?._id,
        subtotal: price.subtotal,
        discount: price.discount,
        tax: price.tax,
        totalAmount: price.total,
      });

      // «include» UC-G10 Pay for Booking.
      let payment;
      try {
        payment = await PaymentService.charge({
          amount: price.total,
          method: command.paymentMethod,
          // The bank memo: the booking code's unique tail, e.g. "HMSAB12C".
          reference: `HMS${booking.bookingCode.slice(-5)}`,
          bookingId: String(booking._id),
          // The payment link closes a minute BEFORE the inventory hold does,
          // so a guest can never pay for a room we have already released.
          expiresAt: new Date(Date.now() + HOLD_DURATION_MS - 60_000),
          buyer: {
            name: command.guest.fullName,
            email: command.guest.email,
            phone: command.guest.phone,
          },
        });
      } catch (err) {
        await this.abandon(booking);
        throw err;
      }

      if (payment.status === PaymentStatus.FAILED) {
        // UC-G07 exception 1.0.E3 — PENDING → CANCELLED (§6.4).
        await this.abandon(booking);
        throw new AppError('PAYMENT_DECLINED', 'Payment was declined', 402);
      }

      if (payment.status === PaymentStatus.PENDING) {
        // The normal payOS path: the guest still has to pay in their banking
        // app. The hold is kept and linked to the booking; the webhook (or the
        // reconcile on return) confirms both — UC-G10 alternative flow 1.3.
        await InventoryHold.findByIdAndUpdate(holdId, { bookingId: booking._id });
        return { booking, paymentPending: true, paymentUrl: payment.checkoutUrl };
      }

      // Step 10 — PENDING → CONFIRMED on capture (§6.4).
      booking.status = BookingStateMachine.next(booking.status, 'PAYMENT_CAPTURED');
      await booking.save();

      if (promotion) {
        await Promotion.findByIdAndUpdate(promotion._id, { $inc: { usedCount: 1 } });
      }

      // Step 11 — commit: the CONFIRMED booking itself now holds the inventory.
      await AvailabilityCalculator.releaseHold(holdId);

      // Loyalty points are NOT credited here. BR-29 credits them only on a
      // completed stay (CheckOutCoordinator) — crediting at booking time would
      // let a guest book, collect points, then cancel.

      // Step 12 — «include» UC-G12 Receive Email / SMS Confirmation.
      // A delivery failure must not invalidate the booking (exception 1.0.E5).
      await NotificationProxy.sendBookingConfirmation(booking).catch((err) =>
        console.error('[UC-G12] confirmation delivery failed, queued for retry', err),
      );

      await AuditService.record({
        action: 'BOOKING_CREATED',
        entityType: 'Booking',
        entityId: String(booking._id),
        actorId: command.customerId,
        after: { bookingCode: booking.bookingCode, total: price.total },
      });

      return { booking };
    } catch (error) {
      // Always release the hold on any failure so the room returns to inventory.
      await AvailabilityCalculator.releaseHold(holdId);
      throw error;
    }
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
    actorId: string | undefined,
    reason?: string,
    isNonRefundableRate = false,
  ): Promise<{
    booking: IBooking;
    refundable: number;
    requiresApproval: boolean;
    /** How the money comes back — told to the guest plainly, never implied. */
    refundStatus: 'NONE' | 'ISSUED' | 'MANUAL_TRANSFER' | 'AWAITING_APPROVAL';
  }> {
    const booking = await Booking.findById(bookingId);
    if (!booking) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found', 404);

    // Step 2 — the state machine rejects a cancel that the lifecycle forbids.
    if (!BookingStateMachine.can(booking.status, 'CANCEL')) {
      throw new AppError(
        'CANNOT_CANCEL',
        `A booking with status ${booking.status} cannot be cancelled`,
        409,
      );
    }

    // Steps 3–4 — «application logic» evaluates the policy.
    const outcome = CancellationPolicyRule.evaluate(
      booking,
      new Date(),
      isNonRefundableRate,
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

  /** UC-G10 exception 1.0.E5 — expired or exhausted voucher. */
  private static async resolveVoucher(code?: string) {
    if (!code) return null;

    const promotion = await Promotion.findOne({ code: code.toUpperCase() });
    if (!promotion || !promotion.isValidOn(new Date())) {
      throw new AppError(
        'INVALID_VOUCHER',
        'This voucher has expired or reached its usage limit',
        400,
      );
    }
    return promotion;
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
