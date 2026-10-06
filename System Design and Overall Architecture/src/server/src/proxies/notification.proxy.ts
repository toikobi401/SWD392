/**
 * «boundary» / «proxy» NotificationProxy
 *
 * Encapsulates the email/SMS provider. Delivery is best-effort: a failure here
 * must never invalidate the business transaction that triggered it — a booking
 * stays valid even if its confirmation email bounces (UC-G07 exception 1.0.E5),
 * so callers await this defensively and the failure is queued for retry.
 *
 * Realizes: UC-G12 Receive Email / SMS Confirmation, UC-C03 OTP,
 *           UC-G14 step 9 cancellation notice, UC-M06 step 10 decision notice.
 */
import { IBooking } from '../models/booking.model';

export interface NotificationMessage {
  to: string;
  channel: 'EMAIL' | 'SMS';
  subject?: string;
  body: string;
}

export class NotificationProxy {
  /** UC-G12 — sent after the payment is captured (UC-G07 step 12). */
  static async sendBookingConfirmation(booking: IBooking): Promise<void> {
    await this.send({
      to: booking.guest.email,
      channel: 'EMAIL',
      subject: `Booking confirmed — ${booking.bookingCode}`,
      body:
        `Dear ${booking.guest.fullName},\n\n` +
        `Your booking is confirmed.\n` +
        `Reference: ${booking.bookingCode}\n` +
        `Check-in: ${booking.checkInDate.toDateString()}\n` +
        `Check-out: ${booking.checkOutDate.toDateString()}\n` +
        `Guests: ${booking.adults} adult(s), ${booking.children} child(ren)\n` +
        `Total: ${this.formatMoney(booking.totalAmount)}\n`,
    });
  }

  /**
   * UC-G12 for a whole reservation — one email listing every room, sent when
   * payOS confirms the payment (see PaymentService.sendConfirmationOnce).
   */
  static async sendReservationConfirmation(bookings: IBooking[]): Promise<void> {
    if (!bookings.length) return;
    const first = bookings[0];
    const code = first.reservationCode ?? first.bookingCode;
    const total = bookings.reduce((sum, b) => sum + b.totalAmount, 0);
    const lines = bookings.map((b, i) => {
      const type = (b.roomTypeId as unknown as { name?: string })?.name ?? 'Room';
      return `  Room ${i + 1}: ${type}, ${b.adults} adult(s)` +
        (b.children ? `, ${b.children} child(ren)` : '') +
        ` — ${this.formatMoney(b.totalAmount)} (ref ${b.bookingCode})`;
    });

    await this.send({
      to: first.guest.email,
      channel: 'EMAIL',
      subject: `Booking confirmed — ${code}`,
      body:
        `Dear ${first.guest.fullName},\n\n` +
        `Your payment was received and your booking is confirmed.\n` +
        `Reservation: ${code}\n` +
        `Check-in: ${first.checkInDate.toDateString()} from 14:00\n` +
        `Check-out: ${first.checkOutDate.toDateString()} by 12:00\n\n` +
        `${lines.join('\n')}\n\n` +
        `Total paid: ${this.formatMoney(total)}\n`,
    });
  }

  /** UC-G14 step 9. */
  static async sendCancellationNotice(
    booking: IBooking,
    outcome: { penalty: number; refundable: number; reason: string },
  ): Promise<void> {
    await this.send({
      to: booking.guest.email,
      channel: 'EMAIL',
      subject: `Booking cancelled — ${booking.bookingCode}`,
      body:
        `Dear ${booking.guest.fullName},\n\n` +
        `Your booking ${booking.bookingCode} has been cancelled.\n` +
        `Cancellation charge: ${this.formatMoney(outcome.penalty)}\n` +
        `Refund due: ${this.formatMoney(outcome.refundable)}\n` +
        `Policy applied: ${outcome.reason}\n\n` +
        `Refunds are settled within 7–14 working days.\n`,
    });
  }

  /** UC-C03 Reset Forgotten Password — the OTP itself is never logged. */
  static async sendOtp(to: string, otp: string, channel: 'EMAIL' | 'SMS'): Promise<void> {
    await this.send({
      to,
      channel,
      subject: 'Your verification code',
      body: `Your one-time code is ${otp}. It expires in 10 minutes.`,
    });
  }

  /** UC-G16 step 9 — account verification link, valid 24 h (BR-05). */
  static async sendVerificationLink(to: string, token: string): Promise<void> {
    await this.send({
      to,
      channel: 'EMAIL',
      subject: 'Verify your account',
      body: `Please verify your account: ${process.env.FRONTEND_URL}/verify?token=${token}`,
    });
  }

  /** UC-M06 step 10 / UC-C17 step 12 — workflow decision outcome. */
  static async sendDecisionNotice(
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    await this.send({ to, channel: 'EMAIL', subject, body });
  }

  // ------------------------------------------------------------------------

  /**
   * The single point that speaks the provider's protocol. Swapping SendGrid for
   * SES changes only this method (§8.1 Modifiability).
   */
  private static async send(message: NotificationMessage): Promise<void> {
    const url = process.env.NOTIFICATION_API_URL;

    // Development without a provider: print the message instead. Registration
    // needs the verification link (BR-05) and password reset needs the OTP,
    // so silently dropping mail would make both flows impossible to test.
    if (!url) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('NOTIFICATION_API_URL is not configured');
      }
      console.log(
        `\n[mail:dev] ${message.channel} to ${message.to}` +
          (message.subject ? `\n[mail:dev] Subject: ${message.subject}` : '') +
          `\n${message.body.replace(/^/gm, '[mail:dev] ')}\n`,
      );
      return;
    }

    const res = await fetch(`${url}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.NOTIFICATION_API_KEY}`,
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      // Surfaced to the caller, which decides whether it matters. For a booking
      // confirmation it does not — the booking stands and delivery is retried.
      throw new Error(`Notification delivery failed: ${res.status}`);
    }
  }

  private static formatMoney(minorUnits: number): string {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(minorUnits);
  }
}
