/**
 * «boundary» / user interaction — FrontDeskPage
 *
 * Realizes: UC-R01 Search Booking, UC-R06 Check In Guest, UC-R09 Check Out.
 *
 * The room list carries each room's `version`, which is sent back with the
 * check-in. If another receptionist claimed that room first the server rejects
 * the stale version and this page refetches — UC-R06 exception 1.0.E6, the
 * visible half of quality scenario QA-7.
 */
import { FormEvent, useState } from 'react';
import {
  useAllocatableRooms,
  useCheckIn,
  useCheckOut,
  formatDate,
  formatMoney,
} from '../hooks';
import { frontDeskApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { AllocatableRoom, Booking, CheckInRequest } from '../types';

export default function FrontDeskPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    const { bookings } = await frontDeskApi.searchBooking(query);
    setResults(bookings);
    setSelected(null);
  }

  return (
    <div className="page front-desk">
      <h1>Front desk</h1>

      <form onSubmit={search} className="search-bar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Booking code, guest name, phone or email"
        />
        <button type="submit">Search</button>
      </form>

      <div className="split">
        <ul className="booking-list">
          {results.map((b) => (
            <li
              key={b._id}
              className={selected?._id === b._id ? 'selected' : ''}
              onClick={() => setSelected(b)}
            >
              <strong>{b.bookingCode}</strong>
              <span>{b.guest.fullName}</span>
              <span>
                {formatDate(b.checkInDate)} → {formatDate(b.checkOutDate)}
              </span>
              <span className={`status status-${b.status.toLowerCase()}`}>{b.status}</span>
            </li>
          ))}
          {results.length === 0 && <li className="empty">No bookings found.</li>}
        </ul>

        <div className="detail-pane">
          {!selected && <p>Select a booking to check in or out.</p>}

          {selected?.status === 'CONFIRMED' && (
            <CheckInPanel booking={selected} onDone={() => setSelected(null)} />
          )}

          {selected?.status === 'CHECKED_IN' && (
            <CheckOutPanel booking={selected} onDone={() => setSelected(null)} />
          )}

          {selected &&
            selected.status !== 'CONFIRMED' &&
            selected.status !== 'CHECKED_IN' && (
              <p className="empty">
                This booking is {selected.status.toLowerCase()} — no desk action available.
              </p>
            )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CheckInPanel({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const roomTypeId =
    typeof booking.roomTypeId === 'string' ? booking.roomTypeId : booking.roomTypeId.id;

  const { data, refetch } = useAllocatableRooms(roomTypeId);
  const checkIn = useCheckIn();

  const [room, setRoom] = useState<AllocatableRoom | null>(null);
  const [identity, setIdentity] = useState<CheckInRequest['identity']>({
    documentType: 'NATIONAL_ID',
    documentNumber: '',
    fullName: booking.guest.fullName,
    dateOfBirth: '',
    expiryDate: '',
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!room) return;

    try {
      const result = await checkIn.mutateAsync({
        bookingId: booking._id,
        identity,
        roomId: room.id,
        // The guard: the version this receptionist actually saw.
        roomVersion: room.version,
      });
      alert(`Checked in to room ${result.roomNumber}`);
      onDone();
    } catch (err) {
      if ((err as ApiError).code === 'ROOM_TAKEN') {
        // Another desk won the race — refresh and make them pick again.
        setRoom(null);
        await refetch();
      }
    }
  }

  const error = checkIn.error as ApiError | null;

  return (
    <form className="form" onSubmit={submit}>
      <h2>Check in — {booking.bookingCode}</h2>

      <fieldset>
        <legend>Guest identity (UC-R07)</legend>
        <label>
          Document type
          <select
            value={identity.documentType}
            onChange={(e) =>
              setIdentity({
                ...identity,
                documentType: e.target.value as CheckInRequest['identity']['documentType'],
              })
            }
          >
            <option value="NATIONAL_ID">National ID</option>
            <option value="PASSPORT">Passport</option>
            <option value="DRIVING_LICENCE">Driving licence</option>
          </select>
        </label>
        <label>
          Document number
          <input
            value={identity.documentNumber}
            onChange={(e) => setIdentity({ ...identity, documentNumber: e.target.value })}
            required
          />
        </label>
        <label>
          Name on document
          <input
            value={identity.fullName}
            onChange={(e) => setIdentity({ ...identity, fullName: e.target.value })}
            required
          />
        </label>
        <label>
          Date of birth
          <input
            type="date"
            value={identity.dateOfBirth}
            onChange={(e) => setIdentity({ ...identity, dateOfBirth: e.target.value })}
            required
          />
        </label>
        <label>
          Expiry date
          <input
            type="date"
            value={identity.expiryDate}
            onChange={(e) => setIdentity({ ...identity, expiryDate: e.target.value })}
            required
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Assign room (UC-R08)</legend>
        {/* UC-R06 exception 1.0.E4 */}
        {data?.rooms.length === 0 && (
          <p className="error">
            No vacant-clean room of this type. Offer an upgrade or alert housekeeping.
          </p>
        )}
        <div className="room-grid">
          {data?.rooms.map((r) => (
            <button
              type="button"
              key={r.id}
              className={room?.id === r.id ? 'room selected' : 'room'}
              onClick={() => setRoom(r)}
            >
              {r.roomNumber}
              <small>Floor {r.floor}</small>
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="error">
          {error.code === 'ROOM_TAKEN'
            ? 'That room was just taken. The list has been refreshed — please pick another.'
            : error.message}
        </p>
      )}

      <button type="submit" disabled={!room || checkIn.isPending}>
        {checkIn.isPending ? 'Checking in…' : 'Complete check-in'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function CheckOutPanel({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const checkOut = useCheckOut();
  const [surcharge, setSurcharge] = useState(0);
  const [waive, setWaive] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();

    const result = await checkOut.mutateAsync({
      bookingId: booking._id,
      lateCheckoutSurcharge: surcharge || undefined,
      waiveSurcharge: waive,
    });

    alert(`Checked out. Invoice ${result.invoiceNumber} — ${formatMoney(result.total)}`);
    onDone();
  }

  const error = checkOut.error as ApiError | null;

  return (
    <form className="form" onSubmit={submit}>
      <h2>Check out — {booking.bookingCode}</h2>
      <p>{booking.guest.fullName}</p>

      <label>
        Late check-out surcharge (BR-27)
        <input
          type="number"
          min={0}
          value={surcharge}
          onChange={(e) => setSurcharge(Number(e.target.value))}
        />
      </label>

      <label className="checkbox">
        <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
        Waive the surcharge (manager authorized)
      </label>

      {/* BR-28 — the folio must reach zero first (exception 1.0.E1). */}
      {error && (
        <p className="error">
          {error.code === 'OUTSTANDING_BALANCE'
            ? `${error.message} Take payment before completing check-out.`
            : error.message}
        </p>
      )}

      <button type="submit" disabled={checkOut.isPending}>
        {checkOut.isPending ? 'Processing…' : 'Complete check-out'}
      </button>
    </form>
  );
}
