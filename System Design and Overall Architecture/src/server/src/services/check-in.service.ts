/**
 * «control» / «coordinator» CheckInCoordinator & CheckOutCoordinator
 *
 * Realizes: UC-R06 Check In Guest, UC-R09 Check Out Guest.
 * Sequences: verify identity → allocate room → collect balance → activate stay,
 *            and consolidate folio → invoice → settle → release room.
 */
import { Types } from 'mongoose';
import { Booking, IBooking, LoyaltyAccount, Room, IRoom } from '../models/booking.model';
import { Folio, Charge, Invoice, IInvoice, Payment } from '../models/billing.model';
import { FolioStatus, ChargeType, PaymentStatus } from '../models/enums';
import { Task } from '../models/hr.model';
import { RoomAllocator } from '../rules/room-allocator';
import {
  BookingStateMachine,
  RoomStateMachine,
  RoomEvent,
} from '../rules/booking-state-machine';
import { InvoiceNumberGenerator } from '../rules/invoice-number.generator';
import { TAX_RATE } from '../rules/pricing.rule';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';

/**
 * FolioLedger — the only way a charge reaches a folio.
 *
 * Every taxable posting writes its VAT as a separate TAX line in the same call,
 * so the folio balance is always tax-inclusive and matches what the guest
 * actually pays. Without this single entry point, check-in posted pre-tax room
 * charges while online payments were tax-inclusive, and a prepaid guest could
 * never reach a zero balance at check-out (BR-28).
 */
export class FolioLedger {
  private static readonly TAXABLE: ChargeType[] = [
    ChargeType.ROOM,
    ChargeType.SERVICE,
    ChargeType.SURCHARGE,
  ];

  static async post(
    folioId: string,
    line: { type: ChargeType; description: string; amount: number; quantity?: number },
    postedBy: string,
  ): Promise<{ net: number; tax: number }> {
    const quantity = line.quantity ?? 1;
    const net = line.amount * quantity;

    await Charge.create({
      folioId,
      type: line.type,
      description: line.description,
      amount: line.amount,
      quantity,
      postedBy,
    });

    let tax = 0;
    if (this.TAXABLE.includes(line.type)) {
      tax = Math.round(net * TAX_RATE);
      if (tax > 0) {
        await Charge.create({
          folioId,
          type: ChargeType.TAX,
          description: `VAT on ${line.description}`,
          amount: tax,
          postedBy,
        });
      }
    }

    await Folio.findByIdAndUpdate(folioId, {
      $inc: { totalCharges: net + tax, balance: net + tax },
    });

    return { net, tax };
  }

  /**
   * UC-R19 — posts to a folio chosen at the desk. Unlike `post`, it first
   * checks the folio exists and is still open: a charge must never land on a
   * stay that has already been invoiced (BR-30, invoices are immutable).
   */
  static async postToOpenFolio(
    folioId: string,
    line: { type: ChargeType; description: string; amount: number; quantity?: number },
    postedBy: string,
  ): Promise<{ net: number; tax: number; balance: number }> {
    const folio = await Folio.findById(folioId);
    if (!folio) throw new AppError('NOT_FOUND', 'Folio not found', 404);
    if (folio.status !== FolioStatus.OPEN) {
      throw new AppError('FOLIO_CLOSED', 'This stay has been checked out and invoiced', 409);
    }

    const posted = await this.post(folioId, line, postedBy);
    const updated = await Folio.findById(folioId);
    return { ...posted, balance: updated!.balance };
  }

  /**
   * Credits payments captured before the folio existed — an online prepayment
   * is taken at booking time, days before check-in opens the folio.
   */
  static async creditPrepayments(folioId: string, bookingId: string): Promise<number> {
    const prepaid = await Payment.find({ bookingId, status: PaymentStatus.PAID });
    const total = prepaid.reduce((sum, p) => sum + p.amount, 0);

    if (total > 0) {
      await Payment.updateMany(
        { bookingId, status: PaymentStatus.PAID, folioId: { $exists: false } },
        { $set: { folioId } },
      );
      await Folio.findByIdAndUpdate(folioId, {
        $inc: { totalPayments: total, balance: -total },
      });
    }
    return total;
  }
}

