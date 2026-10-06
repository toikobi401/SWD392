/**
 * «entity» Folio / Charge / Payment / Invoice / RefundRequest
 *
 * Static model: §5.2. All monetary amounts are stored as integer minor units
 * (e.g. VND đồng, USD cents) so that no floating-point error can enter a total —
 * see §8.1 Performance / Integrity.
 *
 * Realizes: UC-G10 Pay for Booking, UC-R09 Check Out, UC-R15 Process Payment,
 *           UC-C17 Request Refund, UC-M14 Approve Refund.
 */
import { Schema, model, Document, Types } from 'mongoose';
import { PaymentStatus, PaymentMethod, FolioStatus, ChargeType, RefundStatus } from './enums';

// --------------------------------------------------------------------------
// Charge — a single posted line on a folio
// --------------------------------------------------------------------------

export interface ICharge extends Document {
  folioId: Types.ObjectId;
  type: ChargeType;
  description: string;
  amount: number;
  quantity: number;
  postedBy: Types.ObjectId;
  postedAt: Date;
  isDisputed: boolean;
}

export const Charge = model<ICharge>(
  'Charge',
  new Schema<ICharge>({
    folioId: { type: Schema.Types.ObjectId, ref: 'Folio', required: true, index: true },
    type: { type: String, enum: Object.values(ChargeType), required: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    quantity: { type: Number, default: 1 },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    postedAt: { type: Date, default: Date.now },
    // UC-R09 exception 1.0.E2 — a disputed item is excluded from the settled balance.
    isDisputed: { type: Boolean, default: false },
  }),
);

// --------------------------------------------------------------------------
// Folio — the guest account for one stay (opened at check-in, closed at check-out)
// --------------------------------------------------------------------------

export interface IFolio extends Document {
  bookingId: Types.ObjectId;
  status: FolioStatus;
  totalCharges: number;
  totalPayments: number;
  balance: number;
  depositHeld: number;
  closedAt?: Date;
}

const folioSchema = new Schema<IFolio>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    status: { type: String, enum: Object.values(FolioStatus), default: FolioStatus.OPEN },
    totalCharges: { type: Number, default: 0 },
    totalPayments: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    depositHeld: { type: Number, default: 0 },
    closedAt: Date,
  },
  { timestamps: true },
);

export const Folio = model<IFolio>('Folio', folioSchema);

// --------------------------------------------------------------------------
// Payment — immutable once PAID (BR-33); corrections are made by a reversal entry
// --------------------------------------------------------------------------

export interface IPayment extends Document {
  bookingId: Types.ObjectId;
  folioId?: Types.ObjectId;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  /** BR-15 — guarantees at-most-once capture across retries (UC-G10 exception 1.0.E3). */
  idempotencyKey: string;
  gatewayRef?: string;
  gatewayMessage?: string;
  /**
   * payOS requires an integer `orderCode`, unique per merchant for all time —
   * it cannot reuse our UUID idempotency key. One payOS link pays a whole
   * reservation, so the rooms' payments share this number and the webhook
   * settles all of them together.
   */
  gatewayOrderCode?: number;
  /** Hosted checkout page the guest is redirected to (UC-G10 step 5). */
  checkoutUrl?: string;
  /** VietQR payload, for rendering a QR at the front desk (UC-R15). */
  qrCode?: string;
  /** When the payOS link stops accepting payment. */
  expiresAt?: Date;
  /** Set once the reservation confirmation was sent (UC-G12, exactly once). */
  notifiedAt?: Date;
  /** Null for an online payment; set to the cashier for a desk payment (BR-31). */
  cashierId?: Types.ObjectId;
  drawerSessionId?: Types.ObjectId;
  paidAt?: Date;
  reversalOfId?: Types.ObjectId;
}

