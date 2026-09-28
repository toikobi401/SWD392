/**
 * «application logic» / «algorithm» RoomAllocator
 *
 * Solves the concurrency problem of UC-R06 exception 1.0.E6: two receptionists
 * checking in at the same moment must never be given the same room.
 *
 * The allocation is a single atomic findOneAndUpdate guarded by the room's
 * `version` field — an optimistic lock. The loser of the race gets null and
 * retries with a refreshed list rather than corrupting the allocation.
 *
 * Enforces: BR-25 a room may be allocated to exactly one active stay.
 * Realizes: UC-R06 steps 6–8, UC-R14 Change / Transfer Room.
 */
import { Types } from 'mongoose';
import { Room, IRoom } from '../models/booking.model';
import { RoomStatus } from '../models/enums';

export interface AllocationPreference {
  floor?: number;
  /** Room numbers the guest asked to avoid, or that are otherwise unsuitable. */
  exclude?: string[];
}

export class RoomAllocator {
  /** UC-R06 step 6 — the rooms a receptionist may choose from. */
  static async listAllocatable(
    roomTypeId: string | Types.ObjectId,
    preference: AllocationPreference = {},
  ): Promise<IRoom[]> {
    const query: Record<string, unknown> = {
      roomTypeId,
      status: RoomStatus.VACANT_CLEAN,
    };
    if (preference.floor !== undefined) query.floor = preference.floor;
    if (preference.exclude?.length) query.roomNumber = { $nin: preference.exclude };

    return Room.find(query).sort({ floor: 1, roomNumber: 1 });
  }

  /**
   * UC-R06 steps 7–8 — claims one specific room.
   *
   * The update matches on both the id AND the status/version the caller last
   * saw. If another receptionist has claimed the room in the meantime, neither
   * the status nor the version still matches and the update affects no
   * document, so this returns null.
   *
   * @returns the claimed room, or null when it was taken concurrently.
   */
  static async allocate(
    roomId: string | Types.ObjectId,
    expectedVersion: number,
  ): Promise<IRoom | null> {
    return Room.findOneAndUpdate(
      {
        _id: roomId,
        status: RoomStatus.VACANT_CLEAN,
        version: expectedVersion,
      },
      {
        $set: { status: RoomStatus.OCCUPIED },
        $inc: { version: 1 },
      },
      { new: true },
    );
  }

  /**
   * Picks and claims the first allocatable room automatically, retrying on a
   * lost race. Used by group check-in (UC-R06 alternative flow 1.4) and by
   * express flows where the receptionist expresses no preference.
   */
  static async allocateFirstAvailable(
    roomTypeId: string | Types.ObjectId,
    preference: AllocationPreference = {},
    maxAttempts = 5,
  ): Promise<IRoom | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidates = await this.listAllocatable(roomTypeId, preference);
      if (candidates.length === 0) return null; // UC-R06 exception 1.0.E4

      for (const candidate of candidates) {
        const claimed = await this.allocate(candidate._id, candidate.version);
        if (claimed) return claimed;
        // Lost the race for this room — try the next candidate.
      }
    }
    return null;
  }

  /** UC-R09 step 11 — release the room to housekeeping at check-out. */
  static async release(roomId: string | Types.ObjectId): Promise<IRoom | null> {
    return Room.findByIdAndUpdate(
      roomId,
      { $set: { status: RoomStatus.VACANT_DIRTY }, $inc: { version: 1 } },
      { new: true },
    );
  }
}
