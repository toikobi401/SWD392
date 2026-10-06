/**
 * «control» PromotionService
 *
 * The Manager's promotion codes: create, edit, switch on and off, delete an
 * unused one — and the guest-facing checks that read them. Every rule it
 * applies comes from PromotionRule; this object sequences the reads, the
 * conditional writes and the audit entries.
 *
 * Enforces: BR-52…BR-57 (via PromotionRule), BR-49 every change audit-logged.
 * Realizes: UC-M11 Manage Promotion Codes, UC-M19 View Promotion Usage,
 *           UC-M20 Create Promotion Code, UC-M21 Edit Promotion Code,
 *           UC-M22 Activate / Deactivate Promotion Code,
 *           UC-G06 View Promotions / Offers, UC-G11 Apply Discount Code.
 */
import { Types } from 'mongoose';
import { Booking, IPromotion, Promotion } from '../models/booking.model';
import { BookingStatus, DiscountType } from '../models/enums';
import { PromotionRule, PromotionStatus, PromotionTerms } from '../rules/promotion.rule';
import { PricingRule } from '../rules/pricing.rule';
import { AuditService } from './audit.service';
import { AppError } from '../utils/app-error';
import { hotelDateOf, hotelDayEnd, hotelDayStart } from '../utils/hotel-time';

/** The fields a Manager submits. Dates are hotel calendar dates, `YYYY-MM-DD`. */
export interface PromotionInput {
  code?: string;
  description?: string;
  discountType?: string;
  discountValue?: number;
  validFrom?: string;
  validTo?: string;
  usageLimit?: number;
  minimumSpend?: number;
  isPublic?: boolean;
}

/** UC-M19 — what the code has brought in, from the reservations still standing or stayed. */
export interface PromotionUsage {
  reservations: number;
  rooms: number;
  discountGiven: number;
  revenue: number;
}

export interface PromotionView {
  id: string;
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  /** Hotel calendar dates, inclusive. */
  validFrom: string;
  validTo: string;
  usageLimit: number;
  usedCount: number;
  minimumSpend: number;
  isActive: boolean;
  isPublic: boolean;
  status: PromotionStatus;
  usage: PromotionUsage;
  /** BR-57 — which terms can no longer change. */
  lockedFields: string[];
  /** Only a code no booking ever used may be deleted. */
  deletable: boolean;
  createdAt: Date;
}

/** What a guest may see about a code: never its usage or its limit. */
export interface PublicOffer {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  minimumSpend: number;
  validTo: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Bookings that were paid and not undone — the ones a Manager counts as business won. */
const STANDING = [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT];

export class PromotionService {
  // -------------------------------------------------------------------------
  // UC-M11 / UC-M19 — the Manager's list, with usage
  // -------------------------------------------------------------------------

  static async list(now: Date = new Date()): Promise<PromotionView[]> {
    const promotions = await Promotion.find().sort({ validTo: 1, code: 1 });
    const usage = await this.usageOf(promotions.map((p) => p._id as Types.ObjectId));
    // What needs attention first: live codes (ending soonest first), then
    // upcoming, then the ones that no longer apply.
    const rank: Record<PromotionStatus, number> = { ACTIVE: 0, SCHEDULED: 1, USED_UP: 2, INACTIVE: 3, EXPIRED: 4 };
    return promotions
      .map((p) => this.view(p, usage.get(String(p._id)), now))
      .sort((a, b) => rank[a.status] - rank[b.status]);
  }

  static async detail(id: string, now: Date = new Date()): Promise<PromotionView> {
    const p = await this.find(id);
    const usage = await this.usageOf([p._id as Types.ObjectId]);
    return this.view(p, usage.get(String(p._id)), now);
  }

  // -------------------------------------------------------------------------
  // UC-M20 Create Promotion Code
  // -------------------------------------------------------------------------

