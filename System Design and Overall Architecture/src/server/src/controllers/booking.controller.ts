/**
 * «boundary» / I/O BookingController & RoomController
 *
 * Translates HTTP into service calls and back. Per §7.4.4 a controller depends
 * only on services — never on a model or a rule — so every query and decision
 * below is delegated.
 *
 * Realizes: UC-G01 Search Available Rooms, UC-G02 View Room Details,
 *           UC-G07 Book Room, UC-G13 Check Booking Status, UC-G14 Cancel,
 *           UC-C11 View Booking History, UC-C12 View Booking Details.
 */
import { Request, Response } from 'express';
import { BookingCoordinator } from '../services/booking.service';
import { BookingQueries, RoomQueries } from '../services/query.service';
import { PaymentMethod } from '../models/enums';
import { AppError } from '../utils/app-error';

export class RoomController {
  /** GET /api/rooms/search — UC-G01 (public, highest-traffic read path) */
  static async search(req: Request, res: Response): Promise<void> {
    const checkIn = new Date(String(req.query.checkIn));
    const checkOut = new Date(String(req.query.checkOut));
    const adults = Number(req.query.adults ?? 1);
    const children = Number(req.query.children ?? 0);

    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
      throw new AppError('INVALID_DATE', 'checkIn and checkOut must be valid dates', 400);
    }

    const results = await RoomQueries.searchPriced(checkIn, checkOut, adults + children);

    // UC-G01 exception 1.0.E4 — an empty result is a normal outcome, not a 404.
    res.json({ checkIn, checkOut, results, count: results.length });
  }

  /** GET /api/room-types — the public room catalogue */
  static async list(_req: Request, res: Response): Promise<void> {
    res.json({ roomTypes: await RoomQueries.listRoomTypes() });
  }

  /** GET /api/room-types/:id — UC-G02 */
  static async detail(req: Request, res: Response): Promise<void> {
    res.json(await RoomQueries.roomTypeDetail(req.params.id));
  }
}

export class BookingController {
  /**
   * POST /api/bookings — UC-G07 (Guest or signed-in Customer).
   * Body: `rooms: [{ roomTypeId, adults, children }]` for one or more rooms,
   * or the older single-room fields `roomTypeId`, `adults`, `children`.
   */
  static async create(req: Request, res: Response): Promise<void> {
    const result = await BookingCoordinator.bookRoom({
      rooms: Array.isArray(req.body.rooms) ? req.body.rooms : undefined,
      roomTypeId: req.body.roomTypeId,
      adults: req.body.adults !== undefined ? Number(req.body.adults) : undefined,
      children: Number(req.body.children ?? 0),
      roomCount: req.body.roomCount !== undefined ? Number(req.body.roomCount) : undefined,
      addOnServiceIds: req.body.addOnServices,
      checkInDate: new Date(req.body.checkInDate),
      checkOutDate: new Date(req.body.checkOutDate),
      guest: req.body.guest,
      voucherCode: req.body.voucherCode,
      paymentMethod: req.body.paymentMethod as PaymentMethod,
      // Set only when authenticated — UC-G07 alternative flow 1.2.
      customerId: req.auth?.sub,
    });

    // 202 while payOS has not confirmed: the rooms exist but are PENDING, and
    // the client should say "confirming payment", not "confirmed".
    res.status(result.paymentPending ? 202 : 201).json({
      reservationCode: result.reservationCode,
      bookingCode: result.booking.bookingCode,
      status: result.booking.status,
      total: result.total,
      checkIn: result.booking.checkInDate,
      checkOut: result.booking.checkOutDate,
      rooms: result.bookings.map((b) => ({
        bookingCode: b.bookingCode,
        roomTypeId: b.roomTypeId,
        adults: b.adults,
        children: b.children,
        total: b.totalAmount,
      })),
      paymentUrl: result.paymentUrl,
      paymentPending: Boolean(result.paymentPending),
    });
  }

  /** GET /api/bookings/lookup?code=&email= — UC-G13 (no account required) */
  static async lookup(req: Request, res: Response): Promise<void> {
    res.json(await BookingQueries.lookup(String(req.query.code), String(req.query.email)));
  }

  /** GET /api/me/bookings — UC-C11 */
  static async myBookings(req: Request, res: Response): Promise<void> {
    const bookings = await BookingQueries.forCustomer(req.auth!.sub);
    res.json({ bookings, count: bookings.length });
  }

  /** GET /api/bookings/:id — UC-C12 / UC-R02, with the rest of its reservation */
  static async detail(req: Request, res: Response): Promise<void> {
    const booking = await BookingQueries.byIdFor(req.params.id, req.auth?.sub, req.auth?.permissions ?? []);
    res.json({ ...booking.toJSON(), reservation: await BookingQueries.reservationOf(booking) });
  }

  /** POST /api/bookings/:id/cancel — UC-G14 */
  static async cancel(req: Request, res: Response): Promise<void> {
    const result = await BookingCoordinator.cancelBooking(
      req.params.id,
      { id: req.auth!.sub, permissions: req.auth!.permissions ?? [] },
      req.body.reason,
    );

    res.json({
      bookingCode: result.booking.bookingCode,
      status: result.booking.status,
      refundable: result.refundable,
      // Tells the client whether to show "refund on the way" or "awaiting review".
      requiresApproval: result.requiresApproval,
      // NONE | ISSUED | MANUAL_TRANSFER | AWAITING_APPROVAL
      refundStatus: result.refundStatus,
    });
  }
}
