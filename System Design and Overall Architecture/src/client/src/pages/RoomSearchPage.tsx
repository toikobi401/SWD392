/**
 * «boundary» / user interaction — RoomSearchPage
 *
 * Realizes: UC-G01 Search Available Rooms (and the entry point to UC-G07).
 * The date validation here mirrors the server's, so the guest is corrected
 * before a round trip — but the server still enforces it (UC-G01 exceptions
 * 1.0.E1–1.0.E3 are never trusted to the client alone).
 */
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoomSearch, formatMoney } from '../hooks';
import type { SearchCriteria } from '../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export default function RoomSearchPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<SearchCriteria>({
    checkIn: today(),
    checkOut: tomorrow(),
    adults: 2,
    children: 0,
    rooms: 1,
  });
  const [submitted, setSubmitted] = useState<SearchCriteria | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, error: queryError } = useRoomSearch(submitted);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // UC-G01 exceptions 1.0.E1–1.0.E3, checked client-side for fast feedback.
    if (form.checkIn < today()) {
      return setError('Check-in date cannot be in the past.');
    }
    if (form.checkOut <= form.checkIn) {
      return setError('Check-out must be after check-in.');
    }
    const nights = Math.ceil(
      (Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86_400_000,
    );
    if (nights > 30) {
      return setError('For stays longer than 30 nights please contact us.');
    }

    setSubmitted({ ...form });
  }

  return (
    <div className="page">
      <h1>Find a room</h1>

      <form onSubmit={handleSubmit} className="search-form">
        <label>
          Check-in
          <input
            type="date"
            value={form.checkIn}
            min={today()}
            onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
            required
          />
        </label>

        <label>
          Check-out
          <input
            type="date"
            value={form.checkOut}
            min={form.checkIn}
            onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
            required
          />
        </label>

        <label>
          Adults
          <input
            type="number"
            min={1}
            max={10}
            value={form.adults}
            onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })}
          />
        </label>

        <label>
          Children
          <input
            type="number"
            min={0}
            max={10}
            value={form.children}
            onChange={(e) => setForm({ ...form, children: Number(e.target.value) })}
          />
        </label>

        <label>
          Rooms
          <input
            type="number"
            min={1}
            max={5}
            value={form.rooms}
            onChange={(e) => setForm({ ...form, rooms: Number(e.target.value) })}
          />
        </label>

        <button type="submit">Search</button>
      </form>

      {error && <p className="error">{error}</p>}
      {isLoading && <p>Searching…</p>}
      {isError && <p className="error">{(queryError as Error).message}</p>}

      {/* UC-G01 exception 1.0.E4 — no availability is a normal outcome. */}
      {data && data.results.length === 0 && (
        <p className="empty">No rooms are available for these dates. Try different dates.</p>
      )}

      <ul className="results">
        {data?.results.map((item) => (
          <li key={item.roomType.id} className="result-card">
            {item.roomType.images[0] && (
              <img src={item.roomType.images[0]} alt={item.roomType.name} />
            )}

            <div className="result-body">
              <h2>{item.roomType.name}</h2>
              <p>{item.roomType.description}</p>
              <p className="meta">
                Sleeps {item.roomType.capacity} · {item.roomType.amenities.join(' · ')}
              </p>
              <p className="meta">
                {item.availableCount} room{item.availableCount === 1 ? '' : 's'} left
              </p>
            </div>

            <div className="result-price">
              <strong>{formatMoney(item.total)}</strong>
              <span>
                {item.nights} night{item.nights === 1 ? '' : 's'}, incl. tax
              </span>
              <button
                onClick={() =>
                  navigate('/book', {
                    state: { roomType: item.roomType, criteria: submitted, quote: item },
                  })
                }
              >
                Book now
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
