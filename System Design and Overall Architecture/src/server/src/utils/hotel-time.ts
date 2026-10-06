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

/** The hotel's calendar date of an instant, as `YYYY-MM-DD`. */
export function hotelDateOf(instant: Date): string {
  return hotelToday(instant).toISOString().slice(0, 10);
}

/**
 * The instant a hotel calendar day begins. A promotion "valid until 31 Dec"
 * must end at midnight in Hanoi (17:00 UTC), not at midnight UTC seven hours
 * later — so validity windows are hotel days, not UTC days.
 */
export function hotelDayStart(ymd: string): Date {
  const utcMidnight = new Date(`${ymd}T00:00:00Z`);
  // sv-SE formats as "YYYY-MM-DD HH:mm:ss": the hotel's wall clock at UTC midnight.
  const wall = new Intl.DateTimeFormat('sv-SE', {
    timeZone: HOTEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(utcMidnight);
  const offset = new Date(`${wall.replace(' ', 'T')}Z`).getTime() - utcMidnight.getTime();
  return new Date(utcMidnight.getTime() - offset);
}

/** The last millisecond of a hotel calendar day. */
export function hotelDayEnd(ymd: string): Date {
  return new Date(hotelDayStart(ymd).getTime() + DAY_MS - 1);
}