const paymentSchema = new Schema<IPayment>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    folioId: { type: Schema.Types.ObjectId, ref: 'Folio', index: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: Object.values(PaymentMethod), required: true },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
      index: true,
    },
    idempotencyKey: { type: String, required: true, unique: true },
    gatewayRef: String,
    gatewayMessage: String,
    // Not unique: every room of a reservation carries the same order code.
    // Uniqueness per payOS link comes from the generator, and payOS itself
    // rejects a reused code. Sparse: cash never gets one.
    gatewayOrderCode: { type: Number, index: true, sparse: true },
    checkoutUrl: String,
    qrCode: String,
    expiresAt: Date,
    notifiedAt: Date,
    cashierId: { type: Schema.Types.ObjectId, ref: 'User' },
    drawerSessionId: { type: Schema.Types.ObjectId, ref: 'DrawerSession' },
    paidAt: Date,
    reversalOfId: { type: Schema.Types.ObjectId, ref: 'Payment' },
  },
  { timestamps: true },
);

export const Payment = model<IPayment>('Payment', paymentSchema);

// --------------------------------------------------------------------------
// Invoice — immutable once issued, gapless sequential numbering (BR-30)
// --------------------------------------------------------------------------

export interface IInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface IInvoice extends Document {
  invoiceNumber: string;
  bookingId: Types.ObjectId;
  folioId: Types.ObjectId;
  lines: IInvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  issuedAt: Date;
  issuedBy: Types.ObjectId;
  creditNoteOfId?: Types.ObjectId;
}

export const Invoice = model<IInvoice>(
  'Invoice',
  new Schema<IInvoice>({
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    folioId: { type: Schema.Types.ObjectId, ref: 'Folio', required: true },
    lines: [
      {
        description: String,
        quantity: Number,
        unitPrice: Number,
        amount: Number,
      },
    ],
    subtotal: { type: Number, required: true },
    tax: { type: Number, required: true },
    total: { type: Number, required: true },
    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // BR-30: an issued invoice is never edited — a correction is a credit note.
    creditNoteOfId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  }),
);

/** Supports the gapless InvoiceNumberGenerator «algorithm» object. */
export const InvoiceCounter = model(
  'InvoiceCounter',
  new Schema({
    key: { type: String, required: true, unique: true }, // e.g. "INV-2026"
    seq: { type: Number, default: 0 },
  }),
);

// --------------------------------------------------------------------------
// RefundRequest — UC-C17 / UC-M14 approval workflow
// --------------------------------------------------------------------------

export interface IRefundRequest extends Document {
  referenceNumber: string;
  bookingId: Types.ObjectId;
  paymentId: Types.ObjectId;
  requestedBy: Types.ObjectId;
  requestedAmount: number;
  approvedAmount?: number;
  reasonCategory: string;
  description: string;
  status: RefundStatus;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  decisionNote?: string;
  gatewayRefundRef?: string;
}

export const RefundRequest = model<IRefundRequest>(
  'RefundRequest',
  new Schema<IRefundRequest>(
    {
      referenceNumber: { type: String, required: true, unique: true },
      bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
      paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
      requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      requestedAmount: { type: Number, required: true, min: 1 },
      // Invariant §5.3: approvedAmount ≤ requestedAmount ≤ amount captured (BR-37).
      approvedAmount: { type: Number, min: 0 },
      reasonCategory: { type: String, required: true },
      description: { type: String, default: '' },
      status: {
        type: String,
        enum: Object.values(RefundStatus),
        default: RefundStatus.PENDING,
        index: true,
      },
      decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      decidedAt: Date,
      decisionNote: String,
      gatewayRefundRef: String,
    },
    { timestamps: true },
  ),
);

// --------------------------------------------------------------------------
// DrawerSession — BR-32, cash payments must belong to an open drawer session
// --------------------------------------------------------------------------

export interface IDrawerSession extends Document {
  cashierId: Types.ObjectId;
  openedAt: Date;
  closedAt?: Date;
  openingFloat: number;
  expectedCash: number;
  countedCash?: number;
  isOpen: boolean;
}

export const DrawerSession = model<IDrawerSession>(
  'DrawerSession',
  new Schema<IDrawerSession>({
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,
    openingFloat: { type: Number, default: 0 },
    expectedCash: { type: Number, default: 0 },
    countedCash: Number,
    isOpen: { type: Boolean, default: true, index: true },
  }),
);
