/**
 * «application logic» / «algorithm» AvailabilityCalculator
 *
 * Ch. 8: an algorithm object encapsulates a computation that may change
 * independently of the data. Availability is the hottest read path in the
 * system (§8.1 Performance, QA-1) and the source of the booking race condition
 * (QA-7), so it is isolated here.
 *
 * Enforces: availableCount = totalRooms − confirmedOverlapping − blocked − holds.
 * Realizes: UC-G01 step 5, UC-G07 steps 2 and 11.
 */
import { Types } from 'mongoose';
import { Booking, InventoryHold, Room, RoomType } from '../models/booking.model';
import { BookingStatus, RoomStatus } from '../models/enums';

/** BR-10: an inventory hold lives for 15 minutes. */
export const HOLD_DURATION_MS = 15 * 60 * 1000;

export interface AvailabilityResult {
  roomTypeId: string;
  totalRooms: number;
  bookedCount: number;
  blockedCount: number;
  heldCount: number;
  availableCount: number;
}

export class AvailabilityCalculator {
  /**
   * Counts bookings that overlap the requested window. Two date ranges overlap
   * when each starts before the other ends — a same-day turnover (one guest
   * leaving on the day another arrives) is therefore NOT an overlap.
   */
  private static overlapFilter(checkIn: Date, checkOut: Date) {
    return { checkInDate: { $lt: checkOut }, checkOutDate: { $gt: checkIn } };
  }

  static async forRoomType(
    roomTypeId: string | Types.ObjectId,
    checkIn: Date,
    checkOut: Date,
  ): Promise<AvailabilityResult> {
    const roomType = await RoomType.findById(roomTypeId);
    if (!roomType) throw new Error('Room type not found');

    const overlap = this.overlapFilter(checkIn, checkOut);

    const [bookedCount, blockedCount, heldAgg] = await Promise.all([
      Booking.countDocuments({
        roomTypeId,
        // Only live bookings consume inventory; cancelled and no-show do not.
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
        ...overlap,
      }),
      Room.countDocuments({ roomTypeId, status: RoomStatus.OUT_OF_ORDER }),
      InventoryHold.aggregate([
        {
          $match: {
            roomTypeId: new Types.ObjectId(String(roomTypeId)),
            expiresAt: { $gt: new Date() },
            ...overlap,
          },
        },
        { $group: { _id: null, total: { $sum: '$quantity' } } },
      ]),
    ]);

    const heldCount = heldAgg[0]?.total ?? 0;
    const availableCount = Math.max(
      0,
      roomType.totalRooms - bookedCount - blockedCount - heldCount,
    );

    return {
      roomTypeId: String(roomTypeId),
      totalRooms: roomType.totalRooms,
      bookedCount,
      blockedCount,
      heldCount,
      availableCount,
    };
  }

  /**
   * UC-G01 step 6 — returns only the room types that can actually be booked for
   * the requested occupancy.
   */
  static async search(
    checkIn: Date,
    checkOut: Date,
    occupancy: number,
    roomCount = 1,
  ): Promise<AvailabilityResult[]> {
    const candidates = await RoomType.find({
      isActive: true,
      capacity: { $gte: occupancy },
    });

    const results = await Promise.all(
      candidates.map((rt) => this.forRoomType(rt._id, checkIn, checkOut)),
    );

    return results.filter((r) => r.availableCount >= roomCount);
  }

  /**
   * Places a short-lived hold so that a guest completing the payment step cannot
   * lose the room to a concurrent booking (UC-G07 step 2).
   *
   * @returns the hold id, or null when there is no longer room to hold.
   */
  static async hold(
    roomTypeId: string,
    checkIn: Date,
    checkOut: Date,
    quantity = 1,
  ): Promise<string | null> {
    const availability = await this.forRoomType(roomTypeId, checkIn, checkOut);
    if (availability.availableCount < quantity) return null;

    const hold = await InventoryHold.create({
      roomTypeId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      quantity,
      expiresAt: new Date(Date.now() + HOLD_DURATION_MS),
    });

    return String(hold._id);
  }

  /** Called after the booking is persisted (UC-G07 step 11). */
  static async releaseHold(holdId: string): Promise<void> {
    await InventoryHold.findByIdAndDelete(holdId);
  }
}
