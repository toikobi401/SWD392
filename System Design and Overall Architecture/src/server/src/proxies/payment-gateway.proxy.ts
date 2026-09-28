/**
 * «boundary» / «proxy» PaymentGatewayProxy — payOS (https://payos.vn)
 *
 * Ch. 8: a proxy object encapsulates the interface to an external system. All
 * knowledge of the payOS wire protocol — base URL, headers, the two signature
 * algorithms, status codes — lives in this one class (quality scenario QA-5).
 *
 * payOS is a VietQR / bank-transfer gateway with an ASYNCHRONOUS model:
 *   1. we create a payment link and redirect the guest to its checkout page;
 *   2. the guest pays from their banking app;
 *   3. payOS notifies us by webhook (and we can also poll the link status).
 * A charge therefore never succeeds synchronously: `charge()` always returns
 * PENDING with a redirect URL, and the money is confirmed later.
 *
 * The signature algorithms mirror the official SDK `@payos/node` v2.0.5
 * (lib/crypto/node-crypto.js, lib/utils/convert-obj-to-query-str.js) exactly.
 *
 * Enforces: BR-15 idempotency (orderCode is unique per merchant), BR-16 card
 *           and bank data never reach HMS (payOS hosts the checkout).
 * Realizes: UC-G10 Pay for Booking, UC-R15 Process Payment, UC-A12 Configure
 *           Payment Gateway (webhook registration).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { AppError } from '../utils/app-error';

/** UC-G10 exception 1.0.E3 — the gateway must not hang a request forever. */
export const GATEWAY_TIMEOUT_MS = 30_000;

/**
 * payOS truncates/rejects longer descriptions when the receiving account is
 * not a payOS-linked bank account: "9 character limit for non-payOS linked
 * bank accounts". 9 is the safe ceiling for every account type.
 */
export const PAYOS_DESCRIPTION_MAX = 9;

/** From the SDK: `PaymentLinkStatus`. Note success is PAID, not SUCCEEDED. */
export type PayOSLinkStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PAID'
  | 'UNDERPAID'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

export interface ChargeRequest {
  /** Integer, unique per merchant for all time. */
  orderCode: number;
  /** Integer VND — never a float (§8.1 Integrity). */
  amount: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  /** Unix seconds; payOS stops accepting payment after this. */
  expiresAt?: Date;
  buyer?: { name?: string; email?: string; phone?: string };
  items?: { name: string; quantity: number; price: number }[];
}

export interface ChargeResult {
  /** payOS never approves synchronously; see the class comment. */
  outcome: 'PENDING' | 'DECLINED';
  orderCode: number;
  paymentLinkId?: string;
  /** Hosted checkout page — redirect the guest here (UC-G10 step 5). */
  redirectUrl?: string;
  /** VietQR payload — render as a QR at the front desk (UC-R15). */
  qrCode?: string;
  message?: string;
}

export interface LinkStatus {
  orderCode: number;
  status: PayOSLinkStatus;
  amount: number;
  amountPaid: number;
  amountRemaining: number;
  /** Bank transfer reference of the latest transaction, when paid. */
  reference?: string;
}

/** The `data` object of a payOS payment webhook, as documented. */
export interface PayOSWebhookData {
  orderCode: number;
  amount: number;
  description: string;
  accountNumber: string;
  reference: string;
  transactionDateTime: string;
  currency: string;
  paymentLinkId: string;
  code: string;
  desc: string;
  counterAccountBankId?: string | null;
  counterAccountBankName?: string | null;
  counterAccountName?: string | null;
  counterAccountNumber?: string | null;
  virtualAccountName?: string | null;
  virtualAccountNumber?: string | null;
}

export interface RefundResult {
  outcome: 'APPROVED' | 'FAILED' | 'NOT_SUPPORTED';
  refundRef?: string;
  message?: string;
}

export class PaymentGatewayProxy {
  /**
   * UC-G10 steps 4–5 — creates a payOS payment link.
   *
   * The orderCode doubles as the idempotency key on the payOS side: payOS
   * refuses a second link with the same orderCode, so a retried request can
   * never produce two payable links for one payment (BR-15).
   */
  static async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.validate(request);

