/**
 * Hotel-local dates.
 *
 * Stay dates are stored as the UTC midnight of the calendar date the guest
 * chose ("2026-09-29" → 2026-09-29T00:00:00Z), exactly as the booking form
 * sends them. "Today" must therefore be the hotel's calendar date, not UTC's:
 * at 02:00 in Hanoi it is still the previous day in UTC, and an arrivals list
 * computed in UTC would show yesterday's guests.
 */
export const HOTEL_TIME_ZONE = process.env.HOTEL_TIME_ZONE ?? 'Asia/Ho_Chi_Minh';

const DAY_MS = 86_400_000;

/** The hotel's calendar date today, as a stay date (UTC midnight). */
export function hotelToday(now: Date = new Date()): Date {
  // en-CA formats as YYYY-MM-DD.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOTEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

/** A stay date `n` days after `date`. */
export function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}
