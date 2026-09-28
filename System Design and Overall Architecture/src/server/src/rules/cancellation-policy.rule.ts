/**
 * «application logic» / «business logic» CancellationPolicyRule
 *
 * Encapsulates the penalty tiers so that a change of hotel policy touches this
 * one class and nothing else (§8.1 Modifiability).
 *
 * Enforces: BR-17 free ≥ 48 h, BR-18 50 % between 48 h and 24 h,
 *           BR-19 100 % inside 24 h, BR-20 non-refundable rates.
 * Realizes: UC-G14 steps 3–4, UC-R05, UC-C17 eligibility check.
 */
import { IBooking } from '../models/booking.model';
import { BookingStatus } from '../models/enums';

export interface CancellationOutcome {
  allowed: boolean;
  /** Amount kept by the hotel. */
  penalty: number;
  /** Amount to be returned to the guest. */
  refundable: number;
  /** True when the penalty exceeds policy and a Manager must approve (UC-M14). */
  requiresApproval: boolean;
  reason: string;
}

export const FREE_CANCELLATION_HOURS = 48;
export const HALF_PENALTY_HOURS = 24;
export const APPROVAL_THRESHOLD_HOURS = 24;

export class CancellationPolicyRule {
  /**
   * Evaluates a cancellation at `now` against the booking's check-in date.
   *
   * @param isNonRefundableRate set when the booking was made on a non-refundable
   *        rate plan — BR-20, UC-G14 alternative flow 1.2.
   */
  static evaluate(
    booking: IBooking,
    now: Date = new Date(),
    isNonRefundableRate = false,
  ): CancellationOutcome {
    // UC-G14 exceptions 1.0.E1 / 1.0.E2 — only a confirmed booking may be cancelled.
    if (booking.status !== BookingStatus.CONFIRMED) {
      return {
        allowed: false,
        penalty: 0,
        refundable: 0,
        requiresApproval: false,
        reason: `A booking with status ${booking.status} cannot be cancelled`,
      };
    }

    const total = booking.totalAmount;

    if (isNonRefundableRate) {
      return {
        allowed: true,
        penalty: total,
        refundable: 0,
        requiresApproval: false,
        reason: 'BR-20: non-refundable rate — no refund is issued',
      };
    }

    const hoursUntilCheckIn =
      (booking.checkInDate.getTime() - now.getTime()) / 3_600_000;

    if (hoursUntilCheckIn >= FREE_CANCELLATION_HOURS) {
      return {
        allowed: true,
        penalty: 0,
        refundable: total,
        requiresApproval: false,
        reason: `BR-17: cancelled more than ${FREE_CANCELLATION_HOURS}h before check-in`,
      };
    }

    if (hoursUntilCheckIn >= HALF_PENALTY_HOURS) {
      const penalty = Math.round(total / 2);
      return {
        allowed: true,
        penalty,
        refundable: total - penalty,
        requiresApproval: false,
        reason: 'BR-18: 50% penalty within 48h of check-in',
      };
    }

    // Inside 24 h the penalty is total; any refund is discretionary and must be
    // approved by a Manager — UC-G14 alternative flow 1.1 → UC-M14.
    return {
      allowed: true,
      penalty: total,
      refundable: 0,
      requiresApproval: true,
      reason: `BR-19: 100% penalty within ${APPROVAL_THRESHOLD_HOURS}h of check-in`,
    };
  }
}
