/**
 * «application logic» / «business logic» PricingRule
 *
 * Ch. 8: business logic objects encapsulate business rules that may change
 * independently of the entity data they operate on. PricingRule is therefore a
 * pure function of its inputs — no database, no HTTP — which also makes it
 * directly unit-testable (§8.1 Testability).
 *
 * Enforces: BR-09 price = Σ nightly seasonal rate − discount + tax.
 * Realizes: UC-G01 step 7, UC-G07 step 7, UC-R09 step 4.
 */
import { IRoomType, IPromotion } from '../models/booking.model';
import { DiscountType } from '../models/enums';

/** Standard VAT rate applied to hotel revenue. Configurable via UC-A09. */
export const TAX_RATE = 0.1;

export interface PriceLine {
  date: Date;
  rate: number;
}

export interface PriceBreakdown {
  nightlyLines: PriceLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export interface AddOnSelection {
  serviceId: string;
  quantity: number;
  unitPrice: number;
}

export class PricingRule {
  /**
   * Resolves the rate for one night: a seasonal override wins over the base price.
   */
  static nightlyRate(roomType: IRoomType, date: Date): number {
    const seasonal = roomType.seasonalRates?.find(
      (r) => date >= new Date(r.from) && date <= new Date(r.to),
    );
    return seasonal ? seasonal.price : roomType.basePrice;
  }

  /**
   * Computes the full breakdown for a stay.
   * All amounts are integer minor units; rounding happens once, at the end of
   * each derived figure, so no fractional currency can accumulate.
   */
  static calculate(
    roomType: IRoomType,
    checkInDate: Date,
    checkOutDate: Date,
    roomCount = 1,
    addOns: AddOnSelection[] = [],
    promotion?: IPromotion | null,
  ): PriceBreakdown {
    const nightlyLines: PriceLine[] = [];

    for (
      let d = new Date(checkInDate);
      d < checkOutDate;
      d.setDate(d.getDate() + 1)
    ) {
      const date = new Date(d);
      nightlyLines.push({ date, rate: this.nightlyRate(roomType, date) * roomCount });
    }

    const roomTotal = nightlyLines.reduce((sum, l) => sum + l.rate, 0);
    const addOnTotal = addOns.reduce((sum, a) => sum + a.unitPrice * a.quantity, 0);
    const subtotal = roomTotal + addOnTotal;

    const discount = promotion ? this.discountFor(promotion, subtotal) : 0;
    const taxable = subtotal - discount;
    const tax = Math.round(taxable * TAX_RATE);

    return { nightlyLines, subtotal, discount, tax, total: taxable + tax };
  }

  /**
   * UC-G11 Apply Discount Code. The caller must already have checked the
   * promotion applies (PromotionRule.applicability) — this only computes.
   */
  static discountFor(promotion: IPromotion, subtotal: number): number {
    if (subtotal < promotion.minimumSpend) return 0;

    const raw =
      promotion.discountType === DiscountType.PERCENTAGE
        ? Math.round((subtotal * promotion.discountValue) / 100)
        : promotion.discountValue;

    // A discount may never exceed the amount being discounted.
    return Math.min(raw, subtotal);
  }
}
