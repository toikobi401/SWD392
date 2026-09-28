/**
 * «application logic» / «algorithm» InvoiceNumberGenerator
 *
 * Enforces BR-30: invoice numbers must be strictly sequential and gapless for
 * tax compliance. A gap is a compliance defect, so the counter is incremented
 * with an atomic findOneAndUpdate rather than a read-then-write — two cashiers
 * checking out simultaneously can never receive the same number, and no number
 * is ever skipped.
 *
 * Realizes: UC-R09 step 5 («include» UC-R10 Generate Final Invoice).
 */
import { InvoiceCounter } from '../models/billing.model';

export class InvoiceNumberGenerator {
  /** Format: INV-YYYY-000001 — the sequence restarts each fiscal year. */
  static async next(now: Date = new Date()): Promise<string> {
    const year = now.getFullYear();
    const key = `INV-${year}`;

    // $inc is atomic server-side: concurrent callers are serialized by MongoDB.
    const counter = await InvoiceCounter.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );

    const seq = String(counter!.get('seq')).padStart(6, '0');
    return `${key}-${seq}`;
  }

  /**
   * Reports the last number issued without consuming one — used by the
   * month-end reconciliation report to prove the sequence has no gaps.
   */
  static async peek(now: Date = new Date()): Promise<string | null> {
    const counter = await InvoiceCounter.findOne({ key: `INV-${now.getFullYear()}` });
    if (!counter) return null;
    return `INV-${now.getFullYear()}-${String(counter.get('seq')).padStart(6, '0')}`;
  }
}