  static async create(input: PromotionInput, actorId: string): Promise<PromotionView> {
    const terms = this.termsFrom(input);
    const problems = PromotionRule.problemsWith(terms);
    // A new code that has already ended is a typing mistake, not a campaign.
    if (!problems.length && terms.validTo < new Date()) problems.push('The end date is already in the past');
    this.rejectIf(problems);

    // UC-M20 exception E2 — the code is taken (codes are compared upper-case).
    if (await Promotion.exists({ code: terms.code })) throw this.codeTaken(terms.code);

    let promotion: IPromotion;
    try {
      promotion = await Promotion.create({
        ...terms,
        isPublic: Boolean(input.isPublic),
        isActive: true,
        usedCount: 0,
        createdBy: actorId,
      });
    } catch (err) {
      // Two Managers creating the same code at once: the unique index decides.
      if ((err as { code?: number }).code === 11000) throw this.codeTaken(terms.code);
      throw err;
    }

    await AuditService.record({
      action: 'PROMOTION_CREATED',
      entityType: 'Promotion',
      entityId: String(promotion._id),
      actorId,
      after: this.auditable(promotion),
    });
    return this.detail(String(promotion._id));
  }

  // -------------------------------------------------------------------------
  // UC-M21 Edit Promotion Code
  // -------------------------------------------------------------------------

  static async update(id: string, input: PromotionInput, actorId: string): Promise<PromotionView> {
    const current = await this.find(id);
    const hasBookings = Boolean(await Booking.exists({ promotionId: current._id }));

    // BR-57 — refuse a change to a locked term, rather than silently ignore it.
    const locked = PromotionRule.lockedFields(hasBookings);
    const changed = locked.filter((field) => {
      if (input[field as keyof PromotionInput] === undefined) return false;
      const next = field === 'code' ? String(input.code).trim().toUpperCase() : input[field as keyof PromotionInput];
      return String(next) !== String(current[field as keyof IPromotion]);
    });
    if (changed.length) {
      throw new AppError(
        'PROMOTION_TERMS_LOCKED',
        changed.includes('code')
          ? 'A code cannot be renamed once created — guests may already have it. Create a new code instead.'
          : 'Guests have already booked with this code, so its discount cannot change. Create a new code for new terms.',
        409,
        { lockedFields: locked },
      );
    }

    const terms = this.termsFrom({
      code: current.code,
      description: input.description ?? current.description,
      discountType: input.discountType ?? current.discountType,
      discountValue: input.discountValue ?? current.discountValue,
      validFrom: input.validFrom ?? hotelDateOf(current.validFrom),
      validTo: input.validTo ?? hotelDateOf(current.validTo),
      usageLimit: input.usageLimit ?? current.usageLimit,
      minimumSpend: input.minimumSpend ?? current.minimumSpend,
    });
    this.rejectIf(PromotionRule.problemsWith(terms, current.usedCount));

    // BR-55 — a guest may pay while the Manager edits. The limit is written
    // only if usage is still at or below it, so a concurrent use can never
    // leave a code with more uses than its limit allows.
    const guard: Record<string, unknown> = { _id: current._id };
    if (terms.usageLimit > 0) guard.usedCount = { $lte: terms.usageLimit };

    const updated = await Promotion.findOneAndUpdate(
      guard,
      {
        $set: {
          description: terms.description,
          discountType: terms.discountType,
          discountValue: terms.discountValue,
          validFrom: terms.validFrom,
          validTo: terms.validTo,
          usageLimit: terms.usageLimit,
          minimumSpend: terms.minimumSpend,
          ...(input.isPublic !== undefined && { isPublic: Boolean(input.isPublic) }),
        },
      },
      { new: true },
    );
    if (!updated) {
      throw new AppError(
        'PROMOTION_LIMIT_BELOW_USAGE',
        'The code was used again while you were editing — the usage limit is now below its uses. Reload and try again.',
        409,
      );
    }

    await AuditService.record({
      action: 'PROMOTION_UPDATED',
      entityType: 'Promotion',
      entityId: id,
      actorId,
      before: this.auditable(current),
      after: this.auditable(updated),
    });
    return this.detail(id);
  }

