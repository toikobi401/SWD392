/**
 * UC-G01 Search Available Rooms — the home page. The search IS the hero: the
 * one thing a guest comes here to do. Before a search, the room catalogue
 * shows what the hotel has; after one, only what is free for those dates.
 */
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { roomApi } from '../api/endpoints';
import { ErrorNotice, Loading, Notice, Empty } from '../components/ui';
import { hotelTodayISO, money } from '../lib/format';
import type { SearchCriteria } from '../types';

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

  const results = useQuery({
    queryKey: ['search', submitted],
    queryFn: () => roomApi.search(submitted!),
    enabled: Boolean(submitted),
  });
  const catalogue = useQuery({ queryKey: ['room-types'], queryFn: roomApi.types, enabled: !submitted });

  function search(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    // Mirrors the server's UC-G01 exceptions for instant feedback; the server
    // still enforces them.
    if (form.checkIn < hotelTodayISO(0)) return setFormError('Check-in cannot be in the past.');
    if (form.checkOut <= form.checkIn) return setFormError('Check-out must be after check-in.');
    const n = (Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86_400_000;
    if (n > 30) return setFormError('For stays longer than 30 nights, please contact the hotel.');
    setParams({
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      adults: String(form.adults),
      children: String(form.children),
    });
  }

  return (
    <main className="site-main">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">When are you staying with us?</h1>
        <p>120 rooms at Hoa Lac, from a single for a work trip to a suite for the whole family. Prices include VAT.</p>

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
            <input type="number" min={1} max={8} value={form.adults}
              onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })} />
          </label>
          <label className="field">
            Children
            <input type="number" min={0} max={6} value={form.children}
              onChange={(e) => setForm({ ...form, children: Number(e.target.value) })} />
          </label>
          <button className="btn" type="submit">Show available rooms</button>
        </form>
        {formError && <Notice tone="error">{formError}</Notice>}
      </section>

      {submitted ? (
        <section className="stack" aria-live="polite">
          <div className="row between">
            <h2>Available for your dates</h2>
            {results.data && <span className="muted small">{results.data.count} room type{results.data.count === 1 ? '' : 's'}</span>}
          </div>
          {results.isLoading && <Loading label="Checking availability…" />}
          <ErrorNotice error={results.error} />
          {results.data?.count === 0 && (
            <Empty title="Nothing free for these dates">
              <p>Try moving your dates by a day or two, or fewer guests per room.</p>
            </Empty>
          )}
          <div className="room-list">
            {results.data?.results.map((r) => (
              <article className="room-card" key={r.roomType.id}>
                <div>
                  <h3>
                    <Link to={`/rooms/${r.roomType.id}`}>{r.roomType.name}</Link>
                  </h3>
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
                  <span className="muted xs">{r.nights} night{r.nights === 1 ? '' : 's'}, VAT included</span>
                  <button
                    className="btn"
                    onClick={() => navigate('/book', { state: { roomType: r.roomType, criteria: submitted, quote: r } })}
                  >
                    Book this room
                  </button>
                </div>
              </article>
            ))}
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
    </main>
  );
}
