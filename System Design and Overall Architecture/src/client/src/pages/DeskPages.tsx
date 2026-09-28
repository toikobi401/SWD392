/**
 * Front desk: the day at a glance (arrivals, due out, in house), one stay at a
 * time (UC-R06 check in, UC-R09 check out, UC-R05 cancel), and the guest folio
 * (UC-R19 post charges, UC-R15 take payment — cash or a payOS VietQR).
 */
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { bookingApi, deskApi, paymentApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorNotice, Loading, Notice, PageHead, Stat, Status } from '../components/ui';
import { hotelTodayISO, money, PAYMENT_METHOD, stayDate, stayDateShort, stayRange, when, newKey } from '../lib/format';
import type { AllocatableRoom, Booking, CheckInRequest, DeskPaymentResult, Room, RoomType } from '../types';
import { refId } from '../types';

const rt = (b: Booking) => (typeof b.roomTypeId === 'string' ? undefined : (b.roomTypeId as RoomType));
const roomNo = (b: Booking) => (b.roomId && typeof b.roomId !== 'string' ? (b.roomId as Room).roomNumber : undefined);

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export function FrontDeskPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [searched, setSearched] = useState<string | null>(null);

  const overview = useQuery({ queryKey: ['desk-overview'], queryFn: deskApi.overview, refetchInterval: 60_000 });
  const search = useQuery({
    queryKey: ['desk-search', searched],
    queryFn: () => deskApi.search(searched!),
    enabled: Boolean(searched),
  });

  const o = overview.data;
  const dueOutIds = new Set(o?.departures.map((b) => b._id));
  const stayingOn = o?.inHouse.filter((b) => !dueOutIds.has(b._id)) ?? [];

  return (
    <div className="stack">
      <PageHead title="Today at the desk" sub={o ? stayDate(o.date) : undefined}>
        <Link to="/staff/rack" className="btn secondary">Open room rack</Link>
      </PageHead>

      {overview.isLoading && <Loading />}
      <ErrorNotice error={overview.error} />

      {o && (
        <div className="stat-row">
          <Stat value={o.arrivals.length} label="Arrivals to check in" />
          <Stat value={o.departures.length} label="Departures due" />
          <Stat value={o.inHouse.length} label="Rooms occupied" />
          <Stat value={o.rooms.VACANT_CLEAN ?? 0} label="Clean rooms ready" />
          <Stat value={(o.rooms.VACANT_DIRTY ?? 0) + (o.rooms.INSPECTED ?? 0)} label="Being turned around" />
        </div>
      )}

      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); setSearched(q.trim() || null); }}>
        <input className="input grow" style={{ maxWidth: 480 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Find any booking by code, guest name, phone or email" aria-label="Find a booking" />
        <button className="btn">Find</button>
        {searched && <button type="button" className="btn ghost" onClick={() => { setSearched(null); setQ(''); }}>Clear</button>}
      </form>

      {searched && (
        <div className="panel flush">
          {search.isLoading && <div style={{ padding: 16 }}><Loading /></div>}
          <ErrorNotice error={search.error} />
          {search.data?.length === 0 && <div style={{ padding: 16 }} className="muted">No booking matches “{searched}”.</div>}
          {search.data && search.data.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Guest</th><th>Code</th><th>Stay</th><th>Room</th><th>Status</th></tr></thead>
                <tbody>
                  {search.data.map((b) => (
                    <tr key={b._id} className="clickable" onClick={() => navigate(`/staff/bookings/${b._id}`)}>
                      <td><Link to={`/staff/bookings/${b._id}`}>{b.guest.fullName}</Link></td>
                      <td className="muted nowrap">{b.bookingCode}</td>
                      <td className="nowrap">{stayRange(b.checkInDate, b.checkOutDate)}</td>
                      <td>{roomNo(b) ?? rt(b)?.name ?? '—'}</td>
                      <td><Status kind="booking" value={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {o && (
        <div className="desk-grid">
          <GuestColumn title="Arriving" empty="Every arrival is checked in." rows={o.arrivals}
            side={() => undefined} meta={(b) => `${rt(b)?.name ?? ''}, ${b.adults} guest${b.adults === 1 ? '' : 's'}, until ${stayDateShort(b.checkOutDate)}`} />
          <GuestColumn title="Due out" empty="No more departures today." rows={o.departures}
            side={(b) => roomNo(b)} meta={(b) => `${rt(b)?.name ?? ''}, since ${stayDateShort(b.checkInDate)}`} />
          <GuestColumn title="Staying on" empty="No other guests in house." rows={stayingOn}
            side={(b) => roomNo(b)} meta={(b) => `until ${stayDateShort(b.checkOutDate)}`} />
        </div>
      )}
    </div>
  );
}

function GuestColumn({ title, rows, empty, side, meta }: {
  title: string; rows: Booking[]; empty: string; side: (b: Booking) => string | undefined; meta: (b: Booking) => string;
}) {
  return (
    <section className="panel flush" aria-label={title}>
      <div className="panel-head" style={{ padding: '14px 16px 0' }}>
        <h3>{title}</h3>
        <span className="muted small">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted small" style={{ padding: '4px 16px 16px' }}>{empty}</p>
      ) : (
        <ul className="guest-list" style={{ maxHeight: 520, overflowY: 'auto' }}>
          {rows.map((b) => (
            <li key={b._id}>
              <Link to={`/staff/bookings/${b._id}`}>
                <span className="name">{b.guest.fullName}</span>
                <span className="side">{side(b)}</span>
                <span className="meta">{meta(b)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One stay
// ---------------------------------------------------------------------------

export function StaffBookingPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const booking = useQuery({ queryKey: ['booking', id], queryFn: () => bookingApi.detail(id!) });
  const folioId = useQuery({
    queryKey: ['folio-of', id],
    queryFn: () => deskApi.folioIdFor(id!),
    enabled: Boolean(booking.data && booking.data.status !== 'CONFIRMED'),
  });

  // The check-in panel unmounts once the stay is in house, so its success
  // message is lifted here to survive the status change.
  const [flash, setFlash] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['booking', id] });
    qc.invalidateQueries({ queryKey: ['folio-of', id] });
    qc.invalidateQueries({ queryKey: ['desk-overview'] });
    qc.invalidateQueries({ queryKey: ['rack'] });
  };

  if (booking.isLoading) return <Loading />;
  if (booking.error || !booking.data) return <ErrorNotice error={booking.error ?? new Error('Booking not found')} />;
  const b = booking.data;

  return (
    <div className="stack">
      <Link to="/staff" className="small">Back to today</Link>
      <PageHead title={b.guest.fullName} sub={`${b.bookingCode}, booked ${stayDate(b.createdAt)}`}>
        <Status kind="booking" value={b.status} />
      </PageHead>

      {flash && <Notice tone="ok">{flash}</Notice>}

      <div className="split">
        <div className="stack">
          {b.status === 'CONFIRMED' && can('CHECK_IN') && (
            <CheckInPanel
              booking={b}
              onDone={(room) => {
                setFlash(`Checked in to room ${room}. Hand over the key card and ask the guest to sign the registration card.`);
                refresh();
              }}
            />
          )}
          {b.status === 'CHECKED_IN' && can('CHECK_OUT') && <CheckOutPanel booking={b} folioId={folioId.data ?? null} onDone={refresh} />}
          {b.status === 'CHECKED_OUT' && (
            <Notice tone="info">Checked out {when(b.actualCheckOutAt)}. The folio and invoice are closed.</Notice>
          )}
          {(b.status === 'CANCELLED' || b.status === 'NO_SHOW') && (
            <Notice tone="info">{b.status === 'NO_SHOW' ? 'The guest did not arrive.' : `Cancelled ${when(b.cancelledAt)}${b.cancellationReason ? ` — ${b.cancellationReason}` : ''}.`}</Notice>
          )}
          {b.status === 'CONFIRMED' && can('BOOKING_MODIFY') && <DeskCancel booking={b} onDone={refresh} />}
        </div>

        <aside className="panel summary stack tight">
          <h3>{rt(b)?.name ?? 'Room'}{roomNo(b) ? `, room ${roomNo(b)}` : ''}</h3>
          <dl className="facts">
            <dt>Stay</dt><dd>{stayRange(b.checkInDate, b.checkOutDate)}</dd>
            <dt>Guests</dt><dd>{b.adults} adult{b.adults === 1 ? '' : 's'}{b.children ? `, ${b.children} child${b.children === 1 ? '' : 'ren'}` : ''}</dd>
            <dt>Phone</dt><dd>{b.guest.phone}</dd>
            <dt>Email</dt><dd style={{ wordBreak: 'break-all' }}>{b.guest.email}</dd>
            {b.guest.specialRequest && (<><dt>Request</dt><dd>{b.guest.specialRequest}</dd></>)}
            <dt>Paid online</dt><dd className="money">{money(b.totalAmount)}</dd>
            {b.nonRefundable && (<><dt>Rate</dt><dd>Non-refundable</dd></>)}
            {b.actualCheckInAt && (<><dt>Checked in</dt><dd>{when(b.actualCheckInAt)}</dd></>)}
          </dl>
          {folioId.data && <Link to={`/staff/folios/${folioId.data}`} className="btn secondary block">Open folio</Link>}
        </aside>
      </div>
    </div>
  );
}

function CheckInPanel({ booking, onDone }: { booking: Booking; onDone: (roomNumber: string) => void }) {
  const roomTypeId = refId(booking.roomTypeId as { _id: string } | string)!;
  const rooms = useQuery({ queryKey: ['allocatable', roomTypeId], queryFn: () => deskApi.allocatable(roomTypeId), staleTime: 0 });
  const [room, setRoom] = useState<AllocatableRoom | null>(null);
  const [identity, setIdentity] = useState<CheckInRequest['identity']>({
    documentType: 'NATIONAL_ID', documentNumber: '', fullName: booking.guest.fullName, dateOfBirth: '', expiryDate: '',
  });
  const checkIn = useMutation({
    mutationFn: () => deskApi.checkIn({ bookingId: booking._id, identity, roomId: room!.id, roomVersion: room!.version }),
    onSuccess: (r) => onDone(r.roomNumber),
    onError: (err) => {
      // UC-R06 1.0.E6 — another desk took the room: refresh the choices.
      if (err instanceof ApiError && err.code === 'ROOM_TAKEN') { setRoom(null); rooms.refetch(); }
    },
  });

  // Compare calendar dates in hotel time: at 03:00 in Hanoi it is still the
  // previous day in UTC, and an instant comparison calls a same-day arrival early.
  const early = booking.checkInDate.slice(0, 10) > hotelTodayISO(0);
  const set = (k: keyof CheckInRequest['identity']) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setIdentity({ ...identity, [k]: e.target.value });

  return (
    <form className="panel form" onSubmit={(e) => { e.preventDefault(); checkIn.mutate(); }}>
      <div className="panel-head" style={{ marginBottom: 0 }}><h2>Check in</h2></div>
      {early && <Notice tone="warn">This booking starts {stayDate(booking.checkInDate)} — checking in now is an early arrival.</Notice>}

      <fieldset className="form" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 8 }}>Identity document</legend>
        <div className="form-row">
          <label className="field">
            Type
            <select value={identity.documentType} onChange={set('documentType')}>
              <option value="NATIONAL_ID">Citizen ID (CCCD)</option>
              <option value="PASSPORT">Passport</option>
              <option value="DRIVING_LICENCE">Driving licence</option>
            </select>
          </label>
          <label className="field">
            Number
            <input value={identity.documentNumber} onChange={set('documentNumber')} required />
          </label>
        </div>
        <label className="field">
          Name on the document <span className="hint">Must match the booking.</span>
          <input value={identity.fullName} onChange={set('fullName')} required />
        </label>
        <div className="form-row">
          <label className="field">Date of birth<input type="date" value={identity.dateOfBirth} onChange={set('dateOfBirth')} required /></label>
          <label className="field">Expires<input type="date" value={identity.expiryDate} onChange={set('expiryDate')} required /></label>
        </div>
      </fieldset>

      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600 }}>Room — clean and ready ({rooms.data?.length ?? 0})</span>
        {rooms.isLoading && <Loading />}
        {rooms.data?.length === 0 && (
          <Notice tone="warn">No clean room of this type is ready. Ask housekeeping to prioritise one, or offer an upgrade.</Notice>
        )}
        <div className="room-pick" role="group" aria-label="Choose a room">
          {rooms.data?.map((r) => (
            <button type="button" key={r.id} aria-pressed={room?.id === r.id} onClick={() => setRoom(r)}>
              {r.roomNumber}<small>floor {r.floor}</small>
            </button>
          ))}
        </div>
      </div>

      {checkIn.error instanceof ApiError && checkIn.error.code === 'ROOM_TAKEN'
        ? <Notice tone="warn">Another desk just gave that room away. The list is refreshed — choose again.</Notice>
        : <ErrorNotice error={checkIn.error} />}

      <div className="actions">
        <button className="btn" disabled={!room || checkIn.isPending}>
          {checkIn.isPending ? 'Checking in…' : room ? `Check in to ${room.roomNumber}` : 'Choose a room'}
        </button>
      </div>
    </form>
  );
}

function CheckOutPanel({ booking, folioId, onDone }: { booking: Booking; folioId: string | null; onDone: () => void }) {
  const [late, setLate] = useState(0);
  const [waive, setWaive] = useState(false);
  const checkOut = useMutation({
    mutationFn: () => deskApi.checkOut(booking._id, { lateCheckoutSurcharge: late || undefined, waiveSurcharge: waive }),
    onSuccess: onDone,
  });

  if (checkOut.data) {
    return (
      <Notice tone="ok">
        Checked out. Invoice <strong>{checkOut.data.invoiceNumber}</strong> for {money(checkOut.data.total)} issued; the room is
        now waiting for housekeeping.
      </Notice>
    );
  }

  const owes = checkOut.error instanceof ApiError && checkOut.error.code === 'OUTSTANDING_BALANCE';

  return (
    <form className="panel form" onSubmit={(e) => { e.preventDefault(); checkOut.mutate(); }}>
      <div className="panel-head" style={{ marginBottom: 0 }}><h2>Check out</h2></div>
      <p className="small muted">Due out {stayDate(booking.checkOutDate)} by 12:00. The folio must be settled before the stay closes.</p>
      <div className="form-row">
        <label className="field">
          Late check-out charge <span className="hint">Before VAT. Leave 0 if on time.</span>
          <input type="number" min={0} step={50000} value={late} onChange={(e) => setLate(Number(e.target.value))} />
        </label>
      </div>
      {late > 0 && (
        <label className="check">
          <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
          Waive it — a manager approved
        </label>
      )}
      {owes ? (
        <Notice tone="warn">
          {(checkOut.error as ApiError).message}. {folioId && <Link to={`/staff/folios/${folioId}`}>Take the payment on the folio</Link>}, then check out again.
        </Notice>
      ) : (
        <ErrorNotice error={checkOut.error} />
      )}
      <div className="actions">
        <button className="btn" disabled={checkOut.isPending}>{checkOut.isPending ? 'Closing the stay…' : 'Check out and issue invoice'}</button>
        {folioId && <Link to={`/staff/folios/${folioId}`} className="btn secondary">Review folio</Link>}
      </div>
    </form>
  );
}

function DeskCancel({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({ mutationFn: () => bookingApi.cancel(booking._id, reason), onSuccess: onDone });
  if (cancel.data) return <Notice tone="ok">Cancelled. Refund due: {money(cancel.data.refundable)}{cancel.data.refundStatus === 'MANUAL_TRANSFER' ? ' — to be transferred by hand (payOS cannot refund automatically).' : '.'}</Notice>;
  return (
    <div className="panel stack tight">
      <h3>Cancel on the guest’s behalf</h3>
      {!open ? (
        <div className="actions"><button className="btn secondary" onClick={() => setOpen(true)}>Cancel booking…</button></div>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); cancel.mutate(); }}>
          <label className="field">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
          <ErrorNotice error={cancel.error} />
          <div className="actions">
            <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Keep booking</button>
            <button className="btn danger" disabled={cancel.isPending}>Cancel booking</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folio
// ---------------------------------------------------------------------------

export function FolioPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['folio', id], queryFn: () => deskApi.folio(id!) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['folio', id] });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNotice error={error ?? new Error('Folio not found')} />;
  const { folio, charges, payments, booking } = data;
  const open = folio.status === 'OPEN';

  return (
    <div className="stack">
      {booking && <Link to={`/staff/bookings/${booking._id}`} className="small">Back to {booking.guest.fullName}</Link>}
      <PageHead
        title={`Folio${booking && roomNo(booking) ? `, room ${roomNo(booking)}` : ''}`}
        sub={booking ? `${booking.guest.fullName}, ${stayRange(booking.checkInDate, booking.checkOutDate)}` : undefined}
      >
        <span className={`badge ${open ? 'pending' : 'checked_out'}`}>{open ? 'Open' : 'Closed'}</span>
      </PageHead>

      <div className="stat-row">
        <Stat value={<span className="money">{money(folio.totalCharges)}</span>} label="Charges incl. VAT" />
        <Stat value={<span className="money">{money(folio.totalPayments)}</span>} label="Paid" />
        <Stat value={<span className="money">{money(folio.balance)}</span>} label={folio.balance > 0 ? 'Still owed' : 'Balance'} />
      </div>

      <div className="split">
        <div className="stack">
          <section className="panel flush">
            <div className="panel-head" style={{ padding: '16px 16px 0' }}><h3>Charges</h3></div>
            <div className="table-wrap">
              <table className="data ledger">
                <thead><tr><th>Posted</th><th>Item</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {charges.map((c) => (
                    <tr key={c._id} className={c.type === 'TAX' ? 'tax' : ''}>
                      <td className="nowrap muted">{when(c.postedAt)}</td>
                      <td>{c.description}{c.quantity > 1 ? ` × ${c.quantity}` : ''}</td>
                      <td className="num money">{money(c.amount * c.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>Total</td><td className="num money">{money(folio.totalCharges)}</td></tr></tfoot>
              </table>
            </div>
          </section>

          <section className="panel flush">
            <div className="panel-head" style={{ padding: '16px 16px 0' }}><h3>Payments</h3></div>
            {payments.length === 0 ? <p className="muted small" style={{ padding: '0 16px 16px' }}>None yet.</p> : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>When</th><th>Method</th><th>Reference</th><th>Status</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p._id}>
                        <td className="nowrap muted">{when(p.paidAt ?? p.createdAt)}</td>
                        <td>{PAYMENT_METHOD[p.method] ?? p.method}</td>
                        <td className="muted">{p.gatewayRef && p.gatewayRef !== 'LOCAL' ? p.gatewayRef : '—'}</td>
                        <td><Status kind="payment" value={p.status} /></td>
                        <td className="num money">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          {open ? (
            <>
              <TakePayment folioId={folio._id} balance={folio.balance} onChange={refresh} />
              <PostCharge folioId={folio._id} onPosted={refresh} />
            </>
          ) : (
            <Notice tone="info">This folio closed {when(folio.closedAt)} and its invoice has been issued. Corrections need a credit note.</Notice>
          )}
        </div>
      </div>
    </div>
  );
}

function PostCharge({ folioId, onPosted }: { folioId: string; onPosted: () => void }) {
  const [description, setDescription] = useState('Minibar');
  const [amount, setAmount] = useState(85000);
  const [quantity, setQuantity] = useState(1);
  const post = useMutation({
    mutationFn: () => deskApi.postCharge(folioId, { type: 'SERVICE', description, amount, quantity }),
    onSuccess: onPosted,
  });
  return (
    <form className="panel form" onSubmit={(e) => { e.preventDefault(); post.mutate(); }}>
      <h3>Add a charge</h3>
      <label className="field">
        Item
        <input list="service-items" value={description} onChange={(e) => setDescription(e.target.value)} required />
        <datalist id="service-items">
          <option value="Minibar" /><option value="Laundry" /><option value="Restaurant — dinner" /><option value="Spa — 60 min" /><option value="Room service" />
        </datalist>
      </label>
      <div className="form-row">
        <label className="field">Price before VAT<input type="number" min={1000} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} required /></label>
        <label className="field">Quantity<input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required /></label>
      </div>
      <p className="xs muted">VAT of 10% is added as its own line.</p>
      <ErrorNotice error={post.error} />
      {post.isSuccess && <Notice tone="ok">Posted.</Notice>}
      <div className="actions"><button className="btn secondary" disabled={post.isPending}>Post charge</button></div>
    </form>
  );
}

function TakePayment({ folioId, balance, onChange }: { folioId: string; balance: number; onChange: () => void }) {
  const [amount, setAmount] = useState(Math.max(balance, 0));
  const [method, setMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  // One key per attempt: a double-click replays instead of charging twice (BR-15).
  const [key, setKey] = useState(newKey);
  const [qr, setQr] = useState<DeskPaymentResult | null>(null);

  useEffect(() => setAmount(Math.max(balance, 0)), [balance]);

  const pay = useMutation({
    mutationFn: () => deskApi.takePayment(folioId, amount, method, key),
    onSuccess: (r) => {
      if (r.status === 'PENDING' && r.qrCode) setQr(r);
      else { setKey(newKey()); onChange(); }
    },
  });

  const check = useMutation({
    mutationFn: () => paymentApi.reconcile(qr!.orderCode!),
    onSuccess: (r) => {
      if (r.paymentStatus !== 'PENDING') { setQr(null); setKey(newKey()); onChange(); }
    },
  });

  if (balance <= 0 && !qr) {
    return <Notice tone="ok">Nothing owed. The guest can check out.</Notice>;
  }

  if (qr) {
    return (
      <div className="panel stack">
        <h3>Scan to pay {money(qr.amount)}</h3>
        <div className="qr-box">
          <QRCodeSVG value={qr.qrCode!} size={168} level="M" />
          <p className="small">Ask the guest to scan with any Vietnamese banking app. The folio updates when payOS confirms the transfer.</p>
        </div>
        {check.data?.paymentStatus === 'PENDING' && <Notice tone="warn">payOS has not received the transfer yet.</Notice>}
        <ErrorNotice error={check.error} />
        <div className="actions">
          <button className="btn" onClick={() => check.mutate()} disabled={check.isPending}>{check.isPending ? 'Checking…' : 'Check payment'}</button>
          <button className="btn ghost" onClick={() => { setQr(null); setKey(newKey()); }}>Use another method</button>
        </div>
      </div>
    );
  }

  return (
    <form className="panel form" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }}>
      <h3>Take a payment</h3>
      <p className="small">Owed: <strong className="money">{money(balance)}</strong></p>
      <div className="form-row">
        <label className="field">Amount<input type="number" min={1} max={balance} value={amount} onChange={(e) => setAmount(Number(e.target.value))} required /></label>
        <label className="field">
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value as 'CASH' | 'BANK_TRANSFER')}>
            <option value="CASH">Cash</option>
            <option value="BANK_TRANSFER">VietQR (payOS)</option>
          </select>
        </label>
      </div>
      <ErrorNotice error={pay.error} />
      <div className="actions"><button className="btn" disabled={pay.isPending}>{method === 'CASH' ? 'Record cash payment' : 'Show QR code'}</button></div>
    </form>
  );
}

