/**
 * UC-G07 Book Room — contact details (UC-G08), review with voucher (UC-G11),
 * then hand-off to payOS (UC-G10). The room is held for 15 minutes (BR-10);
 * the countdown stops the guest before they pay against an expired hold.
 */
import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { bookingApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { ErrorNotice, Notice } from '../components/ui';
import { money, stayRange } from '../lib/format';
import type { GuestDetails, SearchCriteria, SearchResultItem } from '../types';

const HOLD_SECONDS = 15 * 60;
type Step = 'details' | 'review';

export default function BookingWizardPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { state } = useLocation() as {
    state: { roomType: SearchResultItem['roomType']; criteria: SearchCriteria; quote: SearchResultItem } | null;
  };

  const [step, setStep] = useState<Step>('details');
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [voucherCode, setVoucherCode] = useState('');
  const [guest, setGuest] = useState<GuestDetails>({
    fullName: profile?.fullName ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    specialRequest: '',
  });

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const book = useMutation({
    mutationFn: () =>
      bookingApi.create({
        roomTypeId: state!.roomType.id,
        checkInDate: state!.criteria.checkIn,
        checkOutDate: state!.criteria.checkOut,
        adults: state!.criteria.adults,
        children: state!.criteria.children,
        guest,
        voucherCode: voucherCode || undefined,
        // payOS settles by VietQR bank transfer.
        paymentMethod: 'BANK_TRANSFER',
      }),
    onSuccess: (r) => {
      // UC-G10 step 5 — payOS hosts the payment page.
      if (r.paymentUrl) window.location.href = r.paymentUrl;
      else navigate(`/booking/lookup?code=${r.bookingCode}&email=${encodeURIComponent(guest.email)}`);
    },
  });

  if (!state?.roomType) {
    return (
      <main className="site-main narrow">
        <div className="stack">
          <h1>Choose your dates first</h1>
          <p className="muted">A booking starts from a room search.</p>
          <Link to="/" className="btn">Search rooms</Link>
        </div>
      </main>
    );
  }

  const expired = secondsLeft === 0;
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const { roomType, criteria, quote } = state;

  function toReview(e: FormEvent) {
    e.preventDefault();
    setStep('review');
  }

  return (
    <main className="site-main">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>Book {roomType.name}</h1>
        {!expired && <span className="hold" role="timer">Room held for {mm}:{ss}</span>}
      </div>

      <ol className="steps">
        <li className={step === 'details' ? 'current' : 'done'}>Your details</li>
        <li className={step === 'review' ? 'current' : ''}>Review</li>
        <li>Pay with payOS</li>
      </ol>

      {expired && (
        <Notice tone="warn">
          The 15-minute hold on this room has ended. <Link to="/">Search again</Link> to see current availability.
        </Notice>
      )}

      <div className="split" style={{ marginTop: 16 }}>
        <div className="panel">
          {step === 'details' ? (
            <form className="form" onSubmit={toReview}>
              <h2>Who is staying?</h2>
              <label className="field">
                Full name, as on your ID
                <input value={guest.fullName} required autoComplete="name"
                  onChange={(e) => setGuest({ ...guest, fullName: e.target.value })} />
              </label>
              <div className="form-row">
                <label className="field">
                  Email
                  <input type="email" value={guest.email} required autoComplete="email"
                    onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
                </label>
                <label className="field">
                  Phone
                  <input type="tel" value={guest.phone} required autoComplete="tel"
                    onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
                </label>
              </div>
              <label className="field">
                Anything we should know? <span className="hint">Optional — arrival time, a quiet room, an extra pillow.</span>
                <textarea value={guest.specialRequest}
                  onChange={(e) => setGuest({ ...guest, specialRequest: e.target.value })} />
              </label>
              <div className="actions">
                <button className="btn" type="submit" disabled={expired}>Continue to review</button>
              </div>
            </form>
          ) : (
            <div className="form">
              <h2>Check and pay</h2>
              <dl className="facts">
                <dt>Guest</dt>
                <dd>{guest.fullName}</dd>
                <dt>Contact</dt>
                <dd>{guest.email}, {guest.phone}</dd>
                {guest.specialRequest && (
                  <>
                    <dt>Request</dt>
                    <dd>{guest.specialRequest}</dd>
                  </>
                )}
              </dl>
              <label className="field" style={{ maxWidth: 260 }}>
                Voucher code <span className="hint">Optional. The discount is applied when you pay.</span>
                <input value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} placeholder="WELCOME10" />
              </label>
              <Notice tone="info">
                You will pay on a secure payOS page by scanning a VietQR code with any Vietnamese banking app.
                Your booking is confirmed as soon as the transfer arrives.
              </Notice>
              <ErrorNotice error={book.error} />
              <div className="actions">
                <button className="btn secondary" onClick={() => setStep('details')}>Edit details</button>
                <button className="btn" disabled={expired || book.isPending} onClick={() => book.mutate()}>
                  {book.isPending ? 'Opening payOS…' : `Pay ${money(quote.total)}`}
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="panel summary" aria-label="Booking summary">
          <h3>{roomType.name}</h3>
          <p className="muted small" style={{ marginTop: 4 }}>{stayRange(criteria.checkIn, criteria.checkOut)}</p>
          <p className="muted small">
            {criteria.adults} adult{criteria.adults === 1 ? '' : 's'}
            {criteria.children ? `, ${criteria.children} child${criteria.children === 1 ? '' : 'ren'}` : ''}
          </p>
          <dl className="facts" style={{ marginTop: 14 }}>
            <dt>Room</dt>
            <dd className="money">{money(quote.subtotal)}</dd>
            <dt>VAT 10%</dt>
            <dd className="money">{money(quote.tax)}</dd>
          </dl>
          <div className="total">
            <span>Total</span>
            <span className="money">{money(quote.total)}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
