/**
 * «boundary» / I/O PaymentController — payOS callbacks and reconciliation
 *
 * Realizes: UC-G10 steps 7–8 (gateway result), UC-G10 alternative flow 1.3
 *           (asynchronous confirmation), UC-A12 Configure Payment Gateway.
 */
import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service';
import { AppError } from '../utils/app-error';

export class PaymentController {
  /**
   * POST /api/payments/payos/webhook — called by payOS, not by a user.
   *
   * Public, so it carries no JWT: its authenticity comes solely from the HMAC
   * signature, which PaymentService verifies before anything else. An invalid
   * signature is answered 400 and changes nothing.
   *
   * A valid webhook is always acknowledged with 2xx — even for an order we do
   * not know (payOS's sample call on registration) — otherwise payOS keeps
   * retrying it.
   */
  static async webhook(req: Request, res: Response): Promise<void> {
    const { applied } = await PaymentService.handleWebhook(req.body);
    res.json({ success: true, applied });
  }

  /**
   * GET /api/payments/payos/:orderCode/reconcile — called by our result page
   * when the guest returns from the payOS checkout.
   *
   * It asks payOS server-to-server rather than trusting the `?status=PAID`
   * that payOS appends to the return URL, which anyone could type. It returns
   * statuses and the booking code only — never guest details — because the
   * orderCode is not a secret.
   */
  static async reconcile(req: Request, res: Response): Promise<void> {
    const orderCode = Number(req.params.orderCode);
    if (!Number.isSafeInteger(orderCode) || orderCode <= 0) {
      throw new AppError('INVALID_ORDER_CODE', 'orderCode must be a positive integer', 400);
    }
    res.json(await PaymentService.reconcile(orderCode));
  }

  /** POST /api/payments/payos/confirm-webhook — UC-A12 (admin) */
  static async registerWebhook(req: Request, res: Response): Promise<void> {
    await PaymentService.registerWebhook(String(req.body.webhookUrl ?? ''), req.auth!.sub);
    res.json({ message: 'Webhook URL registered with payOS' });
  }
}