export interface GuestIdentity {
  documentType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVING_LICENCE';
  documentNumber: string;
  fullName: string;
  dateOfBirth: Date;
  expiryDate: Date;
  nationality?: string;
}

export interface CheckInCommand {
  bookingId: string;
  identity: GuestIdentity;
  roomId: string;
  /** The room version the receptionist last saw — guards the optimistic lock. */
  roomVersion: number;
  receptionistId: string;
  depositAmount?: number;
}

export class CheckInCoordinator {
  /** BR-24 — minimum age 18 unless accompanied by a guardian. */
  private static readonly MINIMUM_AGE = 18;

  /**
   * UC-R06 Normal Flow 1.0.
   *
   * Room allocation (step 8) is an optimistic-lock claim, so two receptionists
   * checking in simultaneously cannot both take the same room — exception
   * 1.0.E6, quality scenario QA-7.
   */
  static async checkIn(command: CheckInCommand): Promise<{
    booking: IBooking;
    roomNumber: string;
    folioId: string;
  }> {
    const booking = await Booking.findById(command.bookingId);
    if (!booking) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found', 404);

    // Step 2 — only a confirmed booking may be checked in.
    if (!BookingStateMachine.can(booking.status, 'CHECK_IN')) {
      throw new AppError(
        'CANNOT_CHECK_IN',
        `A booking with status ${booking.status} cannot be checked in`,
        409,
      );
    }

    // Steps 4–5 — «include» UC-R07 Verify Guest Identity.
    this.verifyIdentity(command.identity, booking);

    // Steps 6–8 — «include» UC-R08 Assign Room, with the concurrency guard.
    const room = await RoomAllocator.allocate(command.roomId, command.roomVersion);
    if (!room) {
      // Exception 1.0.E6 — another receptionist claimed it first.
      throw new AppError(
        'ROOM_TAKEN',
        'This room has just been taken. Please select another room.',
        409,
      );
    }

    if (String(room.roomTypeId) !== String(booking.roomTypeId)) {
      // Alternative flow 1.3 — an upgrade must be recorded deliberately.
      await AuditService.record({
        action: 'ROOM_UPGRADE_APPLIED',
        entityType: 'Booking',
        entityId: String(booking._id),
        actorId: command.receptionistId,
        after: { from: booking.roomTypeId, to: room.roomTypeId },
      });
    }

    // Step 12 — activate the stay and open the folio.
    booking.status = BookingStateMachine.next(booking.status, 'CHECK_IN');
    booking.roomId = room._id as Types.ObjectId;
    booking.actualCheckInAt = new Date();
    await booking.save();

    const folio = await Folio.create({
      bookingId: booking._id,
      status: FolioStatus.OPEN,
      depositHeld: command.depositAmount ?? 0,
    });

    // Post the whole stay up front, then credit what the guest already paid
    // online, so a fully prepaid guest starts the stay at a zero balance.
    const folioId = String(folio._id);
    await FolioLedger.post(
      folioId,
      {
        type: ChargeType.ROOM,
        description: `Room & services — ${booking.nights()} night(s)`,
        // Net of discount: VAT is then exactly the booking's tax (BR-09).
        amount: booking.subtotal - booking.discount,
      },
      command.receptionistId,
    );
    await FolioLedger.creditPrepayments(folioId, String(booking._id));

    await AuditService.record({
      action: 'GUEST_CHECKED_IN',
      entityType: 'Booking',
      entityId: String(booking._id),
      actorId: command.receptionistId,
      after: { roomNumber: room.roomNumber, identity: command.identity.documentNumber },
    });

    return { booking, roomNumber: room.roomNumber, folioId: String(folio._id) };
  }

