/**
 * «boundary» / user interaction — PaymentResultPage
 *
 * Realizes: UC-G10 steps 7–10 and alternative flow 1.3, from the guest's side.
 *
 * payOS redirects the guest here after checkout (returnUrl) or after they
 * press cancel (cancelUrl), appending `?status=PAID&...` to the address. This
 * page deliberately IGNORES those query parameters — anyone can type them — and
 * asks our server instead, which asks payOS server-to-server.
 *
 * A bank transfer can land a few seconds after the redirect, so while payOS
 * still says PENDING the page keeps checking for a short while.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { paymentApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { ReconcileResult } from '../types';

const POLL_INTERVAL_MS = 3_000;
const POLL_LIMIT = 40; // ~2 minutes

export default function PaymentResultPage({ cancelled = false }: { cancelled?: boolean }) {
  const { orderCode } = useParams<{ orderCode: string }>();
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    async function check() {
      try {
        const r = await paymentApi.reconcile(Number(orderCode));
        if (stopped) return;
        setResult(r);

        // Settled either way — stop polling.
        if (r.paymentStatus !== 'PENDING') return;
      } catch (err) {
        if (stopped) return;
        setError((err as ApiError).message);
        return;
      }

      if (++attempts >= POLL_LIMIT) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(check, POLL_INTERVAL_MS);
    }

    check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [orderCode]);

  if (error) {
    return (
      <main className="site-main narrow"><div className="panel stack">
        <h1>We could not check this payment</h1>
        <p className="notice error">{error}</p>
        <Link to="/" className="btn">Back to rooms</Link>
      </div></main>
    );
  }

  if (!result) {
    return (
      <main className="site-main narrow"><div className="panel stack">
        <h1>Checking your payment…</h1>
      </div></main>
    );
  }

  if (result.paymentStatus === 'PAID') {
    return (
      <main className="site-main narrow"><div className="panel stack">
        <h1>Booking confirmed</h1>
        <div className="notice ok stack tight">
          <p>
            Your payment was received and{' '}
            {result.rooms.length > 1
              ? <>all {result.rooms.length} rooms of booking <strong>{result.reservationCode}</strong> are confirmed.</>
              : <>booking <strong>{result.bookingCode}</strong> is confirmed.</>}
          </p>
          <p>A confirmation has been sent to your email.</p>
        </div>
        <Link to="/my-bookings" className="btn">See my bookings</Link>
      </div></main>
    );
  }

  if (result.paymentStatus === 'FAILED') {
    return (
      <main className="site-main narrow"><div className="panel stack">
        <h1>{cancelled ? 'Payment cancelled' : 'Payment not completed'}</h1>
        <p className="notice warn">
          No money was taken and the room has been released. You can search again and book
          whenever you are ready.
        </p>
        <Link to="/" className="btn">Search rooms</Link>
      </div></main>
    );
  }

  // Still PENDING.
  return (
    <main className="site-main narrow"><div className="panel stack">
      <h1>{cancelled ? 'Did you cancel the payment?' : 'Waiting for your bank…'}</h1>
      {gaveUp ? (
        <p className="notice warn">
          payOS has not confirmed this payment yet. If money has left your account, it will
          be matched automatically and you will receive a confirmation email. Reference:{' '}
          <strong>{result.reservationCode ?? result.bookingCode}</strong>
        </p>
      ) : (
        <p className="notice info">
          Confirming with payOS — this usually takes a few seconds. Please keep this page open.
        </p>
      )}
    </div></main>
  );
}
