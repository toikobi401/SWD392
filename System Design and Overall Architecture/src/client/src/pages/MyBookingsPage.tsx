/**
 * «boundary» / user interaction — MyBookingsPage
 *
 * Realizes: UC-C11 View Booking History, UC-C12 View Booking Details,
 *           UC-G14 Cancel Booking, and the entry to UC-C17 Request Refund.
 *
 * The cancel action shows the outcome the server computed from
 * CancellationPolicyRule — including whether a manager must still approve the
 * refund (UC-G14 alternative flow 1.1), which the guest is told plainly rather
 * than being left to assume the money is on its way.
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, useCancelBooking, useMyBookings, formatDate, formatMoney } from '../hooks';
import { approvalApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { CancellationOutcome } from '../types';

export default function MyBookingsPage() {
  const { loading, isAuthenticated } = useAuth();
  const { data, isLoading } = useMyBookings();
  const cancel = useCancelBooking();

  const [outcome, setOutcome] = useState<CancellationOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <p className="page">Loading…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  async function handleCancel(id: string, code: string) {
    const reason = window.prompt(`Why are you cancelling ${code}?`);
    if (reason === null) return;

    setError(null);
    try {
      setOutcome(await cancel.mutateAsync({ id, reason }));
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function requestRefund(bookingId: string, amount: number) {
    try {
      const result = await approvalApi.requestRefund({
        bookingId,
        amount,
        reasonCategory: 'CANCELLATION',
        description: 'Refund for a cancelled booking',
      });
      alert(`Refund request ${result.referenceNumber} submitted.`);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div className="page">
      <h1>My bookings</h1>

      {isLoading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      {outcome && (
        <div className="info">
          <p>
            <strong>{outcome.bookingCode}</strong> is now {outcome.status.toLowerCase()}.
          </p>
          {/* Honest about what happens next — approval, refund, or neither. */}
          {outcome.requiresApproval ? (
            <p>
              Your cancellation falls inside the penalty window, so any refund needs manager
              approval. You will hear from us within 3 working days.
            </p>
          ) : outcome.refundStatus === 'MANUAL_TRANSFER' ? (
            <p>
              A refund of {formatMoney(outcome.refundable)} is due. Our accounts team will
              transfer it back to the bank account you paid from within 7 working days.
            </p>
          ) : outcome.refundable > 0 ? (
            <p>
              A refund of {formatMoney(outcome.refundable)} has been issued and settles in
              7–14 working days.
            </p>
          ) : (
            <p>No refund is due under the rate and cancellation policy.</p>
          )}
        </div>
      )}

      {data?.bookings.length === 0 && <p className="empty">You have no bookings yet.</p>}

      <ul className="results">
        {data?.bookings.map((b) => {
          const roomTypeName =
            typeof b.roomTypeId === 'string' ? b.roomTypeId : b.roomTypeId.name;

          return (
            <li key={b._id} className="result-card">
              <div className="result-body">
                <h2>{roomTypeName}</h2>
                <p className="meta">
                  <strong>{b.bookingCode}</strong> ·{' '}
                  <span className={`status status-${b.status.toLowerCase()}`}>{b.status}</span>
                </p>
                <p className="meta">
                  {formatDate(b.checkInDate)} → {formatDate(b.checkOutDate)} ·{' '}
                  {b.adults} adult(s), {b.children} child(ren)
                </p>
              </div>

              <div className="result-price">
                <strong>{formatMoney(b.totalAmount)}</strong>

                {/* Only a CONFIRMED booking can be cancelled (§6.4). */}
                {b.status === 'CONFIRMED' && (
                  <button
                    className="danger"
                    onClick={() => handleCancel(b._id, b.bookingCode)}
                    disabled={cancel.isPending}
                  >
                    Cancel booking
                  </button>
                )}

                {b.status === 'CANCELLED' && (
                  <button onClick={() => requestRefund(b._id, b.totalAmount)}>
                    Request refund
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