  /** UC-R07 — exceptions 1.0.E2, 1.0.E3, 1.0.E7. */
  private static verifyIdentity(identity: GuestIdentity, booking: IBooking): void {
    if (identity.expiryDate < new Date()) {
      throw new AppError('ID_EXPIRED', 'The identity document has expired', 400);
    }

    const age =
      (Date.now() - identity.dateOfBirth.getTime()) / (365.25 * 86_400_000);
    if (age < this.MINIMUM_AGE) {
      throw new AppError(
        'UNDERAGE_GUEST',
        `BR-24: the guest must be at least ${this.MINIMUM_AGE} years old`,
        403,
      );
    }

    // A loose name comparison — the receptionist makes the final judgement.
    // Either the person staying in this room or the booker may check it in:
    // in a multi-room reservation the second room is often someone else's.
    const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const allowed = [booking.occupantName, booking.guest.fullName].filter(Boolean).map((n) => normalize(n!));
    if (!allowed.includes(normalize(identity.fullName))) {
      throw new AppError(
        'IDENTITY_MISMATCH',
        booking.occupantName
          ? `The document must be ${booking.occupantName}'s (staying in this room) or ${booking.guest.fullName}'s (who booked)`
          : 'The document does not match the reservation holder',
        403,
      );
    }
  }
}

// --------------------------------------------------------------------------

/**
 * RoomStatusService — UC-R13 Update Room Status, UC-R06 step 6.
 *
 * Every manual status change goes through RoomStateMachine, so a mistyped
 * event at the desk (say, OCCUPIED → CLEAN without a check-out) is refused
 * rather than corrupting the room rack.
 */
export class RoomStatusService {
  static async apply(roomId: string, event: RoomEvent, notes?: string): Promise<IRoom> {
    const room = await Room.findById(roomId);
    if (!room) throw new AppError('NOT_FOUND', 'Room not found', 404);

    // ASSIGN and CHECK_OUT belong to the check-in/out coordinators — allowing
    // them here would bypass identity checks, the folio and the invoice.
    if (event === 'ASSIGN' || event === 'CHECK_OUT') {
      throw new AppError(
        'USE_CHECK_IN_OUT',
        `${event} is performed through check-in / check-out, not a manual status change`,
        400,
      );
    }

    const next = RoomStateMachine.next(room.status, event);

    // Guarded on the version read above, like RoomAllocator, so a manual change
    // cannot overwrite a check-in that happened in between.
    const updated = await Room.findOneAndUpdate(
      { _id: room._id, version: room.version },
      { $set: { status: next, ...(notes ? { notes } : {}) }, $inc: { version: 1 } },
      { new: true },
    );
    if (!updated) {
      throw new AppError('ROOM_CHANGED', 'The room changed meanwhile — refresh and retry', 409);
    }
    return updated;
  }

  /** UC-R06 step 6 — the rooms a receptionist may choose from. */
  static async allocatable(roomTypeId: string, floor?: number): Promise<IRoom[]> {
    return RoomAllocator.listAllocatable(roomTypeId, { floor });
  }
}

/** Identifies the late-checkout line so a retried check-out never re-posts it. */
const LATE_CHECKOUT_DESCRIPTION = 'Late check-out surcharge';

export interface CheckOutCommand {
  bookingId: string;
  receptionistId: string;
  /** Alternative flow 1.1 — late checkout surcharge, in minor units. */
  lateCheckoutSurcharge?: number;
  waiveSurcharge?: boolean;
}

