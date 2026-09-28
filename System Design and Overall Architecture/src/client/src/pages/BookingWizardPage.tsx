/**
 * «boundary» / user interaction — BookingWizardPage
 *
 * Realizes: UC-G07 Book Room, following the Normal Flow as three visible steps:
 * contact details (UC-G08) → review and voucher (UC-G11) → payment (UC-G10).
 *
 * The hold placed server-side lasts 15 minutes (BR-10), so the page shows the
 * remaining time and stops the guest before they submit against an expired
 * hold — UC-G07 exception 1.0.E2.
 */
import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCreateBooking, formatMoney, formatDate, useAuth } from '../hooks';
import { ApiError } from '../api/client';
import type { GuestDetails, PaymentMethod, SearchCriteria, SearchResultItem } from '../types';

const HOLD_SECONDS = 15 * 60;

type Step = 'CONTACT' | 'REVIEW' | 'PAYMENT';

export default function BookingWizardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { state } = useLocation() as {
    state: { roomType: SearchResultItem['roomType']; criteria: SearchCriteria; quote: SearchResultItem };
  };

  const [step, setStep] = useState<Step>('CONTACT');
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [voucherCode, setVoucherCode] = useState('');
  // payOS settles by VietQR bank transfer — there is no separate card option.
  const [paymentMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [guest, setGuest] = useState<GuestDetails>({
    // UC-G07 alternative flow 1.2 — prefilled for a signed-in Customer.
    fullName: user?.fullName ?? '',
    email: user?.email ?? '',
    phone: '',
    specialRequest: '',
  });

  const createBooking = useCreateBooking();

  // BR-10 countdown.
  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!state?.roomType) {
    return (
      <div className="page">
        <p>Please start from a room search.</p>
        <button onClick={() => navigate('/')}>Back to search</button>
      </div>
    );
  }

  const expired = secondsLeft === 0;

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();

    const result = await createBooking.mutateAsync({
      roomTypeId: state.roomType.id,
      checkInDate: state.criteria.checkIn,
      checkOutDate: state.criteria.checkOut,
      adults: state.criteria.adults,
      children: state.criteria.children,
      roomCount: state.criteria.rooms,
      guest,
      voucherCode: voucherCode || undefined,
      paymentMethod,
    });

    // UC-G10 step 5 — hand the guest to the payOS checkout. They come back to
    // /payment/result/:orderCode, which confirms the payment with the server.
    if (result.paymentUrl) {
      window.location.href = result.paymentUrl;
      return;
    }

    navigate('/booking-confirmed', { state: { confirmation: result } });
  }

  const error = createBooking.error as ApiError | null;

  return (
    <div className="page">
      <h1>Complete your booking</h1>

      <p className={expired ? 'error' : 'hold-timer'}>
        {expired
          ? 'Your session expired. Please search again.'
          : `We are holding this room for ${Math.floor(secondsLeft / 60)}:${String(
              secondsLeft % 60,
            ).padStart(2, '0')}`}
      </p>

      <ol className="stepper">
        <li className={step === 'CONTACT' ? 'active' : ''}>1. Your details</li>
        <li className={step === 'REVIEW' ? 'active' : ''}>2. Review</li>
        <li className={step === 'PAYMENT' ? 'active' : ''}>3. Payment</li>
      </ol>

      {/* Step 3–4: «include» UC-G08 Enter Contact Information */}
      {step === 'CONTACT' && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            setStep('REVIEW');
          }}
        >
          <label>
            Full name
            <input
              value={guest.fullName}
              onChange={(e) => setGuest({ ...guest, fullName: e.target.value })}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={guest.email}
              onChange={(e) => setGuest({ ...guest, email: e.target.value })}
              required
            />
          </label>
          <label>
            Phone
            <input
              value={guest.phone}
              onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
              required
            />
          </label>
          <label>
            Special request
            <textarea
              value={guest.specialRequest}
              onChange={(e) => setGuest({ ...guest, specialRequest: e.target.value })}
            />
          </label>
          <button type="submit" disabled={expired}>
            Continue
          </button>
        </form>
      )}

      {/* Step 7–8: summary and «extend» UC-G11 Apply Discount Code */}
      {step === 'REVIEW' && (
        <div className="review">
          <h2>{state.roomType.name}</h2>
          <dl>
            <dt>Check-in</dt>
            <dd>{formatDate(state.criteria.checkIn)}</dd>
            <dt>Check-out</dt>
            <dd>{formatDate(state.criteria.checkOut)}</dd>
            <dt>Guests</dt>
            <dd>
              {state.criteria.adults} adult(s), {state.criteria.children} child(ren)
            </dd>
            <dt>Room subtotal</dt>
            <dd>{formatMoney(state.quote.subtotal)}</dd>
            <dt>Tax</dt>
            <dd>{formatMoney(state.quote.tax)}</dd>
            <dt>
              <strong>Total</strong>
            </dt>
            <dd>
              <strong>{formatMoney(state.quote.total)}</strong>
            </dd>
          </dl>

          <label>
            Voucher code
            <input
              value={voucherCode}
              onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
              placeholder="Optional"
            />
          </label>

          <div className="actions">
            <button onClick={() => setStep('CONTACT')}>Back</button>
            <button onClick={() => setStep('PAYMENT')} disabled={expired}>
              Continue to payment
            </button>
          </div>
        </div>
      )}

      {/* Step 9: «include» UC-G10 Pay for Booking */}
      {step === 'PAYMENT' && (
        <form className="form" onSubmit={handleConfirm}>
          <fieldset>
            <legend>Payment method</legend>
            <p>
              <strong>payOS — VietQR / banking app.</strong> You will be taken to a secure payOS
              page to scan a QR code with any Vietnamese banking app. We never see your bank
              details.
            </p>
          </fieldset>

          <p className="total">Amount due: {formatMoney(state.quote.total)}</p>

          {/* UC-G07 exceptions surface here by code, not by guessing at text. */}
          {error && (
            <p className="error">
              {error.code === 'NO_AVAILABILITY'
                ? 'This room is no longer available. Please search again.'
                : error.code === 'PAYMENT_DECLINED'
                  ? 'Payment was declined. Please try another method.'
                  : error.message}
            </p>
          )}

          <div className="actions">
            <button type="button" onClick={() => setStep('REVIEW')}>
              Back
            </button>
            <button type="submit" disabled={expired || createBooking.isPending}>
              {createBooking.isPending ? 'Processing…' : 'Confirm and pay'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
