/**
 * «application logic» / «service» Read-side query services
 *
 * §7.4.4 forbids a controller from touching a model: every read a screen needs
 * is answered here instead. These are deliberately thin — read-only use cases
 * need no «control» object (Ch. 8) — but keeping them out of the controllers
 * means a query change never edits the HTTP boundary, and the same query can be
 * reused by another boundary (a CLI, a report job) without duplicating it.
 *
 * Realizes the read halves of: UC-G01, UC-G02, UC-G13, UC-C11, UC-C12,
 * UC-R01, UC-R02, UC-R06 step 6, UC-R12, UC-A01, UC-A05.
 */
import {
  Booking,
  IBooking,
  RoomType,
  IRoomType,
  Room,
  IRoom,
  LoyaltyAccount,
} from '../models/booking.model';
import { Folio, IFolio, Charge, ICharge, Payment, IPayment } from '../models/billing.model';
import { User, IUser, Role, IRole, Employee } from '../models/user.model';
import { LeaveRequest, ILeaveRequest } from '../models/hr.model';
import { AvailabilityCalculator } from '../rules/availability.calculator';
import { PricingRule } from '../rules/pricing.rule';
import { BookingStatus, Permission } from '../models/enums';
import { AppError } from '../utils/app-error';
import { hotelToday, addDays } from '../utils/hotel-time';

export interface PricedAvailability {
  roomType: Pick<IRoomType, 'name' | 'description' | 'capacity' | 'amenities' | 'images'> & {
    id: string;
  };
  availableCount: number;
  nights: number;
  subtotal: number;
  tax: number;
  total: number;
}

export class RoomQueries {
  /**
   * UC-G01 steps 5–9 — composes the two «application logic» objects: which
   * room types are free (AvailabilityCalculator) and what they cost
   * (PricingRule). Cheapest first.
   */
  static async searchPriced(
    checkIn: Date,
    checkOut: Date,
    occupancy: number,
    roomCount: number,
  ): Promise<PricedAvailability[]> {
    const available = await AvailabilityCalculator.search(
      checkIn,
      checkOut,
      occupancy,
      roomCount,
    );
    const roomTypes = await RoomType.find({
      _id: { $in: available.map((a) => a.roomTypeId) },
    });

    const results = available.map((a) => {
      const rt = roomTypes.find((t) => String(t._id) === a.roomTypeId)!;
      const price = PricingRule.calculate(rt, checkIn, checkOut, roomCount);
      return {
        roomType: {
          id: String(rt._id),
          name: rt.name,
          description: rt.description,
          capacity: rt.capacity,
          amenities: rt.amenities,
          images: rt.images,
        },
        availableCount: a.availableCount,
        nights: price.nightlyLines.length,
        subtotal: price.subtotal,
        tax: price.tax,
        total: price.total,
      };
    });

    return results.sort((x, y) => x.total - y.total);
  }

  /** The public room catalogue, cheapest first. */
  static async listRoomTypes(): Promise<IRoomType[]> {
    return RoomType.find({ isActive: true }).sort({ basePrice: 1 });
  }

  /** UC-G02 */
  static async roomTypeDetail(id: string): Promise<IRoomType> {
    const roomType = await RoomType.findById(id);
    if (!roomType || !roomType.isActive) {
      throw new AppError('NOT_FOUND', 'Room type not found', 404);
    }
    return roomType;
  }

  /** UC-R12 — the room rack with a count per status. */
  static async rack(): Promise<{ rooms: IRoom[]; summary: Record<string, number> }> {
    const rooms = await Room.find().populate('roomTypeId').sort({ floor: 1, roomNumber: 1 });
    const summary = rooms.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    return { rooms, summary };
  }
}

export class BookingQueries {
  /**
   * UC-G13 — anonymous lookup. The email acts as the shared secret: a booking
   * code alone must not disclose a guest's reservation.
   */
  static async lookup(code: string, email: string): Promise<IBooking> {
    const booking = await Booking.findOne({
      bookingCode: code,
      'guest.email': email.toLowerCase(),
    }).populate('roomTypeId');

    if (!booking) {
      throw new AppError('NOT_FOUND', 'No booking matches that code and email', 404);
    }
    return booking;
  }

  /** UC-C11 */
  static async forCustomer(customerId: string): Promise<IBooking[]> {
    return Booking.find({ customerId }).sort({ checkInDate: -1 }).populate('roomTypeId');
  }

  /**
   * UC-C12 / UC-R02 — a Customer may read only their own booking; a caller
   * holding BOOKING_READ (staff) may read any.
   */
  static async byIdFor(
    bookingId: string,
    callerId: string | undefined,
    callerPermissions: Permission[],
  ): Promise<IBooking> {
    const booking = await Booking.findById(bookingId)
      .populate('roomTypeId')
      .populate('roomId');
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found', 404);

    const isOwner = String(booking.customerId) === callerId;
    const isStaff = callerPermissions.includes(Permission.BOOKING_READ);
    if (!isOwner && !isStaff) {
      throw new AppError('FORBIDDEN', 'You may only view your own bookings', 403);
    }
    return booking;
  }

