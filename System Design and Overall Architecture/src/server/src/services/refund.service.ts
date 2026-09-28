/**
 * «control» / «coordinator» RefundCoordinator
 *
 * Drives the refund request across its approval workflow, from the Customer's
 * submission through the Manager's decision to the gateway settlement.
 *
 * Enforces: BR-35 refund to the original method, BR-36 90-day window,
 *           BR-37 never exceed the captured amount, BR-38 approval threshold,
 *           BR-39 every decision is audit-logged with its approver.
 * Realizes: UC-C17 Request Refund, UC-M14 Approve Refund Request.
 */
import { randomUUID } from 'crypto';
import { RefundRequest, IRefundRequest, Payment } from '../models/billing.model';
import { Booking } from '../models/booking.model';
import { User } from '../models/user.model';
import { PaymentStatus, RefundStatus } from '../models/enums';
import { PaymentService } from './payment.service';
import { NotificationProxy } from '../proxies/notification.proxy';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';

/** BR-36 — requests must be made within 90 days of payment. */
export const REFUND_WINDOW_DAYS = 90;
/** BR-38 — above this amount a Manager must decide (minor units). */
export const AUTO_APPROVE_THRESHOLD = 500_000;

export interface RequestRefundCommand {
  bookingId: string;
  customerId: string;
  amount: number;
  reasonCategory: string;
  description?: string;
}

export interface RefundDecisionCommand {
  refundId: string;
  approverId: string;
  approve: boolean;
  approvedAmount?: number;
  note?: string;
}

export class RefundCoordinator {
  /** UC-C17 Normal Flow steps 1–7. */
  static async request(command: RequestRefundCommand): Promise<IRefundRequest> {
    const booking = await Booking.findById(command.bookingId);
    if (!booking) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found', 404);

    // PRE-2 — the customer must own the booking.
    if (String(booking.customerId) !== command.customerId) {
      throw new AppError('FORBIDDEN', 'You may only request a refund for your own booking', 403);
    }

    const payment = await Payment.findOne({
      bookingId: booking._id,
      status: PaymentStatus.PAID,
    }).sort({ paidAt: -1 });

    // UC-C17 exception 1.0.E1 — nothing was captured, so nothing is refundable.
    if (!payment) {
      throw new AppError(
        'NOT_REFUNDABLE',
        'No captured payment exists for this booking',
        400,
      );
    }

    // BR-36 — UC-C17 exception 1.0.E2.
    const ageDays = (Date.now() - (payment.paidAt?.getTime() ?? 0)) / 86_400_000;
    if (ageDays > REFUND_WINDOW_DAYS) {
      throw new AppError(
        'WINDOW_EXPIRED',
        `Refund requests must be made within ${REFUND_WINDOW_DAYS} days of payment`,
        400,
      );
    }

    // PRE-3 / exception 1.0.E3 — one open request per payment.
    const open = await RefundRequest.findOne({
      paymentId: payment._id,
      status: { $in: [RefundStatus.PENDING, RefundStatus.APPROVED] },
    });
    if (open) {
      throw new AppError(
        'DUPLICATE_REQUEST',
        `A refund request (${open.referenceNumber}) is already in progress`,
        409,
        { referenceNumber: open.referenceNumber, status: open.status },
      );
    }

    // BR-37 — a refund may never exceed what is still refundable: the amount
    // captured, minus every reversal already committed. A FAILED reversal is
    // committed too — with payOS it means "owed, to be transferred by hand" —
    // so without subtracting it a guest could claim the same money twice.
    const reversals = await Payment.find({
      reversalOfId: payment._id,
      status: { $in: [PaymentStatus.REVERSED, PaymentStatus.FAILED] },
    });
    const alreadyRefunded = reversals.reduce((sum, r) => sum + r.amount, 0);
    const remaining = payment.amount - alreadyRefunded;
    if (remaining <= 0) {
      throw new AppError(
        'ALREADY_REFUNDED',
        'This payment has already been refunded in full — the transfer is on its way',
        409,
      );
    }
    const amount = Math.min(command.amount, remaining);

    const request = await RefundRequest.create({
      referenceNumber: this.generateReference(),
      bookingId: booking._id,
      paymentId: payment._id,
      requestedBy: command.customerId,
      requestedAmount: amount,
      reasonCategory: command.reasonCategory,
      description: command.description ?? '',
      status: RefundStatus.PENDING,
    });

    await AuditService.record({
      action: 'REFUND_REQUESTED',
      entityType: 'RefundRequest',
      entityId: String(request._id),
      actorId: command.customerId,
      after: { amount, reason: command.reasonCategory },
    });

    // UC-C17 alternative flow 1.1 — small in-policy refunds skip the queue.
    if (amount <= AUTO_APPROVE_THRESHOLD) {
      return this.decide({
        refundId: String(request._id),
        approverId: 'SYSTEM',
        approve: true,
        approvedAmount: amount,
        note: 'BR-38: auto-approved below the manager threshold',
      });
    }

    // Step 7 — acknowledge to the customer while the manager reviews.
    await NotificationProxy.sendDecisionNotice(
      booking.guest.email,
      `Refund request received — ${request.referenceNumber}`,
      `We have received your refund request for ${this.formatMoney(amount)}. ` +
        `You will hear from us within 3 working days.`,
    ).catch(() => undefined);

    return request;
  }