export class CheckOutCoordinator {
  /**
   * UC-R09 Normal Flow 1.0.
   *
   * BR-28: the folio must reach zero before the stay closes, so this refuses to
   * complete while an undisputed balance remains (exception 1.0.E1).
   */
  static async checkOut(command: CheckOutCommand): Promise<{
    booking: IBooking;
    invoice: IInvoice;
  }> {
    const booking = await Booking.findById(command.bookingId);
    if (!booking) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found', 404);

    if (!BookingStateMachine.can(booking.status, 'CHECK_OUT')) {
      throw new AppError(
        'CANNOT_CHECK_OUT',
        `A booking with status ${booking.status} cannot be checked out`,
        409,
      );
    }

    const folio = await Folio.findOne({ bookingId: booking._id });
    if (!folio) throw new AppError('FOLIO_NOT_FOUND', 'No folio for this stay', 404);

    // Step 3 — alternative flow 1.1, late checkout surcharge (BR-27).
    // Idempotent: the first attempt may fail on the balance check below, the
    // guest pays, and the receptionist retries — the surcharge must not be
    // posted a second time on that retry.
    if (command.lateCheckoutSurcharge && !command.waiveSurcharge) {
      const alreadyPosted = await Charge.exists({
        folioId: folio._id,
        type: ChargeType.SURCHARGE,
        description: LATE_CHECKOUT_DESCRIPTION,
      });
      if (!alreadyPosted) {
        await FolioLedger.post(
          String(folio._id),
          {
            type: ChargeType.SURCHARGE,
            description: LATE_CHECKOUT_DESCRIPTION,
            amount: command.lateCheckoutSurcharge,
          },
          command.receptionistId,
        );
      }
    }

    // FolioLedger updated the balance with $inc — reload before judging it.
    const current = await Folio.findById(folio._id);

    // BR-28 — exception 1.0.E1: the balance must be settled first.
    const outstanding = current!.balance - current!.depositHeld;
    if (outstanding > 0) {
      throw new AppError(
        'OUTSTANDING_BALANCE',
        `An outstanding balance of ${outstanding} must be settled before check-out`,
        402,
      );
    }

    // Steps 4–5 — consolidate and «include» UC-R10 Generate Final Invoice.
    // VAT already sits on the folio as TAX lines (FolioLedger), so it is summed,
    // never recomputed — recomputing on the total would tax the tax.
    const charges = await Charge.find({ folioId: folio._id, isDisputed: false });
    const lineTotal = (c: { amount: number; quantity: number }) => c.amount * c.quantity;
    const subtotal = charges
      .filter((c) => c.type !== ChargeType.TAX)
      .reduce((sum, c) => sum + lineTotal(c), 0);
    const tax = charges
      .filter((c) => c.type === ChargeType.TAX)
      .reduce((sum, c) => sum + lineTotal(c), 0);

    const invoice = await Invoice.create({
      // BR-30 — gapless sequential numbering.
      invoiceNumber: await InvoiceNumberGenerator.next(),
      bookingId: booking._id,
      folioId: folio._id,
      lines: charges.map((c) => ({
        description: c.description,
        quantity: c.quantity,
        unitPrice: c.amount,
        amount: c.amount * c.quantity,
      })),
      subtotal,
      tax,
      total: subtotal + tax,
      issuedBy: command.receptionistId,
    });

    // Step 10 — close the stay and the folio.
    booking.status = BookingStateMachine.next(booking.status, 'CHECK_OUT');
    booking.actualCheckOutAt = new Date();
    await booking.save();

    // A targeted update, not folio.save(): `folio` was loaded before the ledger
    // moved the balance, so saving the whole document would risk stale values.
    await Folio.updateOne(
      { _id: folio._id },
      { $set: { status: FolioStatus.CLOSED, closedAt: new Date() } },
    );

    // Step 11 — «include» UC-R13: release the room to housekeeping.
    if (booking.roomId) {
      await RoomAllocator.release(booking.roomId);
      await Task.create({
        title: 'Clean room after check-out',
        description: `Room requires cleaning following booking ${booking.bookingCode}`,
        assignedTo: command.receptionistId, // reassigned by the housekeeping supervisor
        assignedBy: command.receptionistId,
        roomId: booking.roomId,
        priority: 'HIGH',
      });
    }

    // Step 12 — BR-29: loyalty points are credited only on a completed stay.
    if (booking.customerId) {
      const points = Math.floor(booking.subtotal * 0.01);
      await LoyaltyAccount.findOneAndUpdate(
        { customerId: booking.customerId },
        { $inc: { pointBalance: points, lifetimePoints: points } },
        { upsert: true },
      );
    }

    await AuditService.record({
      action: 'GUEST_CHECKED_OUT',
      entityType: 'Booking',
      entityId: String(booking._id),
      actorId: command.receptionistId,
      after: { invoiceNumber: invoice.invoiceNumber, total: invoice.total },
    });

    return { booking, invoice };
  }
}