  /** UC-R01 — the desk search by code prefix, name, phone or email. */
  static async deskSearch(q: string): Promise<IBooking[]> {
    const term = q.trim();
    if (!term) throw new AppError('MISSING_QUERY', 'A search term is required', 400);

    // Escape user input before it becomes a regular expression — otherwise a
    // search for "(" throws, and a crafted pattern can stall the database.
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return Booking.find({
      $or: [
        { bookingCode: new RegExp(`^${safe}`, 'i') },
        { 'guest.fullName': new RegExp(safe, 'i') },
        { 'guest.phone': new RegExp(safe) },
        { 'guest.email': new RegExp(safe, 'i') },
      ],
    })
      .limit(25)
      .populate('roomTypeId')
      .populate('roomId');
  }
}

export class FolioQueries {
  static async withCharges(folioId: string): Promise<{
    folio: IFolio;
    charges: ICharge[];
    payments: IPayment[];
    booking: IBooking | null;
  }> {
    const folio = await Folio.findById(folioId);
    if (!folio) throw new AppError('NOT_FOUND', 'Folio not found', 404);
    const [charges, payments, booking] = await Promise.all([
      Charge.find({ folioId: folio._id }).sort({ postedAt: 1 }),
      Payment.find({ folioId: folio._id }).sort({ createdAt: 1 }),
      Booking.findById(folio.bookingId).populate('roomTypeId').populate('roomId'),
    ]);
    return { folio, charges, payments, booking };
  }

  /** The folio of a stay — opened at check-in, so null before it. */
  static async byBooking(bookingId: string): Promise<{ folioId: string | null }> {
    const folio = await Folio.findOne({ bookingId }).select('_id');
    return { folioId: folio ? String(folio._id) : null };
  }
}

/**
 * The front desk's day at a glance — arrivals, in-house guests, departures —
 * in hotel-local time (see utils/hotel-time).
 */
export class FrontDeskQueries {
  static async overview(): Promise<{
    date: Date;
    arrivals: IBooking[];
    inHouse: IBooking[];
    departures: IBooking[];
    rooms: Record<string, number>;
  }> {
    const today = hotelToday();
    const tomorrow = addDays(today, 1);

    const [arrivals, inHouse, roomCounts] = await Promise.all([
      Booking.find({
        status: BookingStatus.CONFIRMED,
        checkInDate: { $gte: today, $lt: tomorrow },
      })
        .populate('roomTypeId')
        .sort({ 'guest.fullName': 1 }),
      Booking.find({ status: BookingStatus.CHECKED_IN })
        .populate('roomTypeId')
        .populate('roomId')
        .sort({ checkOutDate: 1 }),
      Room.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    // Due out today, or overdue — still in house past their departure date.
    const departures = inHouse.filter((b) => b.checkOutDate < tomorrow);

    return {
      date: today,
      arrivals,
      inHouse,
      departures,
      rooms: Object.fromEntries(roomCounts.map((r) => [r._id, r.count])),
    };
  }
}

export class ProfileQueries {
  /**
   * GET /auth/me — the signed-in person's own record. Permissions are
   * recomputed from the roles in the database (BR-46), so a role change shows
   * up here even before the token is refreshed.
   */
  static async me(userId: string) {
    const user = await User.findById(userId).populate<{ roles: IRole[] }>('roles');
    if (!user) throw new AppError('NOT_FOUND', 'Account not found', 404);

    const roles = (user.roles as unknown as IRole[]) ?? [];
    const raw = user.toObject() as unknown as Record<string, unknown>;
    const userType = (raw.userType as string | undefined) ?? 'User';

    const profile: Record<string, unknown> = {
      id: String(user._id),
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      userType,
      roles: roles.map((r) => r.name),
      permissions: [...new Set(roles.flatMap((r) => r.permissions ?? []))],
      isStaff: userType === 'Employee',
    };

    if (userType === 'Customer') {
      const loyalty = await LoyaltyAccount.findOne({ customerId: user._id });
      profile.loyalty = loyalty
        ? { points: loyalty.pointBalance, tier: loyalty.tier }
        : { points: 0, tier: 'BRONZE' };
    }

    if (userType === 'Employee') {
      profile.employee = {
        employeeCode: raw.employeeCode,
        department: raw.department,
        position: raw.position,
        leaveBalance: raw.leaveBalance,
      };
    }

    return profile;
  }
}

export class LeaveQueries {
  /** UC-E15/E16/E17 — an employee's own requests and remaining balance. */
  static async forEmployee(employeeId: string): Promise<{
    requests: ILeaveRequest[];
    balance: { annual: number; sick: number } | null;
  }> {
    const [requests, employee] = await Promise.all([
      LeaveRequest.find({ employeeId }).sort({ fromDate: -1 }),
      Employee.findById(employeeId),
    ]);
    return { requests, balance: employee ? employee.leaveBalance : null };
  }
}

export class AccountQueries {
  /** UC-A01 — paged account list with optional status and text filters. */
  static async list(filter: {
    status?: string;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ users: IUser[]; total: number }> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    if (filter.q) {
      const safe = filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [{ fullName: new RegExp(safe, 'i') }, { email: new RegExp(safe, 'i') }];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .populate('roles')
        .skip((filter.page - 1) * filter.pageSize)
        .limit(filter.pageSize)
        .sort({ createdAt: -1 }),
      User.countDocuments(query),
    ]);
    return { users, total };
  }

  /** UC-A05 — the assignable role catalogue. */
  static async roles(): Promise<IRole[]> {
    return Role.find().sort({ name: 1 });
  }
}