  // -------------------------------------------------------------------------
  // UC-M22 Activate / Deactivate Promotion Code
  // -------------------------------------------------------------------------

  /**
   * Deactivating stops new bookings using the code at once. Reservations
   * already made keep their discount, and a guest in the middle of paying
   * for one still completes: the discount was fixed when they booked.
   */
  static async setActive(id: string, active: boolean, actorId: string): Promise<PromotionView> {
    const current = await this.find(id);
    if (current.isActive !== active) {
      await Promotion.updateOne({ _id: current._id }, { $set: { isActive: active } });
      await AuditService.record({
        action: active ? 'PROMOTION_ACTIVATED' : 'PROMOTION_DEACTIVATED',
        entityType: 'Promotion',
        entityId: id,
        actorId,
        before: { isActive: current.isActive },
        after: { isActive: active },
      });
    }
    return this.detail(id);
  }

  /**
   * A code no booking ever used may be deleted — a mistake caught in time.
   * Once used, it is part of the booking and billing record and is only ever
   * deactivated.
   */
  static async remove(id: string, actorId: string): Promise<void> {
    const current = await this.find(id);
    if (current.usedCount > 0 || (await Booking.exists({ promotionId: current._id }))) {
      throw new AppError(
        'PROMOTION_IN_USE',
        'Guests have booked with this code, so it stays on record. Deactivate it instead.',
        409,
      );
    }
    await Promotion.deleteOne({ _id: current._id });
    await AuditService.record({
      action: 'PROMOTION_DELETED',
      entityType: 'Promotion',
      entityId: id,
      actorId,
      before: this.auditable(current),
    });
  }

  // -------------------------------------------------------------------------
  // UC-G06 / UC-G11 — the guest side
  // -------------------------------------------------------------------------

  /** UC-G06 — the public codes a guest can use today. Private codes are never listed. */
  static async publicOffers(now: Date = new Date()): Promise<PublicOffer[]> {
    const candidates = await Promotion.find({
      isPublic: true,
      isActive: true,
      validFrom: { $lte: now },
      validTo: { $gte: now },
    }).sort({ validTo: 1 });

    return candidates
      .filter((p) => PromotionRule.statusOf(p, now) === 'ACTIVE')
      .map((p) => ({
        code: p.code,
        description: p.description,
        discountType: p.discountType,
        discountValue: p.discountValue,
        minimumSpend: p.minimumSpend,
        validTo: hotelDateOf(p.validTo),
      }));
  }

  /**
   * UC-G11 — the discount a code would give a reservation of `subtotal`
   * (before tax). A preview only: the booking re-checks and re-prices on the
   * server, so a tampered subtotal changes nothing that is charged.
   */
  static async preview(code: string, subtotal: number) {
    const promotion = await this.resolve(code, subtotal);
    return {
      code: promotion.code,
      description: promotion.description,
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
      minimumSpend: promotion.minimumSpend,
      discount: PricingRule.discountFor(promotion, subtotal),
    };
  }

  /**
   * The one check every path uses (UC-G07 step 8, UC-G11). `subtotal` is the
   * reservation's, before tax; pass `Infinity` to check everything except the
   * minimum spend, when the price is not known yet.
   */
  static async resolve(code: string, subtotal: number, now: Date = new Date()): Promise<IPromotion> {
    const normalized = String(code ?? '').trim().toUpperCase();
    const promotion = normalized ? await Promotion.findOne({ code: normalized }) : null;
    const verdict = PromotionRule.applicability(promotion, subtotal, now);
    if (!verdict.ok) {
      throw new AppError(
        verdict.reason === 'MIN_SPEND' ? 'VOUCHER_MIN_SPEND' : 'INVALID_VOUCHER',
        verdict.message,
        400,
        { reason: verdict.reason },
      );
    }
    return promotion!;
  }

  // -------------------------------------------------------------------------