  /** UC-M14 — the manager's pending queue. */
  static async pendingQueue(): Promise<IRefundRequest[]> {
    return RefundRequest.find({ status: RefundStatus.PENDING })
      .populate('bookingId', 'bookingCode guest checkInDate checkOutDate totalAmount')
      .populate('requestedBy', 'fullName email')
      .sort({ createdAt: 1 });
  }

  /**
   * UC-M14 / UC-C17 steps 8–12.
   *
   * On approval the money is sent through PaymentService, which reverses
   * against the original transaction (BR-35). A gateway failure leaves the
   * request APPROVED with a REFUND_FAILED flag rather than silently losing it
   * — UC-C17 exception 1.0.E4.
   */
  static async decide(command: RefundDecisionCommand): Promise<IRefundRequest> {
    const request = await RefundRequest.findById(command.refundId);
    if (!request) throw new AppError('NOT_FOUND', 'Refund request not found', 404);

    if (request.status !== RefundStatus.PENDING) {
      throw new AppError(
        'ALREADY_DECIDED',
        `This request has already been ${request.status.toLowerCase()}`,
        409,
      );
    }

    if (!command.approve) {
      // Alternative flow 1.4 — a rejection must explain itself.
      if (!command.note?.trim()) {
        throw new AppError('REASON_REQUIRED', 'A rejection requires a reason', 400);
      }
      request.status = RefundStatus.REJECTED;
      request.decidedBy = command.approverId as never;
      request.decidedAt = new Date();
      request.decisionNote = command.note;
      await request.save();

      await this.notifyOutcome(request, 'rejected', command.note);
      await this.auditDecision(request, command, 'REFUND_REJECTED');
      return request;
    }

    // Alternative flow 1.2 — a partial approval may not exceed the request.
    const approved = Math.min(
      command.approvedAmount ?? request.requestedAmount,
      request.requestedAmount,
    );

    request.status = RefundStatus.APPROVED;
    request.approvedAmount = approved;
    request.decidedBy = command.approverId as never;
    request.decidedAt = new Date();
    request.decisionNote = command.note;
    await request.save();

    // Steps 10–11 — settle through the original payment channel.
    const { reversal } = await PaymentService.refund(
      String(request.bookingId),
      approved,
      command.approverId,
    );

    if (reversal && reversal.status === PaymentStatus.REVERSED) {
      request.status = RefundStatus.COMPLETED;
      request.gatewayRefundRef = reversal.gatewayRef;
    } else {
      // With payOS this is the normal outcome: there is no refund API, so the
      // approved amount waits here for an operator's manual bank transfer.
      request.status = RefundStatus.REFUND_FAILED;
    }
    await request.save();

    await this.notifyOutcome(
      request,
      request.status === RefundStatus.COMPLETED ? 'approved' : 'approved (settlement pending)',
      command.note,
    );
    await this.auditDecision(request, command, 'REFUND_APPROVED');

    return request;
  }

  // ------------------------------------------------------------------------

  private static async notifyOutcome(
    request: IRefundRequest,
    outcome: string,
    note?: string,
  ): Promise<void> {
    const customer = await User.findById(request.requestedBy);
    if (!customer) return;

    await NotificationProxy.sendDecisionNotice(
      customer.email,
      `Refund request ${outcome} — ${request.referenceNumber}`,
      `Your refund request has been ${outcome}.\n` +
        (request.approvedAmount
          ? `Amount: ${this.formatMoney(request.approvedAmount)}\n` +
            `Settlement takes 7–14 working days.\n`
          : '') +
        (note ? `\nNote: ${note}` : ''),
    ).catch(() => undefined);
  }

  /** BR-39 — the approver identity is part of the permanent record. */
  private static async auditDecision(
    request: IRefundRequest,
    command: RefundDecisionCommand,
    action: string,
  ): Promise<void> {
    await AuditService.record({
      action,
      entityType: 'RefundRequest',
      entityId: String(request._id),
      actorId: command.approverId,
      after: {
        approvedAmount: request.approvedAmount,
        finalStatus: request.status,
        note: command.note,
      },
    });
  }

  private static generateReference(): string {
    return `RF-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
  }

  private static formatMoney(minorUnits: number): string {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(
      minorUnits,
    );
  }
}
