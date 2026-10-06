/**
 * Guest & customer self-service: UC-G13 Check Booking Status, UC-C11 View
 * Booking History, UC-C12 View Booking Details, UC-G14 Cancel Booking,
 * UC-C17 Request Refund, UC-C05 Change Password (the account page).
 */
import { FormEvent, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, bookingApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Dialog, Empty, ErrorNotice, Loading, Notice, PageHead, Status } from '../components/ui';
import { money, ROLE_NAME, stayDate, stayRange } from '../lib/format';
import type { Booking, CancellationOutcome, RoomType } from '../types';

const roomTypeName = (b: Booking) => (typeof b.roomTypeId === 'string' ? 'Room' : (b.roomTypeId as RoomType).name);

// ---------------------------------------------------------------------------

export function BookingLookupPage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [query, setQuery] = useState<{ code: string; email: string } | null>(
    params.get('code') && params.get('email') ? { code: params.get('code')!, email: params.get('email')! } : null,
  );

  const result = useQuery({
    queryKey: ['lookup', query],
    queryFn: () => bookingApi.lookup(query!.code.trim(), query!.email.trim()),
    enabled: Boolean(query),
    retry: false,
  });

  return (
    <main className="site-main medium">
      <PageHead title="Find my booking" sub="No account needed — enter the booking code from your confirmation email and the email you booked with." />
      <form className="panel form" onSubmit={(e: FormEvent) => { e.preventDefault(); setQuery({ code, email }); }}>
        <div className="form-row">
          <label className="field">
            Booking code
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HMS-20260929-AB12C" required />
          </label>
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
        </div>
        <div className="actions">
          <button className="btn" type="submit">Find booking</button>
        </div>
      </form>

      <div style={{ marginTop: 20 }}>
        {result.isFetching && <Loading label="Looking it up…" />}
        <ErrorNotice error={result.error} />
        {result.data && <ReservationView reservationCode={result.data.reservationCode} bookings={result.data.bookings} />}
      </div>
    </main>
  );
}

