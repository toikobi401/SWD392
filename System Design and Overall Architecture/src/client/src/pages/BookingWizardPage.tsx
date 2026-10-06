/**
 * UC-G07 Book Room — one or more rooms in one reservation: contact details
 * (UC-G08), who sleeps in which room, review with voucher (UC-G11), then a
 * single payOS payment for everything (UC-G10). The rooms are held for 15
 * minutes (BR-10); the countdown stops the guest before paying late.
 */
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { bookingApi, promotionApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { ErrorNotice, Notice } from '../components/ui';
import { money, stayRange } from '../lib/format';
import type { GuestDetails, SearchCriteria, VoucherPreview } from '../types';
import type { RoomSelection } from './RoomSearchPage';

const HOLD_SECONDS = 15 * 60;
const TAX_RATE = 0.1;
type Step = 'details' | 'review';

interface RoomLine {
  selection: RoomSelection;
  adults: number;
  children: number;
  /** Who stays here, when not the booker — they may then check in themselves. */
  occupantName: string;
}

/**
 * Spreads the party over the chosen rooms: one adult per room first, then
 * the remaining adults and the children wherever there is still a bed. The
 * guest can change it; this is only a sensible starting point.
 */
function distribute(selections: RoomSelection[], adults: number, children: number): RoomLine[] {
  const lines: RoomLine[] = selections.flatMap((s) =>
    Array.from({ length: s.quantity }, () => ({ selection: s, adults: 0, children: 0, occupantName: '' })),
  );
  const space = (l: RoomLine) => l.selection.roomType.capacity - l.adults - l.children;
  let a = adults;
  let c = children;
  for (const l of lines) if (a > 0) { l.adults++; a--; }
  for (let guard = 0; a > 0 && guard < 100; guard++) {
    const l = lines.find((x) => space(x) > 0);
    if (!l) break;
    l.adults++; a--;
  }
  for (let guard = 0; c > 0 && guard < 100; guard++) {
    const l = lines.find((x) => space(x) > 0);
    if (!l) break;
    l.children++; c--;
  }
  return lines;
}

export default function BookingWizardPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { state } = useLocation() as { state: { criteria: SearchCriteria; selections: RoomSelection[] } | null };

  const [step, setStep] = useState<Step>('details');
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucher, setVoucher] = useState<VoucherPreview | null>(null);
  const [guest, setGuest] = useState<GuestDetails>({
    fullName: profile?.fullName ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    specialRequest: '',
  });
  const [lines, setLines] = useState<RoomLine[]>(() =>
    state ? distribute(state.selections, state.criteria.adults, state.criteria.children) : [],
  );

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const book = useMutation({
    mutationFn: () =>
      bookingApi.create({
        rooms: lines.map((l) => ({
          roomTypeId: l.selection.roomType.id,
          adults: l.adults,
          children: l.children,
          occupantName: l.occupantName.trim() || undefined,
        })),
        checkInDate: state!.criteria.checkIn,
        checkOutDate: state!.criteria.checkOut,
        guest,
        // Only a code the guest applied and saw priced; the server re-checks it.
        voucherCode: voucher?.code,
        // payOS settles by VietQR bank transfer.
        paymentMethod: 'BANK_TRANSFER',
      }),
    onSuccess: (r) => {
      // UC-G10 step 5 — one payOS page for every room.
      if (r.paymentUrl) window.location.href = r.paymentUrl;
      else navigate(`/booking/lookup?code=${r.reservationCode}&email=${encodeURIComponent(guest.email)}`);
    },
  });

  // Priced the way BookingCoordinator prices it: the voucher is spread over
  // the rooms by price (the last room takes the rounding), then VAT per room.
  // So the amount on the Pay button is the amount payOS will ask for.
  const priced = useMemo(() => {
    const subtotal = lines.reduce((n, l) => n + l.selection.quote.subtotal, 0);
    const discount = voucher?.discount ?? 0;
    let left = discount;
    const rooms = lines.map((l, i) => {
      const d = i === lines.length - 1 ? left : Math.floor((discount * l.selection.quote.subtotal) / subtotal);
      left -= d;
      const tax = Math.round((l.selection.quote.subtotal - d) * TAX_RATE);
      return { discount: d, tax, total: l.selection.quote.subtotal - d + tax };
    });
    const tax = rooms.reduce((n, r) => n + r.tax, 0);
    return { subtotal, discount, tax, total: subtotal - discount + tax, rooms };
  }, [lines, voucher]);

  // UC-G06 — public codes, offered as shortcuts next to the field.
  const offers = useQuery({ queryKey: ['offers'], queryFn: promotionApi.offers, staleTime: 5 * 60_000 });

  // UC-G11 — check the code and price it before the guest pays.
  const apply = useMutation({
    mutationFn: (code: string) => promotionApi.preview(code, priced.subtotal),
    onSuccess: (v) => setVoucher(v),
  });

  if (!state?.selections?.length) {
    return (
      <main className="site-main narrow">
        <div className="stack">
          <h1>Choose your rooms first</h1>
          <p className="muted">A booking starts from a room search.</p>
          <Link to="/" className="btn">Search rooms</Link>
        </div>
      </main>
    );
  }

  const { criteria } = state;
  const expired = secondsLeft === 0;
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const many = lines.length > 1;

  // Per-room problems, stated so the guest can fix them.
  const problems = lines
    .map((l, i) => {
      const cap = l.selection.roomType.capacity;
      if (l.adults < 1) return `Room ${i + 1} needs at least one adult.`;
      if (l.adults + l.children > cap) return `Room ${i + 1} (${l.selection.roomType.name}) sleeps at most ${cap}.`;
      return null;
    })
    .filter(Boolean) as string[];

  const setLine = (i: number, patch: Partial<RoomLine>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function toReview(e: FormEvent) {
    e.preventDefault();
    if (!problems.length) setStep('review');
  }

  function applyCode(code: string) {
    const c = code.trim().toUpperCase();
    setVoucherInput(c);
    if (c) apply.mutate(c);
  }

  function editDetails() {
    // The rooms may change, so a priced voucher must be priced again.
    setVoucher(null);
    apply.reset();
    setStep('details');
  }

  return (
    <main className="site-main">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>{many ? `Book ${lines.length} rooms` : `Book ${lines[0].selection.roomType.name}`}</h1>
        {!expired && <span className="hold" role="timer">{many ? 'Rooms' : 'Room'} held for {mm}:{ss}</span>}
      </div>

      <ol className="steps">
        <li className={step === 'details' ? 'current' : 'done'}>Your details</li>
        <li className={step === 'review' ? 'current' : ''}>Review</li>
        <li>Pay with payOS</li>
      </ol>

      {expired && (
        <Notice tone="warn">
          The 15-minute hold has ended. <Link to="/">Search again</Link> to see current availability.
        </Notice>
      )}

      <div className="split" style={{ marginTop: 16 }}>
        <div className="panel">
          {step === 'details' ? (
            <form className="form" onSubmit={toReview}>
              <h2>Who is booking?</h2>
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

              <div className="stack tight">
                <h3>{many ? 'Who sleeps where' : 'Guests in the room'}</h3>
                {many && <p className="small muted">We spread your party over the rooms — change it if you like. Each room needs an adult.</p>}
                {lines.map((l, i) => (
                  <div className="room-line" key={i}>
                    <div>
                      <strong>{many ? `Room ${i + 1}: ` : ''}{l.selection.roomType.name}</strong>
                      <span className="muted xs">sleeps {l.selection.roomType.capacity}</span>
                    </div>
                    <label className="field inline">
                      Adults
                      <input type="number" min={1} max={l.selection.roomType.capacity} value={l.adults}
                        onChange={(e) => setLine(i, { adults: Number(e.target.value) })} />
                    </label>
                    <label className="field inline">
                      Children
                      <input type="number" min={0} max={l.selection.roomType.capacity} value={l.children}
                        onChange={(e) => setLine(i, { children: Number(e.target.value) })} />
                    </label>
                    {many && (
                      <label className="field inline occupant">
                        Staying in this room <span className="hint">If not you — they can then check in with their own ID.</span>
                        <input value={l.occupantName} placeholder={guest.fullName || 'Full name'}
                          onChange={(e) => setLine(i, { occupantName: e.target.value })} />
                      </label>
                    )}
                  </div>
                ))}
                {problems.map((p) => <Notice tone="warn" key={p}>{p}</Notice>)}
              </div>

              <label className="field">
                Anything we should know? <span className="hint">Optional — arrival time, rooms next to each other, an extra pillow.</span>
                <textarea value={guest.specialRequest}
                  onChange={(e) => setGuest({ ...guest, specialRequest: e.target.value })} />
              </label>
              <div className="actions">
                <button className="btn" type="submit" disabled={expired || problems.length > 0}>Continue to review</button>
              </div>
            </form>
          ) : (
            <div className="form">
              <h2>Check and pay</h2>
              <dl className="facts">
                <dt>Booked by</dt>
                <dd>{guest.fullName}</dd>
                <dt>Contact</dt>
                <dd>{guest.email}, {guest.phone}</dd>
                {guest.specialRequest && (<><dt>Request</dt><dd>{guest.specialRequest}</dd></>)}
              </dl>
              {voucher ? (
                <div className="voucher-applied notice ok">
                  <span>
                    <span className="code-tag">{voucher.code}</span>{' '}
                    {voucher.description}: {money(voucher.discount)} off{many ? ' the whole booking' : ''}.
                  </span>
                  <button className="btn ghost small" onClick={() => { setVoucher(null); apply.reset(); }}>Remove</button>
                </div>
              ) : (
                <div className="stack tight">
                  <form className="voucher" onSubmit={(e) => { e.preventDefault(); applyCode(voucherInput); }}>
                    <label className="field">
                      Voucher code <span className="hint">Optional.</span>
                      <input value={voucherInput} spellCheck={false} autoCapitalize="characters"
                        onChange={(e) => { setVoucherInput(e.target.value.toUpperCase()); apply.reset(); }} />
                    </label>
                    <button className="btn secondary" disabled={!voucherInput.trim() || apply.isPending}>
                      {apply.isPending ? 'Checking…' : 'Apply'}
                    </button>
                  </form>
                  {offers.data && offers.data.length > 0 && (
                    <div className="offer-picks">
                      <span className="xs muted">Current offers:</span>
                      {offers.data.map((o) => (
                        <button key={o.code} type="button" className="code-tag" title={o.description} onClick={() => applyCode(o.code)}>
                          {o.code}
                        </button>
                      ))}
                    </div>
                  )}
                  <ErrorNotice error={apply.error} />
                </div>
              )}
              <Notice tone="info">
                You pay {many ? `for all ${lines.length} rooms ` : ''}once, on a secure payOS page, by scanning a VietQR code with any
                Vietnamese banking app. Your booking is confirmed as soon as the transfer arrives.
              </Notice>
              <ErrorNotice error={book.error} />
              <div className="actions">
                <button className="btn secondary" onClick={editDetails}>Edit details</button>
                <button className="btn" disabled={expired || book.isPending || apply.isPending} onClick={() => book.mutate()}>
                  {book.isPending ? 'Opening payOS…' : `Pay ${money(priced.total)}`}
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="panel summary" aria-label="Booking summary">
          <h3>{stayRange(criteria.checkIn, criteria.checkOut)}</h3>
          <ul className="summary-rooms">
            {lines.map((l, i) => (
              <li key={i}>
                <span>
                  {l.selection.roomType.name}
                  {l.occupantName.trim() && <span className="muted xs">for {l.occupantName.trim()}</span>}
                  <span className="muted xs">
                    {' '}{l.adults} adult{l.adults === 1 ? '' : 's'}{l.children ? `, ${l.children} child${l.children === 1 ? '' : 'ren'}` : ''}
                  </span>
                </span>
                <span className="money">{money(priced.rooms[i]?.total ?? l.selection.quote.total)}</span>
              </li>
            ))}
          </ul>
          <dl className="facts" style={{ marginTop: 12 }}>
            <dt>Rooms</dt>
            <dd className="money">{money(priced.subtotal)}</dd>
            {voucher && (
              <>
                <dt className="discount-line">{voucher.code}</dt>
                <dd className="money discount-line">−{money(priced.discount)}</dd>
              </>
            )}
            <dt>VAT 10%</dt>
            <dd className="money">{money(priced.tax)}</dd>
          </dl>
          <div className="total">
            <span>Total</span>
            <span className="money">{money(priced.total)}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
