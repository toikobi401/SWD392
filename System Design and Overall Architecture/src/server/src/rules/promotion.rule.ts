/**
 * «application logic» / «business logic» PromotionRule
 *
 * Every rule about what a promotion code is and when it applies, in one place:
 * the Manager's form (UC-M11), the guest's voucher preview (UC-G11) and the
 * booking itself (UC-G07) all ask this object, so they can never disagree.
 * The discount AMOUNT is PricingRule.discountFor(); this object decides
 * whether there is one.
 *
 * Enforces: BR-52 code format, BR-53 discount bounds, BR-54 validity window,
 *           BR-55 usage limit, BR-56 minimum spend, BR-57 terms fixed once used.
 * Realizes: UC-M11 Manage Promotion Codes, UC-G11 Apply Discount Code.
 */
import { IPromotion } from '../models/booking.model';
import { DiscountType } from '../models/enums';

/** BR-52 — 4 to 20 letters and digits, stored upper-case, so it is easy to read out and type. */
export const PROMOTION_CODE_PATTERN = /^[A-Z0-9]{4,20}$/;

/** What a Manager sees in the list; only ACTIVE codes discount a booking. */
export type PromotionStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'USED_UP' | 'INACTIVE';

/** The terms a Manager sets on a code. */
export interface PromotionTerms {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  validFrom: Date;
  validTo: Date;
  usageLimit: number;
  minimumSpend: number;
}

type PromotionState = Pick<
  IPromotion,
  'isActive' | 'validFrom' | 'validTo' | 'usageLimit' | 'usedCount' | 'minimumSpend'
>;

export type Applicability =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'INACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'USED_UP' | 'MIN_SPEND'; message: string };

export class PromotionRule {
  /**
   * The status on a given instant. Deactivation wins over everything else, so
   * a Manager who switches a code off sees "Inactive", not "Expired".
   */
  static statusOf(p: PromotionState, now: Date = new Date()): PromotionStatus {
    if (!p.isActive) return 'INACTIVE';
    if (now < p.validFrom) return 'SCHEDULED';
    if (now > p.validTo) return 'EXPIRED';
    // usageLimit 0 = unlimited.
    if (p.usageLimit > 0 && p.usedCount >= p.usageLimit) return 'USED_UP';
    return 'ACTIVE';
  }

  /**
   * UC-G11 — may this code discount a reservation of `subtotal` (before tax)
   * booked now? Validity is judged on the day of booking, not the stay dates:
   * a code valid in September may book a stay in December.
   */
  static applicability(
    p: PromotionState | null,
    subtotal: number,
    now: Date = new Date(),
    formatMoney: (n: number) => string = (n) => `${n.toLocaleString('vi-VN')} ₫`,
  ): Applicability {
    if (!p) return { ok: false, reason: 'NOT_FOUND', message: 'We do not recognise this voucher code' };

    switch (this.statusOf(p, now)) {
      case 'INACTIVE':
        return { ok: false, reason: 'INACTIVE', message: 'This voucher is no longer available' };
      case 'SCHEDULED':
        return { ok: false, reason: 'SCHEDULED', message: 'This voucher cannot be used yet' };
      case 'EXPIRED':
        return { ok: false, reason: 'EXPIRED', message: 'This voucher has expired' };
      case 'USED_UP':
        return { ok: false, reason: 'USED_UP', message: 'This voucher has reached its usage limit' };
    }

    // BR-56 — measured on the whole reservation, before tax.
    if (subtotal < p.minimumSpend) {
      return {
        ok: false,
        reason: 'MIN_SPEND',
        message: `This voucher applies to bookings of ${formatMoney(p.minimumSpend)} or more, before tax`,
      };
    }
    return { ok: true };
  }

  /**
   * UC-M11 — the problems with a set of terms, in words the Manager can act
   * on. An empty list means the terms are valid. `usedCount` is the code's
   * current usage, since a limit may not be set below it (BR-55).
   */
  static problemsWith(t: PromotionTerms, usedCount = 0): string[] {
    const problems: string[] = [];

    if (!PROMOTION_CODE_PATTERN.test(t.code)) {
      problems.push('Code must be 4 to 20 letters or digits, with no spaces');
    }
    if (!t.description?.trim()) problems.push('Add a short description guests will see');

    // BR-53
    if (!Object.values(DiscountType).includes(t.discountType)) {
      problems.push('Choose a percentage or a fixed amount');
    } else if (!Number.isInteger(t.discountValue) || t.discountValue <= 0) {
      problems.push('Discount must be a whole number above zero');
    } else if (t.discountType === DiscountType.PERCENTAGE && t.discountValue > 100) {
      problems.push('A percentage discount cannot exceed 100 %');
    }

    // BR-54
    if (Number.isNaN(t.validFrom.getTime()) || Number.isNaN(t.validTo.getTime())) {
      problems.push('Enter valid start and end dates');
    } else if (t.validTo <= t.validFrom) {
      problems.push('The end date must be on or after the start date');
    }

    // BR-55
    if (!Number.isInteger(t.usageLimit) || t.usageLimit < 0) {
      problems.push('Usage limit must be a whole number (0 for unlimited)');
    } else if (t.usageLimit > 0 && t.usageLimit < usedCount) {
      problems.push(`Usage limit cannot be below the ${usedCount} uses already made`);
    }

    // BR-56
    if (!Number.isInteger(t.minimumSpend) || t.minimumSpend < 0) {
      problems.push('Minimum spend must be a whole amount, 0 or more');
    }
    return problems;
  }

  /**
   * BR-57 — the code itself never changes: it has been printed and sent to
   * guests. Once a guest has booked with it, what it gives is fixed too: the
   * bookings already made record their discount, and a changed promise would
   * make the confirmation email and the audit trail disagree. The Manager
   * creates a new code for new terms. Dates, limit, minimum spend, wording and
   * visibility stay editable.
   */
  static lockedFields(hasBookings: boolean): (keyof PromotionTerms)[] {
    return hasBookings ? ['code', 'discountType', 'discountValue'] : ['code'];
  }
}