/** A reservation of one or more rooms, as the guest sees it. */
function ReservationView({ reservationCode, bookings }: { reservationCode: string; bookings: Booking[] }) {
  if (bookings.length === 1) return <BookingSummary booking={bookings[0]} />;
  const first = bookings[0];
  const live = bookings.filter((b) => b.status !== 'CANCELLED' && b.status !== 'NO_SHOW');
  return (
    <div className="panel stack">
      <div className="row between">
        <h2>{bookings.length} rooms</h2>
        <span className="muted small">{reservationCode}</span>
      </div>
      <dl className="facts">
        <dt>Stay</dt>
        <dd>{stayRange(first.checkInDate, first.checkOutDate)}</dd>
        <dt>Booked by</dt>
        <dd>{first.guest.fullName}</dd>
        <dt>Total</dt>
        <dd className="money">{money(live.reduce((n, b) => n + b.totalAmount, 0))}</dd>
      </dl>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Room</th><th>Guests</th><th>Code</th><th>Status</th><th className="num">Price</th></tr></thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b._id}>
                <td className="nowrap">
                  {roomTypeName(b)}
                  {b.occupantName && <div className="xs muted">for {b.occupantName}</div>}
                </td>
                <td className="nowrap">{b.adults} adult{b.adults === 1 ? '' : 's'}{b.children ? `, ${b.children} child${b.children === 1 ? '' : 'ren'}` : ''}</td>
                <td className="muted nowrap">{b.bookingCode}</td>
                <td><Status kind="booking" value={b.status} /></td>
                <td className="num money">{money(b.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {first.status === 'CONFIRMED' && (
        <p className="muted small">Check-in from 14:00 on {stayDate(first.checkInDate)}. Each room is checked in on its own, so guests may arrive at different times.</p>
      )}
    </div>
  );
}

function BookingSummary({ booking }: { booking: Booking }) {
  return (
    <div className="panel stack">
      <div className="row between">
        <h2>{roomTypeName(booking)}</h2>
        <Status kind="booking" value={booking.status} />
      </div>
      <dl className="facts">
        <dt>Booking code</dt>
        <dd>{booking.bookingCode}</dd>
        <dt>Stay</dt>
        <dd>{stayRange(booking.checkInDate, booking.checkOutDate)}</dd>
        <dt>Guests</dt>
        <dd>{booking.adults} adult{booking.adults === 1 ? '' : 's'}{booking.children ? `, ${booking.children} child${booking.children === 1 ? '' : 'ren'}` : ''}</dd>
        <dt>Booked for</dt>
        <dd>{booking.guest.fullName}</dd>
        <dt>Total paid</dt>
        <dd className="money">{money(booking.totalAmount)}</dd>
      </dl>
      {booking.status === 'CONFIRMED' && (
        <p className="muted small">Check-in from 14:00 on {stayDate(booking.checkInDate)}. Bring the ID of the person named above.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MyBookingsPage() {
  const { profile } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['my-bookings'], queryFn: bookingApi.mine });

  // One row per reservation — rooms booked together belong together.
  const groups = groupReservations(data ?? []);
  const isLive = (g: Booking[]) => g.some((b) => b.status === 'CONFIRMED' || b.status === 'CHECKED_IN' || b.status === 'PENDING');
  // Soonest stay first for what is coming up; most recent first for history.
  const upcoming = groups.filter(isLive).sort((a, b) => a[0].checkInDate.localeCompare(b[0].checkInDate));
  const past = groups.filter((g) => !isLive(g));

  return (
    <main className="site-main">
      <PageHead title="My bookings" sub={profile?.loyalty ? `${profile.loyalty.points.toLocaleString('vi-VN')} loyalty points, ${profile.loyalty.tier.toLowerCase()} tier. Points are added when a stay is completed.` : undefined}>
        <Link to="/" className="btn">Book a stay</Link>
      </PageHead>
      {isLoading && <Loading />}
      <ErrorNotice error={error} />

      {data && data.length === 0 && (
        <Empty title="No bookings yet">
          <p><Link to="/">Search rooms</Link> to plan your first stay.</p>
        </Empty>
      )}

      {upcoming.length > 0 && (
        <section className="stack" style={{ marginBottom: 28 }}>
          <h2>Upcoming and current</h2>
          <BookingTable rows={upcoming} />
        </section>
      )}
      {past.length > 0 && (
        <section className="stack">
          <h2>Past and cancelled</h2>
          <BookingTable rows={past} />
        </section>
      )}
    </main>
  );
}

function groupReservations(bookings: Booking[]): Booking[][] {
  const byCode = new Map<string, Booking[]>();
  for (const b of bookings) {
    const code = b.reservationCode ?? b.bookingCode;
    byCode.set(code, [...(byCode.get(code) ?? []), b]);
  }
  return [...byCode.values()].map((g) => g.sort((a, b) => a.bookingCode.localeCompare(b.bookingCode)));
}

/** "Deluxe Sea View × 2, Family Suite" */
function roomsLabel(group: Booking[]): string {
  const counts = new Map<string, number>();
  group.forEach((b) => counts.set(roomTypeName(b), (counts.get(roomTypeName(b)) ?? 0) + 1));
  return [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} × ${n}` : name)).join(', ');
}

function BookingTable({ rows }: { rows: Booking[][] }) {
  return (
    <div className="panel flush table-wrap">
      <table className="data">
        <thead>
          <tr><th>Rooms</th><th>Stay</th><th>Code</th><th>Status</th><th className="num">Total</th></tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const first = g[0];
            const statuses = [...new Set(g.map((b) => b.status))];
            return (
              <tr key={first.reservationCode ?? first._id}>
                <td><Link to={`/bookings/${first._id}`}>{roomsLabel(g)}</Link></td>
                <td className="nowrap">{stayRange(first.checkInDate, first.checkOutDate)}</td>
                <td className="nowrap muted">{first.reservationCode ?? first.bookingCode}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {statuses.map((st) => <Status key={st} kind="booking" value={st} />)}
                  </div>
                </td>
                <td className="num money">{money(g.reduce((n, b) => n + b.totalAmount, 0))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: b, isLoading, error } = useQuery({ queryKey: ['booking', id], queryFn: () => bookingApi.detail(id!) });
  const [confirming, setConfirming] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [outcome, setOutcome] = useState<CancellationOutcome | null>(null);
  const [refundRef, setRefundRef] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: (reason: string) => bookingApi.cancel(id!, reason),
    onSuccess: (o) => {
      setOutcome(o);
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ['booking', id] });
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
    },
  });

  if (isLoading) return <main className="site-main medium"><Loading /></main>;
  if (error || !b) return <main className="site-main medium"><ErrorNotice error={error ?? new Error('Booking not found')} /></main>;

  const hoursToArrival = (Date.parse(b.checkInDate) - Date.now()) / 3_600_000;
  // A refund is already on its way for 7 days after cancelling; offering to
  // "request" it again would only invite a duplicate claim.
  const recentlyCancelled = Boolean(b.cancelledAt) && Date.now() - Date.parse(b.cancelledAt!) < 7 * 86_400_000;

  return (
    <main className="site-main medium">
      <Link to="/my-bookings" className="small">Back to my bookings</Link>
      <div className="stack" style={{ marginTop: 12 }}>
        {outcome && <CancellationNotice outcome={outcome} />}
        {refundRef && <Notice tone="ok">Refund request {refundRef} sent. We reply within 3 working days.</Notice>}

        <BookingSummary booking={b} />

        {b.reservation && b.reservation.rooms.length > 1 && (
          <div className="panel stack tight">
            <div className="row between">
              <h3>Booked together</h3>
              <span className="muted small">{b.reservation.code}</span>
            </div>
            <ul className="sibling-rooms">
              {b.reservation.rooms.map((r) => (
                <li key={r._id} className={r._id === b._id ? 'current' : ''}>
                  {r._id === b._id ? <span>{r.roomType} (this room)</span> : <Link to={`/bookings/${r._id}`}>{r.roomType}</Link>}
                  <span className="row" style={{ gap: 10 }}>
                    <Status kind="booking" value={r.status} />
                    <span className="money">{money(r.totalAmount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {b.status === 'CONFIRMED' && (
          <div className="panel stack tight">
            <h3>{b.reservation && b.reservation.rooms.length > 1 ? 'Cancel this room' : 'Cancel this stay'}</h3>
            {b.reservation && b.reservation.rooms.length > 1 && (
              <p className="small">Only this room is cancelled — the other rooms stay booked.</p>
            )}
            <p className="small muted">
              {b.nonRefundable
                ? 'This booking was made on a non-refundable rate, so no money is returned if you cancel.'
                : hoursToArrival >= 48
                  ? 'Free cancellation until 48 hours before check-in — you get the full amount back.'
                  : hoursToArrival >= 24
                    ? 'Less than 48 hours to check-in: cancelling now costs 50% of the booking.'
                    : 'Less than 24 hours to check-in: the full amount is charged, and any refund needs a manager’s approval.'}
            </p>
            <div className="actions">
              <button className="btn danger" onClick={() => setConfirming(true)}>Cancel booking</button>
            </div>
          </div>
        )}

        {b.status === 'CANCELLED' && !outcome && !refundRef && recentlyCancelled && (
          <p className="small muted">Any refund due is transferred within 7 working days of cancelling. If it has not arrived after that, you can ask us about it here.</p>
        )}

        {b.status === 'CANCELLED' && !outcome && !refundRef && !recentlyCancelled && (
          <div className="panel stack tight">
            <h3>Money not back yet?</h3>
            <p className="small muted">If a refund you were due has not arrived, send us a request and a manager will review it.</p>
            <div className="actions">
              <button className="btn secondary" onClick={() => setRefunding(true)}>Request a refund</button>
            </div>
          </div>
        )}
      </div>

      {confirming && (
        <CancelDialog
          booking={b}
          busy={cancel.isPending}
          error={cancel.error}
          onClose={() => setConfirming(false)}
          onConfirm={(reason) => cancel.mutate(reason)}
        />
      )}
      {refunding && (
        <RefundDialog
          booking={b}
          onClose={() => setRefunding(false)}
          onSent={(ref) => { setRefundRef(ref); setRefunding(false); }}
        />
      )}
    </main>
  );
}

function CancellationNotice({ outcome }: { outcome: CancellationOutcome }) {
  switch (outcome.refundStatus) {
    case 'MANUAL_TRANSFER':
      return <Notice tone="ok">Booking cancelled. {money(outcome.refundable)} will be transferred back to the account you paid from within 7 working days.</Notice>;
    case 'AWAITING_APPROVAL':
      return <Notice tone="warn">Booking cancelled. Because it was close to arrival, a manager will decide on any refund within 3 working days.</Notice>;
    case 'ISSUED':
      return <Notice tone="ok">Booking cancelled. A refund of {money(outcome.refundable)} is on its way.</Notice>;
    default:
      return <Notice tone="info">Booking cancelled. No refund is due under this booking’s rate.</Notice>;
  }
}

function CancelDialog({ booking, busy, error, onClose, onConfirm }: {
  booking: Booking; busy: boolean; error: unknown; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title="Cancel booking?" onClose={onClose}>
      <p>{roomTypeName(booking)}, {stayRange(booking.checkInDate, booking.checkOutDate)}.</p>
      <label className="field">
        Reason <span className="hint">Optional — it helps us improve.</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ErrorNotice error={error} />
      <div className="actions end">
        <button className="btn secondary" onClick={onClose}>Keep booking</button>
        <button className="btn danger" disabled={busy} onClick={() => onConfirm(reason)}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
      </div>
    </Dialog>
  );
}

function RefundDialog({ booking, onClose, onSent }: { booking: Booking; onClose: () => void; onSent: (ref: string) => void }) {
  const [amount, setAmount] = useState(booking.totalAmount);
  const [category, setCategory] = useState('CANCELLATION');
  const [description, setDescription] = useState('');
  const send = useMutation({
    mutationFn: () => bookingApi.requestRefund({ bookingId: booking._id, amount, reasonCategory: category, description }),
    onSuccess: (r) => onSent(r.referenceNumber),
  });
  return (
    <Dialog title="Request a refund" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        <label className="field">
          Amount <span className="hint">Up to {money(booking.totalAmount)} — what you paid.</span>
          <input type="number" min={1} max={booking.totalAmount} value={amount} onChange={(e) => setAmount(Number(e.target.value))} required />
        </label>
        <label className="field">
          Reason
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="CANCELLATION">I cancelled the booking</option>
            <option value="OVERCHARGE">I was charged too much</option>
            <option value="SERVICE_ISSUE">Something was wrong with my stay</option>
          </select>
        </label>
        <label className="field">
          Details
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <ErrorNotice error={send.error} />
        <div className="actions end">
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
          <button className="btn" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send request'}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function AccountPage({ inConsole = false }: { inConsole?: boolean }) {
  const { profile } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => { setCurrent(''); setNext(''); },
  });

  if (!profile) return null;
  const body = (
    <div className="stack">
      <PageHead title="Account" />
      <div className="panel">
        <dl className="facts">
          <dt>Name</dt><dd>{profile.fullName}</dd>
          <dt>Email</dt><dd>{profile.email}</dd>
          {profile.phone && (<><dt>Phone</dt><dd>{profile.phone}</dd></>)}
          <dt>Roles</dt><dd>{profile.roles.map((r) => ROLE_NAME[r] ?? r).join(', ')}</dd>
          {profile.employee && (
            <>
              <dt>Position</dt><dd>{profile.employee.position}, {profile.employee.department}</dd>
              <dt>Employee code</dt><dd>{profile.employee.employeeCode}</dd>
            </>
          )}
          {profile.loyalty && (<><dt>Loyalty</dt><dd>{profile.loyalty.points.toLocaleString('vi-VN')} points, {profile.loyalty.tier.toLowerCase()} tier</dd></>)}
        </dl>
      </div>

      <form className="panel form" style={{ maxWidth: 460 }} onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
        <h3>Change password</h3>
        <label className="field">
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </label>
        <label className="field">
          New password <span className="hint">At least 8 characters, with upper- and lowercase letters and a digit.</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
        </label>
        <ErrorNotice error={change.error} />
        {change.isSuccess && <Notice tone="ok">Password changed.</Notice>}
        <div className="actions">
          <button className="btn" disabled={change.isPending}>{change.isPending ? 'Saving…' : 'Change password'}</button>
        </div>
      </form>
    </div>
  );
  return inConsole ? body : <main className="site-main medium">{body}</main>;
}

