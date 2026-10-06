/**
 * Schema migrations for existing databases. Idempotent — safe on every start.
 *
 * Multi-room reservations changed two things an existing database still has
 * in its old form:
 *   1. Payment.gatewayOrderCode had a UNIQUE index; now every room of a
 *      reservation shares one payOS order code. Mongoose never drops an index
 *      on its own, so the old one would make the second room's payment fail
 *      with a duplicate-key error. syncIndexes() drops it and builds the new.
 *   2. Bookings made before have no reservationCode; each becomes a
 *      reservation of one room, whose code is its own booking code.
 */
import { Booking } from '../models/booking.model';
import { Payment } from '../models/billing.model';

export async function migrate(): Promise<void> {
  const dropped = await Payment.syncIndexes();
  await Booking.syncIndexes();
  if (dropped.length) console.log(`[migrate] dropped outdated payment index(es): ${dropped.join(', ')}`);

  const backfilled = await Booking.updateMany(
    { reservationCode: { $exists: false } },
    // Aggregation-pipeline update: copy each document's own bookingCode.
    [{ $set: { reservationCode: '$bookingCode' } }],
  );
  if (backfilled.modifiedCount) {
    console.log(`[migrate] ${backfilled.modifiedCount} existing booking(s) became single-room reservations`);
  }
}