    const body: Record<string, unknown> = {
      orderCode: request.orderCode,
      amount: request.amount,
      description: request.description,
      returnUrl: request.returnUrl,
      cancelUrl: request.cancelUrl,
      buyerName: request.buyer?.name,
      buyerEmail: request.buyer?.email,
      buyerPhone: request.buyer?.phone,
      items: request.items,
      expiredAt: request.expiresAt
        ? Math.floor(request.expiresAt.getTime() / 1000) // Int32 Unix seconds
        : undefined,
    };
    body.signature = this.signPaymentRequest({
      amount: request.amount,
      cancelUrl: request.cancelUrl,
      description: request.description,
      orderCode: request.orderCode,
      returnUrl: request.returnUrl,
    });

    const response = await this.call('POST', '/v2/payment-requests', body);

    if (response.code !== '00' || !response.data) {
      return {
        outcome: 'DECLINED',
        orderCode: request.orderCode,
        message: `payOS ${response.code}: ${response.desc ?? 'payment link rejected'}`,
      };
    }

    return {
      outcome: 'PENDING',
      orderCode: request.orderCode,
      paymentLinkId: response.data.paymentLinkId,
      redirectUrl: response.data.checkoutUrl,
      qrCode: response.data.qrCode,
    };
  }

  /**
   * Reads the live status of a link. Used to reconcile when the guest returns
   * from checkout — essential on a developer machine, where payOS cannot reach
   * a localhost webhook — and as the fallback if a webhook is lost.
   */
  static async getStatus(orderCode: number): Promise<LinkStatus> {
    const response = await this.call('GET', `/v2/payment-requests/${orderCode}`);

    if (response.code !== '00' || !response.data) {
      throw new AppError(
        'GATEWAY_ERROR',
        `payOS ${response.code}: ${response.desc ?? 'status unavailable'}`,
        502,
      );
    }

    const d = response.data;
    const latest = Array.isArray(d.transactions) ? d.transactions.at(-1) : undefined;
    return {
      orderCode: d.orderCode,
      status: d.status,
      amount: d.amount,
      amountPaid: d.amountPaid ?? 0,
      amountRemaining: d.amountRemaining ?? d.amount,
      reference: latest?.reference,
    };
  }

  /** Voids an unpaid link, e.g. when a booking is abandoned. */
  static async cancel(orderCode: number, reason: string): Promise<void> {
    await this.call('POST', `/v2/payment-requests/${orderCode}/cancel`, {
      cancellationReason: reason,
    });
  }

  /**
   * payOS has NO refund API (verified against its API reference). Money can
   * only go back by a manual bank transfer, so this reports NOT_SUPPORTED and
   * the caller routes the refund to an operator — UC-C17 exception 1.0.E4.
   */
  static async refund(_transactionRef: string, _amount: number): Promise<RefundResult> {
    return {
      outcome: 'NOT_SUPPORTED',
      message: 'payOS has no refund API — a manual bank transfer is required',
    };
  }

  /**
   * UC-G10 step 8 — authenticates a webhook. payOS signs every field of `data`
   * (sorted by key, `key=value&…`, HMAC-SHA256 with the checksum key). A bad
   * signature is rejected, never silently passed (exception 1.0.E4): anyone
   * can POST to a public webhook URL.
   *
   * @returns the verified `data` object.
   */
  static verifyWebhook(body: unknown): PayOSWebhookData {
    const { data, signature } = (body ?? {}) as { data?: unknown; signature?: unknown };

    if (!data || typeof data !== 'object') {
      throw new AppError('INVALID_WEBHOOK', 'Webhook has no data', 400);
    }
    if (typeof signature !== 'string' || !signature) {
      throw new AppError('INVALID_WEBHOOK', 'Webhook has no signature', 400);
    }

    const expected = this.signObject(data as Record<string, unknown>);
    if (!this.safeEqual(expected, signature)) {
      throw new AppError('INVALID_SIGNATURE', 'Webhook signature does not match', 400);
    }
    return data as PayOSWebhookData;
  }

  /**
   * UC-A12 — registers our webhook URL with payOS. payOS immediately calls it
   * with a test payload, so the endpoint must already be reachable (public
   * HTTPS; use a tunnel such as ngrok during development).
   */
  static async confirmWebhookUrl(webhookUrl: string): Promise<void> {
    const response = await this.call('POST', '/confirm-webhook', { webhookUrl });
    if (response.code !== '00') {
      throw new AppError(
        'WEBHOOK_REJECTED',
        `payOS ${response.code}: ${response.desc ?? 'webhook URL rejected'}`,
        400,
      );
    }
  }

  // ------------------------------------------------------------------------
  // Signatures — identical to @payos/node v2.0.5
  // ------------------------------------------------------------------------

  /**
   * Signature for creating a payment link: exactly these five fields, in this
   * alphabetical order (SDK: `createSignatureOfPaymentRequest`).
   */
  static signPaymentRequest(fields: {
    amount: number;
    cancelUrl: string;
    description: string;
    orderCode: number;
    returnUrl: string;
  }): string {
    const { amount, cancelUrl, description, orderCode, returnUrl } = fields;
    const payload =
      `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}` +
      `&orderCode=${orderCode}&returnUrl=${returnUrl}`;
    return createHmac('sha256', this.checksumKey()).update(payload).digest('hex');
  }

  /**
   * Signature over a whole object — used for webhook `data` (SDK:
   * `createSignatureFromObj` = `sortObjDataByKey` + `convertObjToQueryStr`).
   * Keys sorted; `undefined` keys dropped; null/'null'/'undefined' → '';
   * arrays JSON-stringified with each element's keys sorted.
   */
  static signObject(data: Record<string, unknown>): string {
    const sortKeys = (o: Record<string, unknown>) =>
      Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = o[k];
          return acc;
        }, {});

    const sorted = sortKeys(data);
    const payload = Object.keys(sorted)
      .filter((key) => sorted[key] !== undefined)
      .map((key) => {
        let value: unknown = sorted[key];
        if (value && Array.isArray(value)) {
          value = JSON.stringify(
            value.map((v) => sortKeys(v as Record<string, unknown>)),
          );
        }
        if ([null, undefined, 'undefined', 'null'].includes(value as string)) {
          value = '';
        }
        return `${key}=${value}`;
      })
      .join('&');

    return createHmac('sha256', this.checksumKey()).update(payload).digest('hex');
  }

  // ------------------------------------------------------------------------

  private static validate(request: ChargeRequest): void {
    if (!Number.isInteger(request.amount) || request.amount <= 0) {
      throw new AppError('INVALID_AMOUNT', 'Amount must be a positive integer (VND)', 400);
    }
    if (!Number.isSafeInteger(request.orderCode) || request.orderCode <= 0) {
      throw new AppError('INVALID_ORDER_CODE', 'orderCode must be a positive safe integer', 400);
    }
    if (request.description.length > PAYOS_DESCRIPTION_MAX) {
      throw new AppError(
        'DESCRIPTION_TOO_LONG',
        `payOS descriptions are limited to ${PAYOS_DESCRIPTION_MAX} characters`,
        400,
      );
    }
  }

  /** Constant-time comparison — a plain === leaks the signature through timing. */
  private static safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  private static checksumKey(): string {
    const key = process.env.PAYOS_CHECKSUM_KEY;
    if (!key) throw new AppError('CONFIG_ERROR', 'PAYOS_CHECKSUM_KEY is not configured', 500);
    return key;
  }

  /** The single place that knows the payOS base URL and auth headers. */
  private static async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ code: string; desc?: string; data?: any }> {
    const clientId = process.env.PAYOS_CLIENT_ID;
    const apiKey = process.env.PAYOS_API_KEY;
    if (!clientId || !apiKey) {
      throw new AppError('CONFIG_ERROR', 'PAYOS_CLIENT_ID / PAYOS_API_KEY are not configured', 500);
    }

    const baseUrl = process.env.PAYOS_BASE_URL ?? 'https://api-merchant.payos.vn';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);

    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-api-key': apiKey,
          ...(process.env.PAYOS_PARTNER_CODE
            ? { 'x-partner-code': process.env.PAYOS_PARTNER_CODE }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      return (await res.json()) as { code: string; desc?: string; data?: any };
    } catch (err) {
      // A timeout is NOT a decline: the link may or may not exist. Callers
      // leave the payment PENDING and reconcile (UC-G10 exception 1.0.E3).
      if ((err as Error).name === 'AbortError') {
        throw new AppError('GATEWAY_TIMEOUT', 'payOS did not respond in time', 504);
      }
      throw new AppError('GATEWAY_ERROR', 'payOS is unreachable', 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
