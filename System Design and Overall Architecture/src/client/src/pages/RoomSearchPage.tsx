/**
 * UC-G01 Search Available Rooms — the home page, and the start of UC-G07.
 *
 * The search IS the hero. After a search the guest chooses how many rooms of
 * each type they want — a family of six may take a suite and a double — and
 * a bar at the bottom keeps the selection honest: enough beds for the party,
 * at most five rooms (BR-08), and the running total.
 */
import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { promotionApi, roomApi } from '../api/endpoints';
import { ErrorNotice, Loading, Notice, Empty } from '../components/ui';
import { calendarDate, discountLabel, hotelTodayISO, money } from '../lib/format';
import type { SearchCriteria, SearchResultItem } from '../types';

/** BR-08 — mirrors the server's limit for instant feedback. */
export const MAX_ROOMS = 5;

export interface RoomSelection {
  roomType: SearchResultItem['roomType'];
  quote: SearchResultItem;
  quantity: number;
}

export default function RoomSearchPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const submitted: SearchCriteria | null = params.get('checkIn')
    ? {
        checkIn: params.get('checkIn')!,
        checkOut: params.get('checkOut')!,
        adults: Number(params.get('adults') ?? 2),
        children: Number(params.get('children') ?? 0),
        rooms: 1,
      }
    : null;

  const [form, setForm] = useState<SearchCriteria>(
    submitted ?? { checkIn: hotelTodayISO(0), checkOut: hotelTodayISO(2), adults: 2, children: 0, rooms: 1 },
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});

  const results = useQuery({
    queryKey: ['search', submitted],
    queryFn: () => roomApi.search(submitted!),
    enabled: Boolean(submitted),
  });
  const catalogue = useQuery({ queryKey: ['room-types'], queryFn: roomApi.types, enabled: !submitted });
  const offers = useQuery({ queryKey: ['offers'], queryFn: promotionApi.offers, staleTime: 5 * 60_000 });

  const selections: RoomSelection[] = useMemo(
    () =>
      (results.data?.results ?? [])
        .filter((r) => (qty[r.roomType.id] ?? 0) > 0)
        .map((r) => ({ roomType: r.roomType, quote: r, quantity: qty[r.roomType.id] })),
    [results.data, qty],
  );
  const roomCount = selections.reduce((n, s) => n + s.quantity, 0);
  const beds = selections.reduce((n, s) => n + s.quantity * s.roomType.capacity, 0);
  const total = selections.reduce((n, s) => n + s.quantity * s.quote.total, 0);
  const party = submitted ? submitted.adults + submitted.children : 0;

  function search(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    // Mirrors the server's UC-G01 exceptions for instant feedback; the server
    // still enforces them.
    if (form.checkIn < hotelTodayISO(0)) return setFormError('Check-in cannot be in the past.');
    if (form.checkOut <= form.checkIn) return setFormError('Check-out must be after check-in.');
    const n = (Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86_400_000;
    if (n > 30) return setFormError('For stays longer than 30 nights, please contact the hotel.');
    setQty({});
    setParams({
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      adults: String(form.adults),
      children: String(form.children),
    });
  }

  function change(item: SearchResultItem, delta: number) {
    const current = qty[item.roomType.id] ?? 0;
    const next = Math.max(0, Math.min(item.availableCount, current + delta));
    if (delta > 0 && roomCount >= MAX_ROOMS) return;
    setQty({ ...qty, [item.roomType.id]: next });
  }

  function proceed(sel: RoomSelection[]) {
    navigate('/book', { state: { criteria: submitted, selections: sel } });
  }

  // What stops the guest from continuing, in plain words — or null.
  const blocker =
    roomCount === 0
      ? null
      : beds < party
        ? `These rooms sleep ${beds}. Add a room for the other ${party - beds} guest${party - beds === 1 ? '' : 's'}.`
        : submitted && submitted.adults < roomCount
          ? `Every room needs an adult — ${submitted.adults} adult${submitted.adults === 1 ? '' : 's'} can take at most ${submitted.adults} room${submitted.adults === 1 ? '' : 's'}.`
          : null;

  return (
    <main className="site-main" style={{ paddingBottom: roomCount ? 120 : undefined }}>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">When are you staying with us?</h1>
        <p>120 rooms at Hoa Lac, from a single for a work trip to several rooms for the whole family. Prices include VAT.</p>

        <form className="hero-form" onSubmit={search}>
          <label className="field">
            Check-in
            <input type="date" value={form.checkIn} min={hotelTodayISO(0)} required
              onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
          </label>
          <label className="field">
            Check-out
            <input type="date" value={form.checkOut} min={form.checkIn} required
              onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
          </label>
          <label className="field">
            Adults
            <input type="number" min={1} max={20} value={form.adults}
              onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })} />
          </label>
          <label className="field">
            Children
            <input type="number" min={0} max={12} value={form.children}
              onChange={(e) => setForm({ ...form, children: Number(e.target.value) })} />
          </label>
          <button className="btn" type="submit">Show available rooms</button>
        </form>
        {formError && <Notice tone="error">{formError}</Notice>}
      </section>

      {/* UC-G06 — only codes on the website; private codes are never listed. */}
      {!submitted && offers.data && offers.data.length > 0 && (
        <section className="offers" aria-labelledby="offers-title">
          <h2 id="offers-title">Codes you can use now</h2>
          <ul className="offer-list">
            {offers.data.map((o) => (
              <li key={o.code}>
                <span className="code-tag">{o.code}</span>
                <strong>{discountLabel(o)}</strong>
                <span className="small muted">
                  {o.description}.{o.minimumSpend > 0 ? ` On bookings of ${money(o.minimumSpend)} or more before tax.` : ''}{' '}
                  Book by {calendarDate(o.validTo)}.
                </span>
              </li>
            ))}
          </ul>
          <p className="xs muted">Enter the code when you review your booking.</p>
        </section>
      )}

      {submitted ? (
        <section className="stack" aria-live="polite">
          <div className="row between">
            <h2>Choose your rooms</h2>
            {results.data && (
              <span className="muted small">
                {party} guest{party === 1 ? '' : 's'}. Take several rooms if you need them — up to {MAX_ROOMS}.
              </span>
            )}
          </div>
          {results.isLoading && <Loading label="Checking availability…" />}
          <ErrorNotice error={results.error} />
          {results.data?.count === 0 && (
            <Empty title="Nothing free for these dates">
              <p>Try moving your dates by a day or two.</p>
            </Empty>
          )}
          <div className="room-list">
            {results.data?.results.map((r) => {
              const n = qty[r.roomType.id] ?? 0;
              return (
                <article className={`room-card ${n ? 'chosen' : ''}`} key={r.roomType.id}>
                  <div>
                    <h3><Link to={`/rooms/${r.roomType.id}`}>{r.roomType.name}</Link></h3>
                    <p className="muted small">
                      Sleeps {r.roomType.capacity}.{' '}
                      {r.availableCount <= 3
                        ? `Only ${r.availableCount} left for these dates.`
                        : `${r.availableCount} available.`}
                    </p>
                    <div className="amenities">
                      {r.roomType.amenities.map((a) => <span className="chip" key={a}>{a}</span>)}
                    </div>
                  </div>
                  <div className="price">
                    <strong className="money">{money(r.total)}</strong>
                    <span className="muted xs">per room, {r.nights} night{r.nights === 1 ? '' : 's'}, VAT included</span>
                    <div className="qty" role="group" aria-label={`Number of ${r.roomType.name} rooms`}>
                      <button type="button" onClick={() => change(r, -1)} disabled={n === 0} aria-label="One fewer">−</button>
                      <output aria-live="polite">{n}</output>
                      <button type="button" onClick={() => change(r, 1)}
                        disabled={n >= r.availableCount || roomCount >= MAX_ROOMS} aria-label="One more">+</button>
                    </div>
                    {r.fitsParty && roomCount === 0 && (
                      <button className="btn ghost small" onClick={() => proceed([{ roomType: r.roomType, quote: r, quantity: 1 }])}>
                        Book one room
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="stack">
          <h2>Our rooms</h2>
          {catalogue.isLoading && <Loading />}
          <ErrorNotice error={catalogue.error} />
          <div className="room-list">
            {catalogue.data?.map((t) => (
              <article className="room-card" key={t._id}>
                <div>
                  <h3><Link to={`/rooms/${t._id}`}>{t.name}</Link></h3>
                  <p className="muted small">Sleeps {t.capacity}. {t.totalRooms} rooms of this type.</p>
                  <div className="amenities">
                    {t.amenities.map((a) => <span className="chip" key={a}>{a}</span>)}
                  </div>
                </div>
                <div className="price">
                  <span className="muted xs">from</span>
                  <strong className="money">{money(t.basePrice)}</strong>
                  <span className="muted xs">per night, before VAT</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {roomCount > 0 && (
        <div className="selection-bar" role="region" aria-label="Your selection">
          <div className="inner">
            <div>
              <strong>
                {roomCount} room{roomCount === 1 ? '' : 's'} for {party} guest{party === 1 ? '' : 's'}
              </strong>
              <span className={blocker ? 'warn-text' : 'muted'}>
                {blocker ?? `${selections.map((s) => `${s.quantity} × ${s.roomType.name}`).join(', ')}. Sleeps up to ${beds}.`}
              </span>
            </div>
            <div className="row">
              <strong className="money">{money(total)}</strong>
              <button className="btn" disabled={Boolean(blocker)} onClick={() => proceed(selections)}>Continue</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