  private static async find(id: string): Promise<IPromotion> {
    const promotion = Types.ObjectId.isValid(id) ? await Promotion.findById(id) : null;
    if (!promotion) throw new AppError('PROMOTION_NOT_FOUND', 'Promotion code not found', 404);
    return promotion;
  }

  /** Turns the submitted form into typed terms; PromotionRule judges them. */
  private static termsFrom(input: PromotionInput): PromotionTerms {
    const date = (ymd: string | undefined, end: boolean) =>
      ymd && YMD.test(ymd) ? (end ? hotelDayEnd(ymd) : hotelDayStart(ymd)) : new Date(NaN);
    return {
      code: String(input.code ?? '').trim().toUpperCase(),
      description: String(input.description ?? '').trim(),
      discountType: input.discountType as DiscountType,
      discountValue: Number(input.discountValue),
      validFrom: date(input.validFrom, false),
      validTo: date(input.validTo, true),
      usageLimit: Number(input.usageLimit ?? 0),
      minimumSpend: Number(input.minimumSpend ?? 0),
    };
  }

  private static rejectIf(problems: string[]): void {
    if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('. '), 400, problems);
  }

  private static codeTaken(code: string): AppError {
    return new AppError('PROMOTION_CODE_TAKEN', `The code ${code} already exists — choose another`, 409);
  }

  private static async usageOf(ids: Types.ObjectId[]): Promise<Map<string, PromotionUsage & { bookings: number }>> {
    const rows = await Booking.aggregate<{
      _id: Types.ObjectId;
      bookings: number;
      rooms: number;
      reservations: string[];
      discountGiven: number;
      revenue: number;
    }>([
      { $match: { promotionId: { $in: ids } } },
      {
        $group: {
          _id: '$promotionId',
          bookings: { $sum: 1 },
          rooms: { $sum: { $cond: [{ $in: ['$status', STANDING] }, 1, 0] } },
          reservations: {
            $addToSet: { $cond: [{ $in: ['$status', STANDING] }, '$reservationCode', '$$REMOVE'] },
          },
          discountGiven: { $sum: { $cond: [{ $in: ['$status', STANDING] }, '$discount', 0] } },
          revenue: { $sum: { $cond: [{ $in: ['$status', STANDING] }, '$totalAmount', 0] } },
        },
      },
    ]);
    return new Map(
      rows.map((r) => [
        String(r._id),
        {
          bookings: r.bookings,
          rooms: r.rooms,
          reservations: r.reservations.length,
          discountGiven: r.discountGiven,
          revenue: r.revenue,
        },
      ]),
    );
  }

  private static view(
    p: IPromotion,
    usage: (PromotionUsage & { bookings: number }) | undefined,
    now: Date,
  ): PromotionView {
    const hasBookings = (usage?.bookings ?? 0) > 0;
    return {
      id: String(p._id),
      code: p.code,
      description: p.description,
      discountType: p.discountType,
      discountValue: p.discountValue,
      validFrom: hotelDateOf(p.validFrom),
      validTo: hotelDateOf(p.validTo),
      usageLimit: p.usageLimit,
      usedCount: p.usedCount,
      minimumSpend: p.minimumSpend,
      isActive: p.isActive,
      isPublic: p.isPublic,
      status: PromotionRule.statusOf(p, now),
      usage: {
        reservations: usage?.reservations ?? 0,
        rooms: usage?.rooms ?? 0,
        discountGiven: usage?.discountGiven ?? 0,
        revenue: usage?.revenue ?? 0,
      },
      lockedFields: PromotionRule.lockedFields(hasBookings),
      deletable: !hasBookings && p.usedCount === 0,
      createdAt: (p as unknown as { createdAt: Date }).createdAt,
    };
  }

  private static auditable(p: IPromotion) {
    return {
      code: p.code,
      discountType: p.discountType,
      discountValue: p.discountValue,
      validFrom: p.validFrom,
      validTo: p.validTo,
      usageLimit: p.usageLimit,
      minimumSpend: p.minimumSpend,
      isActive: p.isActive,
      isPublic: p.isPublic,
    };
  }
}
