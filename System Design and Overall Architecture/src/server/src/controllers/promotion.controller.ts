/**
 * «boundary» / I/O PromotionController
 *
 * The Manager's promotion-code screen and the two guest-facing reads.
 *
 * Realizes: UC-M11 Manage Promotion Codes (with UC-M19…M22),
 *           UC-G06 View Promotions / Offers, UC-G11 Apply Discount Code.
 */
import { Request, Response } from 'express';
import { PromotionService, PromotionInput } from '../services/promotion.service';
import { AppError } from '../utils/app-error';

/** Only the fields a Manager may set — never `usedCount` or `isActive` through the form. */
function inputFrom(body: Record<string, unknown>): PromotionInput {
  const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));
  return {
    code: body.code as string | undefined,
    description: body.description as string | undefined,
    discountType: body.discountType as string | undefined,
    discountValue: num(body.discountValue),
    validFrom: body.validFrom as string | undefined,
    validTo: body.validTo as string | undefined,
    usageLimit: num(body.usageLimit),
    minimumSpend: num(body.minimumSpend),
    isPublic: body.isPublic === undefined ? undefined : Boolean(body.isPublic),
  };
}

export class PromotionController {
  /** GET /api/promotions — UC-M11, with usage (UC-M19) */
  static async list(_req: Request, res: Response): Promise<void> {
    const promotions = await PromotionService.list();
    res.json({ promotions, count: promotions.length });
  }

  /** POST /api/promotions — UC-M20 */
  static async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await PromotionService.create(inputFrom(req.body), req.auth!.sub));
  }

  /** PATCH /api/promotions/:id — UC-M21 */
  static async update(req: Request, res: Response): Promise<void> {
    res.json(await PromotionService.update(req.params.id, inputFrom(req.body), req.auth!.sub));
  }

  /** PATCH /api/promotions/:id/status — UC-M22 */
  static async setActive(req: Request, res: Response): Promise<void> {
    if (typeof req.body.isActive !== 'boolean') {
      throw new AppError('VALIDATION_ERROR', 'isActive must be true or false', 400);
    }
    res.json(await PromotionService.setActive(req.params.id, req.body.isActive, req.auth!.sub));
  }

  /** DELETE /api/promotions/:id — an unused code only */
  static async remove(req: Request, res: Response): Promise<void> {
    await PromotionService.remove(req.params.id, req.auth!.sub);
    res.status(204).end();
  }

  /** GET /api/promotions/public — UC-G06 */
  static async publicOffers(_req: Request, res: Response): Promise<void> {
    res.json({ offers: await PromotionService.publicOffers() });
  }

  /** GET /api/promotions/validate?code=&subtotal= — UC-G11 preview */
  static async validate(req: Request, res: Response): Promise<void> {
    const subtotal = Number(req.query.subtotal);
    if (!req.query.code || !Number.isFinite(subtotal) || subtotal < 0) {
      throw new AppError('VALIDATION_ERROR', 'code and subtotal are required', 400);
    }
    res.json(await PromotionService.preview(String(req.query.code), subtotal));
  }
}
