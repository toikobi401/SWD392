/**
 * «control» PaymentService
 *
 * Coordinates the money-handling objects: creates the Payment entity, drives the
 * PaymentGatewayProxy (payOS), and reconciles the outcome. The gateway protocol
 * lives in the proxy; the policy on what a given outcome means lives here.
 *
 * payOS is asynchronous (see PaymentGatewayProxy): a gateway payment is created
 * PENDING and settled later by whichever arrives first — the payOS webhook, or
 * the reconcile call made when the guest returns from checkout. Both paths
 * converge on `confirmFromGateway`, whose state change is atomic, so the
 * money is booked exactly once even when both arrive together.
 *
 * Enforces: BR-15 idempotency, BR-31 every payment attributed to a folio and a
 *           cashier, BR-32 cash requires an open drawer, BR-33 payments are
 *           immutable (corrections are reversals), BR-37 refund ≤ captured.
 * Realizes: UC-G10 Pay for Booking, UC-R15 Process Payment, UC-R17 Process Refund.
 */
import { randomInt, randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { Payment, IPayment, Folio, DrawerSession } from '../models/billing.model';
import { Booking, InventoryHold } from '../models/booking.model';
import { BookingStatus, PaymentMethod, PaymentStatus } from '../models/enums';
import { BookingStateMachine } from '../rules/booking-state-machine';
import {
  PaymentGatewayProxy,
  PAYOS_DESCRIPTION_MAX,
} from '../proxies/payment-gateway.proxy';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';

/** Methods settled at the desk with no gateway round-trip. */
const LOCAL_METHODS = [PaymentMethod.CASH, PaymentMethod.VOUCHER];

export interface ChargeCommand {
  amount: number;
  method: PaymentMethod;
  /** Short human reference; trimmed to payOS's 9-character limit. */
  reference: string;
  bookingId?: string;
  folioId?: string;
  /** Set for a desk payment (UC-R15); absent for an online one (UC-G10). */
  cashierId?: string;
  /** Supplied by the caller to make a retry safe; generated when omitted. */
  idempotencyKey?: string;
  /** When the payment link must stop accepting money. */
  expiresAt?: Date;
  buyer?: { name?: string; email?: string; phone?: string };
}

export interface ReconcileResult {
  orderCode: number;
  paymentStatus: PaymentStatus;
  gatewayStatus: string;
  bookingStatus?: BookingStatus;
  bookingCode?: string;
}

export class PaymentService {
  /**
   * UC-G10 Normal Flow, and UC-R15 for a desk payment.
   *
   * The Payment row — including its payOS orderCode — is written PENDING
   * *before* the gateway is called. If the call then times out, the row is
   * still there for the webhook or the reconciler to find: never a charge with
   * no local trace.
   */
  static async charge(command: ChargeCommand): Promise<IPayment> {
    if (!Number.isInteger(command.amount) || command.amount <= 0) {
      throw new AppError('INVALID_AMOUNT', 'Amount must be a positive integer', 400);
    }

    const idempotencyKey = command.idempotencyKey ?? randomUUID();

    // BR-15 — a retry with the same key returns the original attempt rather
    // than starting a second one (UC-R15 exception 1.0.E4).
    const existing = await Payment.findOne({ idempotencyKey });
    if (existing) return existing;

    // BR-32 — cash must belong to an open drawer session.
    let drawerSessionId: Types.ObjectId | undefined;
    if (command.method === PaymentMethod.CASH) {
      if (!command.cashierId) {
        throw new AppError('CASHIER_REQUIRED', 'BR-31: a cash payment requires a cashier', 400);
      }
      const drawer = await DrawerSession.findOne({ cashierId: command.cashierId, isOpen: true });
      if (!drawer) {
        // UC-R15 exception 1.0.E5.
        throw new AppError(
          'NO_OPEN_DRAWER',
          'BR-32: open a cash drawer session before taking a cash payment',
          409,
        );
      }
      drawerSessionId = drawer._id as Types.ObjectId;
    }

    const isLocal = LOCAL_METHODS.includes(command.method);

    const payment = await Payment.create({
      bookingId: command.bookingId,
      folioId: command.folioId,
      amount: command.amount,
      method: command.method,
      status: PaymentStatus.PENDING,
      idempotencyKey,
      gatewayOrderCode: isLocal ? undefined : this.newOrderCode(),
      expiresAt: command.expiresAt,
      cashierId: command.cashierId,
      drawerSessionId,
    });

    if (isLocal) {
      return (await this.transition(payment._id, true, 'LOCAL')) ?? payment;
    }

    const orderCode = payment.gatewayOrderCode!;
    const frontend = (process.env.FRONTEND_URL ?? 'http://localhost:3001').replace(/\/$/, '');

    let result;
    try {
      result = await PaymentGatewayProxy.charge({
        orderCode,
        amount: command.amount,
        description: this.description(command.reference),
        // orderCode in the PATH, not the query: payOS appends its own query
        // parameters to these URLs, so ours must not collide with them.
        returnUrl: `${frontend}/payment/result/${orderCode}`,
        cancelUrl: `${frontend}/payment/cancelled/${orderCode}`,
        expiresAt: command.expiresAt,
        buyer: command.buyer,
      });
    } catch (err) {
      // Timeout: the link may exist — stay PENDING, reconcile later.
      if ((err as AppError).code === 'GATEWAY_TIMEOUT') return payment;
      // Unreachable / misconfigured: nothing was created, so it is a failure.
      await this.transition(payment._id, false, undefined, (err as Error).message);
      throw err;
    }

    if (result.outcome === 'DECLINED') {
      // UC-G10 exception 1.0.E1 — payOS refused to create the link.
      return (await this.transition(payment._id, false, undefined, result.message)) ?? payment;
    }

    payment.checkoutUrl = result.redirectUrl;
    payment.qrCode = result.qrCode;
    await payment.save();
    return payment;
  }

  /**
   * UC-R15 Process Payment — a payment taken at the desk against a folio.
   * Refuses to collect more than is owed (exception 1.0.E3) and requires the
   * folio to still be open. A payOS payment here returns a QR for the guest to
   * scan; the folio balance falls when the payment is confirmed.
   */
  static async takeDeskPayment(command: {
    folioId: string;
    amount: number;
    method: PaymentMethod;
    cashierId: string;
    idempotencyKey?: string;
  }): Promise<{ payment: IPayment; balance: number }> {
    const folio = await Folio.findById(command.folioId);
    if (!folio) throw new AppError('NOT_FOUND', 'Folio not found', 404);
    if (folio.status !== 'OPEN') {
      throw new AppError('FOLIO_CLOSED', 'This stay has already been checked out', 409);
    }

    // A retry with an already-used key replays the original result (BR-15)
    // instead of being judged against the now-reduced balance.
    if (command.idempotencyKey) {
      const replay = await Payment.findOne({ idempotencyKey: command.idempotencyKey });
      if (replay) return { payment: replay, balance: folio.balance };
    }

    if (command.amount > folio.balance) {
      throw new AppError(
        'AMOUNT_EXCEEDS_BALANCE',
        `The amount exceeds the outstanding balance of ${folio.balance}`,
        400,
      );
    }

    const payment = await this.charge({
      amount: command.amount,
      method: command.method,
      reference: 'HMSDESK',
      bookingId: String(folio.bookingId),
      folioId: String(folio._id),
      cashierId: command.cashierId,
      idempotencyKey: command.idempotencyKey,
    });

    const updated = await Folio.findById(folio._id);
    return { payment, balance: updated!.balance };
  }

  /**
   * Webhook entry point — UC-G10 step 8. Verifies the payOS signature, then
   * applies the outcome.
   *
   * payOS also calls the webhook with a sample payload when the URL is
   * registered (UC-A12); that order does not exist here, which is fine — the
   * call is acknowledged and ignored.
   */
  static async handleWebhook(body: unknown): Promise<{ applied: boolean }> {
    const data = PaymentGatewayProxy.verifyWebhook(body);

    const payment = await this.confirmFromGateway({
      orderCode: Number(data.orderCode),
      approved: data.code === '00',
      reference: data.reference,
      amount: Number(data.amount),
    });
    return { applied: Boolean(payment) };
  }

  /** UC-A12 Configure Payment Gateway — registers the webhook URL with payOS. */
  static async registerWebhook(webhookUrl: string, actorId: string): Promise<void> {
    if (!/^https:\/\//.test(webhookUrl)) {
      throw new AppError('INVALID_URL', 'payOS requires a public HTTPS webhook URL', 400);
    }
    await PaymentGatewayProxy.confirmWebhookUrl(webhookUrl);
    await AuditService.record({
      action: 'PAYMENT_WEBHOOK_REGISTERED',
      entityType: 'Settings',
      actorId,
      after: { webhookUrl },
    });
  }

  /**
   * Asks payOS for the link's live status and applies it — called when the
   * guest lands back on our result page (UC-G10 alternative flow 1.3).
   *
   * Never trust the query string payOS appends to the return URL: anyone can
   * type `?status=PAID` into a browser. Only the server-to-server answer from
   * payOS (or a signed webhook) may move money.
   */
  static async reconcile(orderCode: number): Promise<ReconcileResult> {
    const payment = await Payment.findOne({ gatewayOrderCode: orderCode });
    if (!payment) throw new AppError('NOT_FOUND', 'No payment with that order code', 404);

    let gatewayStatus: string = payment.status;

    if (payment.status === PaymentStatus.PENDING) {
      const link = await PaymentGatewayProxy.getStatus(orderCode);
      gatewayStatus = link.status;

      if (link.status === 'PAID') {
        await this.confirmFromGateway({
          orderCode,
          approved: true,
          reference: link.reference,
          amount: link.amountPaid,
        });
      } else if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(link.status)) {
        await this.confirmFromGateway({ orderCode, approved: false });
      }
      // PENDING / PROCESSING / UNDERPAID: nothing to apply yet.
    }

    const [fresh, booking] = await Promise.all([
      Payment.findById(payment._id),
      Booking.findById(payment.bookingId),
    ]);

    return {
      orderCode,
      paymentStatus: fresh!.status,
      gatewayStatus,
      bookingStatus: booking?.status,
      bookingCode: booking?.bookingCode,
    };
  }

  /**
   * The single place a gateway outcome is applied — shared by the webhook and
   * the reconciler.
   *
   * Exactly-once: the PENDING → PAID/FAILED change is a conditional atomic
   * update, so when the webhook and the returning guest arrive together only
   * one of them wins, and the folio, the booking and the audit trail are
   * updated once.
   */
  static async confirmFromGateway(outcome: {
    orderCode: number;
    approved: boolean;
    reference?: string;
    amount?: number;
  }): Promise<IPayment | null> {
    const payment = await Payment.findOne({ gatewayOrderCode: outcome.orderCode });
    if (!payment) return null; // e.g. payOS's sample webhook
    if (payment.status !== PaymentStatus.PENDING) return payment; // already applied

    // A paid amount that differs from what we asked for is never settled
    // automatically: it is either tampering or a partial (UNDERPAID) transfer.
    if (outcome.approved && outcome.amount !== undefined && outcome.amount !== payment.amount) {
      await AuditService.record({
        action: 'PAYMENT_AMOUNT_MISMATCH',
        entityType: 'Payment',
        entityId: String(payment._id),
        after: { expected: payment.amount, received: outcome.amount, orderCode: outcome.orderCode },
      });
      return payment;
    }

    const updated = await this.transition(
      payment._id,
      outcome.approved,
      outcome.reference ?? String(outcome.orderCode),
    );
    if (!updated) return Payment.findById(payment._id); // lost the race — already applied

    // Advance the booking this payment was holding open (§6.4): an online
    // booking waits in PENDING until this moment.
    const booking = await Booking.findById(updated.bookingId);
    if (booking && booking.status === BookingStatus.PENDING) {
      booking.status = BookingStateMachine.next(
        booking.status,
        outcome.approved ? 'PAYMENT_CAPTURED' : 'PAYMENT_FAILED',
      );
      if (!outcome.approved) {
        booking.cancelledAt = new Date();
        booking.cancellationReason = 'Payment not completed';
      }
      await booking.save();
      // CONFIRMED now holds the inventory itself; CANCELLED releases it.
      await InventoryHold.deleteMany({ bookingId: booking._id });
    }

    return updated;
  }

  /**
   * UC-R17 / UC-C17 step 10 — returns money against a captured payment.
   * BR-37: a refund may never exceed what was actually captured.
   *
   * payOS has no refund API, so a gateway refund is recorded as a FAILED
   * reversal flagged for a manual bank transfer (UC-C17 exception 1.0.E4).
   */
  static async refund(
    bookingId: string,
    amount: number,
    actorId?: string,
  ): Promise<{ reversal: IPayment | null; manualTransferRequired: boolean }> {
    const captured = await Payment.find({ bookingId, status: PaymentStatus.PAID });

    const totalCaptured = captured.reduce((sum, p) => sum + p.amount, 0);
    if (amount > totalCaptured) {
      throw new AppError(
        'REFUND_EXCEEDS_CAPTURE',
        `BR-37: refund ${amount} exceeds the captured total ${totalCaptured}`,
        400,
      );
    }

    const source = captured.find((p) => p.gatewayOrderCode);
    if (!source) return { reversal: null, manualTransferRequired: false }; // cash — refunded at the desk

    const result = await PaymentGatewayProxy.refund(source.gatewayRef ?? '', amount);
    const approved = result.outcome === 'APPROVED';

    // BR-33 — the original payment is never mutated; a reversal row records
    // the correction so the audit trail stays complete.
    const reversal = await Payment.create({
      bookingId: source.bookingId,
      folioId: source.folioId,
      amount,
      method: source.method,
      status: approved ? PaymentStatus.REVERSED : PaymentStatus.FAILED,
      idempotencyKey: randomUUID(),
      gatewayRef: result.refundRef,
      gatewayMessage: result.message,
      reversalOfId: source._id,
      paidAt: approved ? new Date() : undefined,
    });

    await AuditService.record({
      action: approved
        ? 'REFUND_ISSUED'
        : result.outcome === 'NOT_SUPPORTED'
          ? 'REFUND_MANUAL_TRANSFER_REQUIRED'
          : 'REFUND_FAILED',
      entityType: 'Payment',
      entityId: String(source._id),
      actorId,
      after: { amount, bankReference: source.gatewayRef, reversalId: String(reversal._id) },
    });

    return { reversal, manualTransferRequired: !approved };
  }

  // ------------------------------------------------------------------------

  /**
   * Atomically moves a payment out of PENDING and applies the side effects.
   * @returns the updated payment, or null if it was no longer PENDING.
   */
  private static async transition(
    paymentId: unknown,
    approved: boolean,
    ref?: string,
    message?: string,
  ): Promise<IPayment | null> {
    const updated = await Payment.findOneAndUpdate(
      { _id: paymentId, status: PaymentStatus.PENDING },
      {
        $set: approved
          ? { status: PaymentStatus.PAID, gatewayRef: ref, paidAt: new Date() }
          : { status: PaymentStatus.FAILED, gatewayMessage: message },
      },
      { new: true },
    );
    if (!updated || !approved) return updated;

    if (updated.folioId) {
      await Folio.findByIdAndUpdate(updated.folioId, {
        $inc: { totalPayments: updated.amount, balance: -updated.amount },
      });
    }
    if (updated.drawerSessionId) {
      await DrawerSession.findByIdAndUpdate(updated.drawerSessionId, {
        $inc: { expectedCash: updated.amount },
      });
    }

    await AuditService.record({
      action: 'PAYMENT_CAPTURED',
      entityType: 'Payment',
      entityId: String(updated._id),
      actorId: updated.cashierId ? String(updated.cashierId) : undefined,
      after: { amount: updated.amount, method: updated.method, reference: ref },
    });

    return updated;
  }

  /**
   * payOS orderCodes must be unique per merchant for all time, including
   * across database resets in development — so they are time-based rather
   * than a counter that restarts at 1. ms × 1000 + 3 random digits stays well
   * below Number.MAX_SAFE_INTEGER (~1.8e15 vs 9.0e15); the unique index is
   * the final guard against the rare collision.
   */
  private static newOrderCode(): number {
    return Date.now() * 1000 + randomInt(1000);
  }

  /** payOS descriptions: ≤ 9 chars, letters/digits only for bank memos. */
  private static description(reference: string): string {
    return reference.replace(/[^A-Za-z0-9]/g, '').slice(0, PAYOS_DESCRIPTION_MAX) || 'HMS';
  }
}
