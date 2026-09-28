/**
 * «boundary» / I/O FrontDeskController
 *
 * Per §7.4.4 this controller depends only on services; every query, state
 * transition and money movement is delegated.
 *
 * Realizes: UC-R01 Search Booking, UC-R06 Check In Guest, UC-R09 Check Out,
 *           UC-R12 View Room Availability, UC-R13 Update Room Status,
 *           UC-R15 Process Payment, UC-R19 Register Add-on Service.
 */
import { Request, Response } from 'express';
import {
  CheckInCoordinator,
  CheckOutCoordinator,
  FolioLedger,
  RoomStatusService,
} from '../services/check-in.service';
import { PaymentService } from '../services/payment.service';
import {
  BookingQueries,
  FolioQueries,
  FrontDeskQueries,
  RoomQueries,
} from '../services/query.service';
// Type-only: erased at compile time, so no runtime dependency on `rules`.
import type { RoomEvent } from '../rules/booking-state-machine';
import { ChargeType, PaymentMethod } from '../models/enums';

export class FrontDeskController {
  /** GET /api/front-desk/bookings?q= — UC-R01 */
  static async searchBooking(req: Request, res: Response): Promise<void> {
    const bookings = await BookingQueries.deskSearch(String(req.query.q ?? ''));
    res.json({ bookings, count: bookings.length });
  }

  /** GET /api/front-desk/overview — arrivals, in-house, departures, room counts */
  static async overview(_req: Request, res: Response): Promise<void> {
    res.json(await FrontDeskQueries.overview());
  }

  /** GET /api/front-desk/bookings/:id/folio — the folio id of a stay */
  static async folioForBooking(req: Request, res: Response): Promise<void> {
    res.json(await FolioQueries.byBooking(req.params.id));
  }

  /** GET /api/front-desk/allocatable?roomTypeId=&floor= — UC-R06 step 6 */
  static async allocatableRooms(req: Request, res: Response): Promise<void> {
    const rooms = await RoomStatusService.allocatable(
      String(req.query.roomTypeId),
      req.query.floor ? Number(req.query.floor) : undefined,
    );

    // `version` must round-trip to the client: it is the optimistic-lock guard
    // the check-in call sends back (UC-R06 exception 1.0.E6).
    res.json({
      rooms: rooms.map((r) => ({
        id: r._id,
        roomNumber: r.roomNumber,
        floor: r.floor,
        status: r.status,
        version: r.version,
      })),
    });
  }

  /** POST /api/front-desk/check-in — UC-R06 */
  static async checkIn(req: Request, res: Response): Promise<void> {
    const identity = req.body.identity ?? {};
    const result = await CheckInCoordinator.checkIn({
      bookingId: req.body.bookingId,
      identity: {
        documentType: identity.documentType,
        documentNumber: identity.documentNumber,
        fullName: identity.fullName,
        dateOfBirth: new Date(identity.dateOfBirth),
        expiryDate: new Date(identity.expiryDate),
        nationality: identity.nationality,
      },
      roomId: req.body.roomId,
      roomVersion: Number(req.body.roomVersion),
      receptionistId: req.auth!.sub,
      depositAmount: req.body.depositAmount ? Number(req.body.depositAmount) : undefined,
    });

    res.json({
      bookingCode: result.booking.bookingCode,
      status: result.booking.status,
      roomNumber: result.roomNumber,
      folioId: result.folioId,
      checkedInAt: result.booking.actualCheckInAt,
    });
  }

  /** POST /api/front-desk/check-out — UC-R09 */
  static async checkOut(req: Request, res: Response): Promise<void> {
    const result = await CheckOutCoordinator.checkOut({
      bookingId: req.body.bookingId,
      receptionistId: req.auth!.sub,
      lateCheckoutSurcharge: req.body.lateCheckoutSurcharge
        ? Number(req.body.lateCheckoutSurcharge)
        : undefined,
      waiveSurcharge: Boolean(req.body.waiveSurcharge),
    });

    res.json({
      bookingCode: result.booking.bookingCode,
      status: result.booking.status,
      invoiceNumber: result.invoice.invoiceNumber,
      total: result.invoice.total,
      checkedOutAt: result.booking.actualCheckOutAt,
    });
  }

  /** GET /api/rooms/availability — UC-R12 the room rack */
  static async roomRack(_req: Request, res: Response): Promise<void> {
    const { rooms, summary } = await RoomQueries.rack();
    res.json({ rooms, summary, total: rooms.length });
  }

  /** PATCH /api/rooms/:id/status — UC-R13 */
  static async updateRoomStatus(req: Request, res: Response): Promise<void> {
    const room = await RoomStatusService.apply(
      req.params.id,
      req.body.event as RoomEvent,
      req.body.notes,
    );
    res.json({ id: room._id, roomNumber: room.roomNumber, status: room.status });
  }

  /** GET /api/folios/:id — the guest folio behind the desk screen */
  static async folio(req: Request, res: Response): Promise<void> {
    res.json(await FolioQueries.withCharges(req.params.id));
  }

  /** POST /api/folios/:id/charges — UC-R19 Register Add-on Service */
  static async postCharge(req: Request, res: Response): Promise<void> {
    const result = await FolioLedger.postToOpenFolio(
      req.params.id,
      {
        type: (req.body.type as ChargeType) ?? ChargeType.SERVICE,
        description: req.body.description,
        amount: Number(req.body.amount),
        quantity: Number(req.body.quantity ?? 1),
      },
      req.auth!.sub,
    );
    res.status(201).json(result);
  }

  /** POST /api/folios/:id/payments — UC-R15 Process Payment */
  static async takePayment(req: Request, res: Response): Promise<void> {
    const { payment, balance } = await PaymentService.takeDeskPayment({
      folioId: req.params.id,
      amount: Number(req.body.amount),
      method: req.body.method as PaymentMethod,
      cashierId: req.auth!.sub,
      idempotencyKey: req.body.idempotencyKey,
    });

    // A payOS payment comes back PENDING with a VietQR for the guest to scan;
    // the balance falls when the webhook confirms it.
    res.status(201).json({
      paymentId: payment._id,
      status: payment.status,
      amount: payment.amount,
      balance,
      orderCode: payment.gatewayOrderCode,
      qrCode: payment.qrCode,
      checkoutUrl: payment.checkoutUrl,
    });
  }
}
